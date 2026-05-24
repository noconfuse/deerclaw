//! Interactive approval workflow for supervised mode.
//!
//! Provides a pre-execution hook that prompts the user before tool calls,
//! with session-scoped "Always" allowlists and audit logging.

use crate::config::AutonomyConfig;
use crate::security::{AutonomyLevel, policy::ToolOperation};
use async_trait::async_trait;
use chrono::Utc;
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::io::{self, BufRead, Write};
use std::sync::Arc;

// ── Types ────────────────────────────────────────────────────────

/// A request to approve a tool call before execution.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ApprovalRequest {
    pub tool_name: String,
    pub arguments: serde_json::Value,
}

/// The user's response to an approval request.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ApprovalResponse {
    /// Execute this one call.
    Yes,
    /// Deny this call.
    No,
    /// Execute and add tool to session-scoped allowlist.
    Always,
}

/// A single audit log entry for an approval decision.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ApprovalLogEntry {
    pub timestamp: String,
    pub tool_name: String,
    pub arguments_summary: String,
    pub decision: ApprovalResponse,
    pub channel: String,
}

#[async_trait]
pub trait ApprovalPrompter: Send + Sync {
    async fn prompt(&self, request: &ApprovalRequest, channel: &str) -> ApprovalResponse;
}

// ── ApprovalManager ──────────────────────────────────────────────

/// Manages the interactive approval workflow.
///
/// - Checks config-level `auto_approve` / `always_ask` lists
/// - Maintains a session-scoped "always" allowlist
/// - Records an audit trail of all decisions
pub struct ApprovalManager {
    /// Tools that never need approval (from config).
    auto_approve: HashSet<String>,
    /// Tools or command scopes that require approval by default.
    always_ask: HashSet<String>,
    /// Autonomy level from config.
    autonomy_level: AutonomyLevel,
    /// Session-scoped allowlist built from "Always" responses.
    session_allowlist: Mutex<HashSet<String>>,
    /// Audit trail of approval decisions.
    audit_log: Mutex<Vec<ApprovalLogEntry>>,
    /// Optional async prompter for non-CLI interactive surfaces.
    prompter: Option<Arc<dyn ApprovalPrompter>>,
}

impl ApprovalManager {
    /// Create from autonomy config.
    pub fn from_config(config: &AutonomyConfig) -> Self {
        Self {
            auto_approve: config.auto_approve.iter().cloned().collect(),
            always_ask: config.always_ask.iter().cloned().collect(),
            autonomy_level: config.level,
            session_allowlist: Mutex::new(HashSet::new()),
            audit_log: Mutex::new(Vec::new()),
            prompter: None,
        }
    }

    pub fn with_prompter(config: &AutonomyConfig, prompter: Arc<dyn ApprovalPrompter>) -> Self {
        Self {
            prompter: Some(prompter),
            ..Self::from_config(config)
        }
    }

    /// Check whether a tool call requires interactive approval.
    ///
    /// Returns `true` if the call needs a prompt, `false` if it can proceed.
    pub fn needs_approval(
        &self,
        tool_name: &str,
        args: &serde_json::Value,
        operation: ToolOperation,
    ) -> bool {
        // Full autonomy never prompts.
        if self.autonomy_level == AutonomyLevel::Full {
            return false;
        }

        let approval_keys = approval_scope_keys(tool_name, args);

        // A session-scoped "Always" decision should suppress repeated prompts
        // for the same tool or command scope during the current session.
        if self.session_scope_is_allowed(&approval_keys) {
            return false;
        }

        // always_ask requires an approval before the first allow decision.
        if self.always_ask.contains(tool_name)
            || approval_keys.iter().any(|key| self.always_ask.contains(key))
        {
            return true;
        }

        // auto_approve skips the prompt.
        if self.auto_approve.contains(tool_name)
            || approval_keys.iter().any(|key| self.auto_approve.contains(key))
        {
            return false;
        }

        // Session allowlist (from prior "Always" responses).
        let allowlist = self.session_allowlist.lock();
        if approval_keys.iter().any(|key| allowlist.contains(key)) {
            return false;
        }

        if tool_name == "shell" {
            return false;
        }

        operation == ToolOperation::Act
    }

