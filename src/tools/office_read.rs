use super::traits::{Tool, ToolResult};
use crate::security::policy::ToolOperation;
use crate::security::SecurityPolicy;
use async_trait::async_trait;
use serde_json::json;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;

/// Maximum OfficeCLI execution time before kill.
const OFFICECLI_TIMEOUT_SECS: u64 = 60;
/// Default character limit returned to the LLM.
const DEFAULT_MAX_CHARS: usize = 50_000;
/// Hard ceiling regardless of what the caller requests.
const MAX_OUTPUT_CHARS: usize = 200_000;
/// Environment variables safe to pass to OfficeCLI.
const SAFE_ENV_VARS: &[&str] = &[
    "PATH", "HOME", "TERM", "LANG", "LC_ALL", "LC_CTYPE", "USER", "SHELL", "TMPDIR",
];
const SUPPORTED_EXTENSIONS: &[&str] = &["docx", "pptx", "xlsx"];
const OFFICECLI_ENV_VAR: &str = "ZEROCLAW_OFFICECLI_PATH";

pub struct OfficeReadTool {
    security: Arc<SecurityPolicy>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum OfficeReadMode {
    Text,
    Outline,
    Annotated,
    Stats,
    Json,
}

impl OfficeReadMode {
    fn parse(raw: Option<&str>) -> anyhow::Result<Self> {
        match raw.unwrap_or("text") {
            "text" => Ok(Self::Text),
            "outline" => Ok(Self::Outline),
            "annotated" => Ok(Self::Annotated),
            "stats" => Ok(Self::Stats),
            "json" => Ok(Self::Json),
            other => anyhow::bail!(
                "Unsupported 'mode': {other}. Expected one of: text, outline, annotated, stats, json"
            ),
        }
    }

    fn command_args(self, resolved_path: &Path, target: &str) -> Vec<String> {
        let file = resolved_path.to_string_lossy().to_string();
        match self {
            Self::Json => vec!["get".into(), file, target.to_string(), "--json".into()],
            Self::Text => vec!["view".into(), file, "text".into()],
            Self::Outline => vec!["view".into(), file, "outline".into()],
            Self::Annotated => vec!["view".into(), file, "annotated".into()],
            Self::Stats => vec!["view".into(), file, "stats".into()],
        }
    }
}

impl OfficeReadTool {
    pub fn new(security: Arc<SecurityPolicy>) -> Self {
        Self { security }
    }

    fn extension_is_supported(path: &Path) -> bool {
        path.extension()
            .and_then(|ext| ext.to_str())
            .map(|ext| ext.to_ascii_lowercase())
            .is_some_and(|ext| SUPPORTED_EXTENSIONS.contains(&ext.as_str()))
    }

    fn truncate_output(output: String, max_chars: usize) -> String {
        if output.chars().count() <= max_chars {
            return output;
        }

        let mut truncated: String = output.chars().take(max_chars).collect();
        use std::fmt::Write as _;
        let _ = write!(truncated, "\n\n... [truncated at {max_chars} chars]");
        truncated
    }

    fn resolve_officecli_path() -> Option<PathBuf> {
        if let Ok(configured) = std::env::var(OFFICECLI_ENV_VAR) {
            let trimmed = configured.trim();
            if !trimmed.is_empty() {
                let candidate = PathBuf::from(trimmed);
                if candidate.is_file() {
                    return Some(candidate);
                }
                tracing::warn!(
                    "Ignoring invalid {OFFICECLI_ENV_VAR} path because the file does not exist: {}",
                    candidate.display()
                );
            }
        }
        None
    }
}

#[async_trait]
impl Tool for OfficeReadTool {
    fn name(&self) -> &str {
        "office_read"
    }

    fn description(&self) -> &str {
        "Read DOCX, XLSX, and PPTX files through OfficeCLI. \
         Supports text, outline, annotated, stats, and structured JSON output. \
         Requires the desktop app to provide a bundled OfficeCLI binary."
    }

    fn parameters_schema(&self) -> serde_json::Value {
        json!({
            "type": "object",
            "properties": {
                "path": {
                    "type": "string",
                    "description": "Path to a DOCX, XLSX, or PPTX file. Relative paths resolve from workspace; outside paths require policy allowlist."
                },
                "mode": {
                    "type": "string",
                    "enum": ["text", "outline", "annotated", "stats", "json"],
                    "description": "Read mode. Use 'json' for structured element inspection via OfficeCLI get --json. Default: text."
                },
                "target": {
                    "type": "string",
                    "description": "Element path used only when mode='json'. Default: '/'."
                },
                "max_chars": {
                    "type": "integer",
                    "description": "Maximum characters to return (default: 50000, max: 200000).",
                    "minimum": 1,
                    "maximum": 200000
                }
            },
            "required": ["path"]
        })
    }