    /// Returns whether the current call should execute with an approval override.
    ///
    /// This covers session-scoped "Always" decisions and config-level auto-approve
    /// entries for side-effecting tools. Without this, a call may skip the prompt
    /// but still fail later in shell-level policy validation as if it were unapproved.
    pub fn execution_is_preapproved(
        &self,
        tool_name: &str,
        args: &serde_json::Value,
        operation: ToolOperation,
    ) -> bool {
        if self.autonomy_level == AutonomyLevel::Full || operation != ToolOperation::Act {
            return false;
        }

        let approval_keys = approval_scope_keys(tool_name, args);

        if self.session_scope_is_allowed(&approval_keys) {
            return true;
        }

        if self.always_ask.contains(tool_name)
            || approval_keys.iter().any(|key| self.always_ask.contains(key))
        {
            return false;
        }

        if self.auto_approve.contains(tool_name)
            || approval_keys.iter().any(|key| self.auto_approve.contains(key))
        {
            return true;
        }

        let allowlist = self.session_allowlist.lock();
        approval_keys.iter().any(|key| allowlist.contains(key))
    }

    /// Record an approval decision and update session state.
    pub fn record_decision(
        &self,
        tool_name: &str,
        args: &serde_json::Value,
        decision: ApprovalResponse,
        channel: &str,
    ) {
        // If "Always", add the relevant approval scope(s) to the session allowlist.
        if decision == ApprovalResponse::Always {
            let mut allowlist = self.session_allowlist.lock();
            for approval_key in self.session_allowlist_keys(tool_name, args) {
                allowlist.insert(approval_key);
            }
        }

        // Append to audit log.
        let summary = summarize_args(args);
        let entry = ApprovalLogEntry {
            timestamp: Utc::now().to_rfc3339(),
            tool_name: tool_name.to_string(),
            arguments_summary: summary,
            decision,
            channel: channel.to_string(),
        };
        let mut log = self.audit_log.lock();
        log.push(entry);
    }

    /// Get a snapshot of the audit log.
    pub fn audit_log(&self) -> Vec<ApprovalLogEntry> {
        self.audit_log.lock().clone()
    }

    /// Get the current session allowlist.
    pub fn session_allowlist(&self) -> HashSet<String> {
        self.session_allowlist.lock().clone()
    }

    /// Prompt the user on the CLI and return their decision.
    ///
    /// For non-CLI channels, returns `Yes` automatically (interactive
    /// approval is only supported on CLI for now).
    pub fn prompt_cli(&self, request: &ApprovalRequest) -> ApprovalResponse {
        prompt_cli_interactive(request)
    }

    pub async fn prompt(&self, request: &ApprovalRequest, channel: &str) -> ApprovalResponse {
        if channel == "cli" {
            return self.prompt_cli(request);
        }

        if let Some(prompter) = &self.prompter {
            return prompter.prompt(request, channel).await;
        }

        ApprovalResponse::No
    }

    fn session_scope_is_allowed(&self, approval_keys: &[String]) -> bool {
        let allowlist = self.session_allowlist.lock();
        approval_keys.iter().any(|key| allowlist.contains(key))
    }

    fn session_allowlist_keys(&self, tool_name: &str, args: &serde_json::Value) -> Vec<String> {
        let approval_keys = approval_scope_keys(tool_name, args);
        if tool_name != "shell" {
            return approval_keys
                .into_iter()
                .next()
                .into_iter()
                .collect();
        }

        let mut allowlist_keys = Vec::new();
        if self.always_ask.contains(tool_name) {
            if let Some(exact_key) = approval_keys.first() {
                allowlist_keys.push(exact_key.clone());
            }
        }

        for key in &approval_keys {
            if self.always_ask.contains(key) {
                allowlist_keys.push(key.clone());
            }
        }

        if allowlist_keys.is_empty() {
            if let Some(exact_key) = approval_keys.first() {
                allowlist_keys.push(exact_key.clone());
            }
        }

        allowlist_keys.sort();
        allowlist_keys.dedup();
        allowlist_keys
    }
}

fn approval_scope_keys(tool_name: &str, args: &serde_json::Value) -> Vec<String> {
    if tool_name == "shell" {
        if let Some(command) = args.get("command").and_then(|value| value.as_str()) {
            let normalized = normalize_shell_command(command);
            if !normalized.is_empty() {
                let mut keys = vec![format!("shell:{normalized}")];
                if let Some(base) = shell_command_base(command) {
                    keys.push(format!("shell:{base}"));
                }
                return keys;
            }
        }
    }

    vec![tool_name.to_string()]
}

fn normalize_shell_command(command: &str) -> String {
    command.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn shell_command_base(command: &str) -> Option<String> {
    let command = command.trim_start();
    let mut words = command.split_whitespace();
    let mut executable = words.next()?;
    while executable.contains('=')
        && executable
            .chars()
            .next()
            .is_some_and(|ch| ch.is_ascii_alphabetic() || ch == '_')
    {
        executable = words.next()?;
    }
    let executable = executable.trim_matches(|c| c == '"' || c == '\'');
    let base = executable.rsplit('/').next()?.trim();
    if base.is_empty() {
        None
    } else {
        Some(base.to_ascii_lowercase())
    }
}

// ── CLI prompt ───────────────────────────────────────────────────

/// Display the approval prompt and read user input from stdin.
fn prompt_cli_interactive(request: &ApprovalRequest) -> ApprovalResponse {
    let summary = summarize_args(&request.arguments);
    eprintln!();
    eprintln!("🔧 Agent wants to execute: {}", request.tool_name);
    eprintln!("   {summary}");
    eprint!("   [Y]es / [N]o / [A]lways for {}: ", request.tool_name);
    let _ = io::stderr().flush();

    let stdin = io::stdin();
    let mut line = String::new();
    if stdin.lock().read_line(&mut line).is_err() {
        return ApprovalResponse::No;
    }

    match line.trim().to_ascii_lowercase().as_str() {
        "y" | "yes" => ApprovalResponse::Yes,
        "a" | "always" => ApprovalResponse::Always,
        _ => ApprovalResponse::No,
    }
}

/// Produce a short human-readable summary of tool arguments.
fn summarize_args(args: &serde_json::Value) -> String {
    match args {
        serde_json::Value::Object(map) => {
            let parts: Vec<String> = map
                .iter()
                .map(|(k, v)| {
                    let val = match v {
                        serde_json::Value::String(s) => truncate_for_summary(s, 80),
                        other => {
                            let s = other.to_string();
                            truncate_for_summary(&s, 80)
                        }
                    };
                    format!("{k}: {val}")
                })
                .collect();
            parts.join(", ")
        }
        other => {
            let s = other.to_string();
            truncate_for_summary(&s, 120)
        }
    }
}

fn truncate_for_summary(input: &str, max_chars: usize) -> String {
    let mut chars = input.chars();
    let truncated: String = chars.by_ref().take(max_chars).collect();
    if chars.next().is_some() {
        format!("{truncated}…")
    } else {
        input.to_string()
    }
}

// ── Tests ────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::AutonomyConfig;
    use crate::security::policy::ToolOperation;

    fn supervised_config() -> AutonomyConfig {
        AutonomyConfig {
            level: AutonomyLevel::Supervised,
            auto_approve: vec!["custom_safe_tool".into()],
            always_ask: vec!["shell".into()],
            ..AutonomyConfig::default()
        }
    }

    fn full_config() -> AutonomyConfig {
        AutonomyConfig {
            level: AutonomyLevel::Full,
            ..AutonomyConfig::default()
        }
    }

    // ── needs_approval ───────────────────────────────────────

    #[test]
    fn auto_approve_tools_skip_prompt() {
        let mgr = ApprovalManager::from_config(&supervised_config());
        assert!(!mgr.needs_approval("file_read", &serde_json::json!({}), ToolOperation::Read));
        assert!(!mgr.needs_approval(
            "memory_recall",
            &serde_json::json!({}),
            ToolOperation::Read
        ));
        assert!(!mgr.needs_approval(
            "custom_safe_tool",
            &serde_json::json!({}),
            ToolOperation::Act
        ));
    }

    #[test]
    fn always_ask_tools_always_prompt() {
        let mgr = ApprovalManager::from_config(&supervised_config());
        assert!(mgr.needs_approval(
            "shell",
            &serde_json::json!({"command": "ls"}),
            ToolOperation::Act
        ));
    }

    #[test]
    fn unknown_tool_needs_approval_in_supervised() {
        let mgr = ApprovalManager::from_config(&supervised_config());
        assert!(mgr.needs_approval(
            "file_write",
            &serde_json::json!({}),
            ToolOperation::Act
        ));
        assert!(mgr.needs_approval(
            "http_request",
            &serde_json::json!({}),
            ToolOperation::Act
        ));
        assert!(!mgr.needs_approval(
            "glob_search",
            &serde_json::json!({}),
            ToolOperation::Read
        ));
    }

    #[test]
    fn full_autonomy_never_prompts() {
        let mgr = ApprovalManager::from_config(&full_config());
        assert!(!mgr.needs_approval(
            "shell",
            &serde_json::json!({"command": "ls"}),
            ToolOperation::Act
        ));
        assert!(!mgr.needs_approval(
            "file_write",
            &serde_json::json!({}),
            ToolOperation::Act
        ));
        assert!(!mgr.needs_approval(
            "anything",
            &serde_json::json!({}),
            ToolOperation::Act
        ));
    }

    // ── session allowlist ────────────────────────────────────

    #[test]
    fn always_response_adds_to_session_allowlist() {
        let mgr = ApprovalManager::from_config(&supervised_config());
        assert!(mgr.needs_approval(
            "file_write",
            &serde_json::json!({"path": "test.txt"}),
            ToolOperation::Act
        ));
        assert!(!mgr.execution_is_preapproved(
            "file_write",
            &serde_json::json!({"path": "test.txt"}),
            ToolOperation::Act
        ));

        mgr.record_decision(
            "file_write",
            &serde_json::json!({"path": "test.txt"}),
            ApprovalResponse::Always,
            "cli",
        );

        // Now file_write should be in session allowlist.
        assert!(!mgr.needs_approval(
            "file_write",
            &serde_json::json!({"path": "test.txt"}),
            ToolOperation::Act
        ));
        assert!(mgr.execution_is_preapproved(
            "file_write",
            &serde_json::json!({"path": "test.txt"}),
            ToolOperation::Act
        ));
    }

    #[test]
    fn configured_tool_can_be_overridden_for_the_session() {
        let mut config = supervised_config();
        config.always_ask = vec!["file_write".into()];
        let mgr = ApprovalManager::from_config(&config);

        mgr.record_decision(
            "file_write",
            &serde_json::json!({"path": "out.txt"}),
            ApprovalResponse::Always,
            "cli",
        );

        assert!(!mgr.needs_approval(
            "file_write",
            &serde_json::json!({"path": "out.txt"}),
            ToolOperation::Act
        ));
        assert!(mgr.execution_is_preapproved(
            "file_write",
            &serde_json::json!({"path": "out.txt"}),
            ToolOperation::Act
        ));
    }

    #[test]
    fn shell_base_rule_can_be_overridden_for_the_session() {
        let mut config = supervised_config();
        config.always_ask = vec!["shell:curl".into(), "shell:wget".into()];
        let mgr = ApprovalManager::from_config(&config);

        mgr.record_decision(
            "shell",
            &serde_json::json!({"command": "curl https://example.com"}),
            ApprovalResponse::Always,
            "cli",
        );

        assert!(!mgr.needs_approval(
            "shell",
            &serde_json::json!({"command": "curl https://example.com/api"}),
            ToolOperation::Act
        ));
        assert!(mgr.execution_is_preapproved(
            "shell",
            &serde_json::json!({"command": "curl https://example.com/api"}),
            ToolOperation::Act
        ));
        assert!(mgr.needs_approval(
            "shell",
            &serde_json::json!({"command": "wget https://example.com"}),
            ToolOperation::Act
        ));
    }

    #[test]
    fn shell_exact_rule_stays_exact_for_the_session() {
        let mut config = supervised_config();
        config.always_ask = vec!["shell:python3 -m pytest".into()];
        let mgr = ApprovalManager::from_config(&config);

        mgr.record_decision(
            "shell",
            &serde_json::json!({"command": "python3 -m pytest"}),
            ApprovalResponse::Always,
            "cli",
        );

        assert!(!mgr.needs_approval(
            "shell",
            &serde_json::json!({"command": "python3   -m   pytest"}),
            ToolOperation::Act
        ));
        assert!(mgr.execution_is_preapproved(
            "shell",
            &serde_json::json!({"command": "python3   -m   pytest"}),
            ToolOperation::Act
        ));
        assert!(!mgr.execution_is_preapproved(
            "shell",
            &serde_json::json!({"command": "python3 app.py"}),
            ToolOperation::Act
        ));
    }

    #[test]
    fn auto_approve_tools_are_preapproved_for_execution() {
        let mgr = ApprovalManager::from_config(&supervised_config());
        assert!(mgr.execution_is_preapproved(
            "custom_safe_tool",
            &serde_json::json!({}),
            ToolOperation::Act
        ));
        assert!(!mgr.execution_is_preapproved(
            "glob_search",
            &serde_json::json!({}),
            ToolOperation::Read
        ));
    }

    #[test]
    fn yes_response_does_not_add_to_allowlist() {
        let mgr = ApprovalManager::from_config(&supervised_config());
        mgr.record_decision(
            "file_write",
            &serde_json::json!({}),
            ApprovalResponse::Yes,
            "cli",
        );
        assert!(mgr.needs_approval(
            "file_write",
            &serde_json::json!({}),
            ToolOperation::Act
        ));
    }

    #[test]
    fn shell_always_is_scoped_to_the_same_command() {
        let mut config = supervised_config();
        config.always_ask.clear();
        let mgr = ApprovalManager::from_config(&config);

        let allowed_command = serde_json::json!({"command": "python3 -m pytest"});
        let same_command_different_spacing = serde_json::json!({"command": "python3   -m   pytest"});
        let other_command = serde_json::json!({"command": "python3 app.py"});

        mgr.record_decision("shell", &allowed_command, ApprovalResponse::Always, "cli");

        assert!(mgr.execution_is_preapproved(
            "shell",
            &same_command_different_spacing,
            ToolOperation::Act
        ));
        assert!(!mgr.execution_is_preapproved("shell", &other_command, ToolOperation::Act));
    }

    #[test]
    fn shell_config_rule_can_require_approval_by_base_command() {
        let mut config = supervised_config();
        config.always_ask = vec!["shell:curl".into()];
        let mgr = ApprovalManager::from_config(&config);

        assert!(mgr.needs_approval(
            "shell",
            &serde_json::json!({"command": "curl https://example.com"}),
            ToolOperation::Act
        ));
        assert!(!mgr.needs_approval(
            "shell",
            &serde_json::json!({"command": "git status"}),
            ToolOperation::Act
        ));
    }

    // ── audit log ────────────────────────────────────────────

    #[test]
    fn audit_log_records_decisions() {
        let mgr = ApprovalManager::from_config(&supervised_config());

        mgr.record_decision(
            "shell",
            &serde_json::json!({"command": "rm -rf ./build/"}),
            ApprovalResponse::No,
            "cli",
        );
        mgr.record_decision(
            "file_write",
            &serde_json::json!({"path": "out.txt", "content": "hello"}),
            ApprovalResponse::Yes,
            "cli",
        );

        let log = mgr.audit_log();
        assert_eq!(log.len(), 2);
        assert_eq!(log[0].tool_name, "shell");
        assert_eq!(log[0].decision, ApprovalResponse::No);
        assert_eq!(log[1].tool_name, "file_write");
        assert_eq!(log[1].decision, ApprovalResponse::Yes);
    }

    #[test]
    fn audit_log_contains_timestamp_and_channel() {
        let mgr = ApprovalManager::from_config(&supervised_config());
        mgr.record_decision(
            "shell",
            &serde_json::json!({"command": "ls"}),
            ApprovalResponse::Yes,
            "telegram",
        );

        let log = mgr.audit_log();
        assert_eq!(log.len(), 1);
        assert!(!log[0].timestamp.is_empty());
        assert_eq!(log[0].channel, "telegram");
    }

    // ── summarize_args ───────────────────────────────────────

    #[test]
    fn summarize_args_object() {
        let args = serde_json::json!({"command": "ls -la", "cwd": "/tmp"});
        let summary = summarize_args(&args);
        assert!(summary.contains("command: ls -la"));
        assert!(summary.contains("cwd: /tmp"));
    }

    #[test]
    fn summarize_args_truncates_long_values() {
        let long_val = "x".repeat(200);
        let args = serde_json::json!({ "content": long_val });
        let summary = summarize_args(&args);
        assert!(summary.contains('…'));
        assert!(summary.len() < 200);
    }

    #[test]
    fn summarize_args_unicode_safe_truncation() {
        let long_val = "🦀".repeat(120);
        let args = serde_json::json!({ "content": long_val });
        let summary = summarize_args(&args);
        assert!(summary.contains("content:"));
        assert!(summary.contains('…'));
    }

    #[test]
    fn summarize_args_non_object() {
        let args = serde_json::json!("just a string");
        let summary = summarize_args(&args);
        assert!(summary.contains("just a string"));
    }

    // ── ApprovalResponse serde ───────────────────────────────

    #[test]
    fn approval_response_serde_roundtrip() {
        let json = serde_json::to_string(&ApprovalResponse::Always).unwrap();
        assert_eq!(json, "\"always\"");
        let parsed: ApprovalResponse = serde_json::from_str("\"no\"").unwrap();
        assert_eq!(parsed, ApprovalResponse::No);
    }

    // ── ApprovalRequest ──────────────────────────────────────

    #[test]
    fn approval_request_serde() {
        let req = ApprovalRequest {
            tool_name: "shell".into(),
            arguments: serde_json::json!({"command": "echo hi"}),
        };
        let json = serde_json::to_string(&req).unwrap();
        let parsed: ApprovalRequest = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed.tool_name, "shell");
    }
}