    fn operation(&self, _args: &serde_json::Value) -> ToolOperation {
        ToolOperation::Read
    }

    async fn execute(&self, args: serde_json::Value) -> anyhow::Result<ToolResult> {
        let path = args
            .get("path")
            .and_then(|v| v.as_str())
            .ok_or_else(|| anyhow::anyhow!("Missing 'path' parameter"))?;
        let mode = OfficeReadMode::parse(args.get("mode").and_then(|v| v.as_str()))?;
        let target = args.get("target").and_then(|v| v.as_str()).unwrap_or("/");
        let max_chars = args
            .get("max_chars")
            .and_then(|v| v.as_u64())
            .map(|n| {
                usize::try_from(n)
                    .unwrap_or(MAX_OUTPUT_CHARS)
                    .min(MAX_OUTPUT_CHARS)
            })
            .unwrap_or(DEFAULT_MAX_CHARS);

        if self.security.is_rate_limited() {
            return Ok(ToolResult {
                success: false,
                output: String::new(),
                error: Some("Rate limit exceeded: too many actions in the last hour".into()),
            });
        }

        if !self.security.is_path_allowed(path) {
            return Ok(ToolResult {
                success: false,
                output: String::new(),
                error: Some(format!("Path not allowed by security policy: {path}")),
            });
        }

        if !self.security.record_action() {
            return Ok(ToolResult {
                success: false,
                output: String::new(),
                error: Some("Rate limit exceeded: action budget exhausted".into()),
            });
        }

        let full_path = self.security.workspace_dir.join(path);
        if !Self::extension_is_supported(&full_path) {
            return Ok(ToolResult {
                success: false,
                output: String::new(),
                error: Some(
                    "Unsupported Office file type. Supported extensions: .docx, .pptx, .xlsx"
                        .into(),
                ),
            });
        }

        let resolved_path = match tokio::fs::canonicalize(&full_path).await {
            Ok(path) => path,
            Err(error) => {
                return Ok(ToolResult {
                    success: false,
                    output: String::new(),
                    error: Some(format!("Failed to resolve file path: {error}")),
                });
            }
        };

        if !self.security.is_resolved_path_allowed(&resolved_path) {
            return Ok(ToolResult {
                success: false,
                output: String::new(),
                error: Some(
                    self.security
                        .resolved_path_violation_message(&resolved_path),
                ),
            });
        }

        if !Self::extension_is_supported(&resolved_path) {
            return Ok(ToolResult {
                success: false,
                output: String::new(),
                error: Some(
                    "Unsupported Office file type. Supported extensions: .docx, .pptx, .xlsx"
                        .into(),
                ),
            });
        }

        let officecli_path = if let Some(path) = Self::resolve_officecli_path() {
            path
        } else {
            return Ok(ToolResult {
                success: false,
                output: String::new(),
                error: Some(
                    format!(
                        "OfficeCLI is unavailable. Expected the desktop app to inject a bundled binary path via {OFFICECLI_ENV_VAR}."
                    ),
                ),
            });
        };

        let mut command = tokio::process::Command::new(officecli_path);
        command.args(mode.command_args(&resolved_path, target));
        command.env_clear();
        command.stdin(std::process::Stdio::null());
        for var in SAFE_ENV_VARS {
            if let Ok(value) = std::env::var(var) {
                command.env(var, value);
            }
        }

        let result = tokio::time::timeout(
            Duration::from_secs(OFFICECLI_TIMEOUT_SECS),
            command.output(),
        )
        .await;

        match result {
            Ok(Ok(output)) => {
                let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
                let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();

                if !output.status.success() {
                    let error = if stderr.is_empty() {
                        format!("OfficeCLI exited with status {}", output.status)
                    } else {
                        format!("OfficeCLI failed: {stderr}")
                    };
                    return Ok(ToolResult {
                        success: false,
                        output: stdout,
                        error: Some(error),
                    });
                }

                let rendered = if stdout.is_empty() {
                    "OfficeCLI returned no readable output".to_string()
                } else {
                    stdout
                };

                Ok(ToolResult {
                    success: true,
                    output: Self::truncate_output(rendered, max_chars),
                    error: None,
                })
            }
            Ok(Err(error)) => Ok(ToolResult {
                success: false,
                output: String::new(),
                error: Some(format!("Failed to execute OfficeCLI: {error}")),
            }),
            Err(_) => Ok(ToolResult {
                success: false,
                output: String::new(),
                error: Some(format!(
                    "OfficeCLI timed out after {OFFICECLI_TIMEOUT_SECS}s and was killed"
                )),
            }),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::security::{AutonomyLevel, SecurityPolicy, policy::ToolOperation};
    use tempfile::TempDir;

    fn test_security(workspace: std::path::PathBuf) -> Arc<SecurityPolicy> {
        Arc::new(SecurityPolicy {
            autonomy: AutonomyLevel::Supervised,
            workspace_dir: workspace,
            ..SecurityPolicy::default()
        })
    }

    fn test_security_with_limit(
        workspace: std::path::PathBuf,
        max_actions: u32,
    ) -> Arc<SecurityPolicy> {
        Arc::new(SecurityPolicy {
            autonomy: AutonomyLevel::Supervised,
            workspace_dir: workspace,
            ..SecurityPolicy::default()
        })
    }

    #[test]
    fn name_is_office_read() {
        let tool = OfficeReadTool::new(test_security(std::env::temp_dir()));
        assert_eq!(tool.name(), "office_read");
    }

    #[test]
    fn schema_has_expected_modes() {
        let tool = OfficeReadTool::new(test_security(std::env::temp_dir()));
        let schema = tool.parameters_schema();
        assert_eq!(schema["properties"]["mode"]["enum"][0], "text");
        assert_eq!(schema["properties"]["mode"]["enum"][4], "json");
    }

    #[test]
    fn office_read_is_read_only_operation() {
        let tool = OfficeReadTool::new(test_security(std::env::temp_dir()));
        assert_eq!(tool.operation(&json!({})), ToolOperation::Read);
    }

    #[test]
    fn command_args_use_view_and_get_layouts() {
        let path = Path::new("/tmp/test.docx");
        assert_eq!(
            OfficeReadMode::Text.command_args(path, "/"),
            vec!["view", "/tmp/test.docx", "text"]
        );
        assert_eq!(
            OfficeReadMode::Json.command_args(path, "/body/p[1]"),
            vec!["get", "/tmp/test.docx", "/body/p[1]", "--json"]
        );
    }

    #[test]
    fn supported_extensions_match_office_formats() {
        assert!(OfficeReadTool::extension_is_supported(Path::new(
            "report.docx"
        )));
        assert!(OfficeReadTool::extension_is_supported(Path::new(
            "sheet.XLSX"
        )));
        assert!(OfficeReadTool::extension_is_supported(Path::new(
            "deck.pptx"
        )));
        assert!(!OfficeReadTool::extension_is_supported(Path::new(
            "notes.txt"
        )));
    }

    #[tokio::test]
    async fn missing_path_param_returns_error() {
        let tool = OfficeReadTool::new(test_security(std::env::temp_dir()));
        let result = tool.execute(json!({})).await;
        assert!(result.is_err());
        assert!(result.unwrap_err().to_string().contains("path"));
    }

    #[tokio::test]
    async fn absolute_path_is_blocked() {
        let tool = OfficeReadTool::new(test_security(std::env::temp_dir()));
        let result = tool
            .execute(json!({"path": "/tmp/report.docx"}))
            .await
            .unwrap();
        assert!(!result.success);
        assert!(result
            .error
            .as_deref()
            .unwrap_or("")
            .contains("not allowed"));
    }

    #[tokio::test]
    async fn unsupported_extension_returns_error() {
        let tmp = TempDir::new().unwrap();
        let file = tmp.path().join("notes.txt");
        tokio::fs::write(&file, b"hello").await.unwrap();

        let tool = OfficeReadTool::new(test_security(tmp.path().to_path_buf()));
        let result = tool.execute(json!({"path": "notes.txt"})).await.unwrap();

        assert!(!result.success);
        assert!(result
            .error
            .as_deref()
            .unwrap_or("")
            .contains("Unsupported Office file type"));
    }

    #[tokio::test]
    async fn rate_limit_blocks_request() {
        let tmp = TempDir::new().unwrap();
        let tool = OfficeReadTool::new(test_security_with_limit(tmp.path().to_path_buf(), 0));
        let result = tool.execute(json!({"path": "doc.docx"})).await.unwrap();
        assert!(!result.success);
        assert!(result.error.as_deref().unwrap_or("").contains("Rate limit"));
    }
}
