use super::traits::{Tool, ToolResult};
use crate::security::SecurityPolicy;
use async_trait::async_trait;
use serde_json::json;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;

const OFFICECLI_TIMEOUT_SECS: u64 = 60;
const SAFE_ENV_VARS: &[&str] = &[
    "PATH", "HOME", "TERM", "LANG", "LC_ALL", "LC_CTYPE", "USER", "SHELL", "TMPDIR",
];
const SUPPORTED_EXTENSIONS: &[&str] = &["docx", "pptx", "xlsx"];
const OFFICECLI_ENV_VAR: &str = "ZEROCLAW_OFFICECLI_PATH";

#[derive(Clone, Copy)]
enum OperationKind {
    Read,
    Write,
}

fn extension_is_supported(path: &Path) -> bool {
    path.extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| ext.to_ascii_lowercase())
        .is_some_and(|ext| SUPPORTED_EXTENSIONS.contains(&ext.as_str()))
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

async fn resolve_office_output_path(
    security: &SecurityPolicy,
    path: &str,
    require_existing: bool,
) -> anyhow::Result<PathBuf> {
    if !security.is_path_allowed(path) {
        anyhow::bail!("Path not allowed by security policy: {path}");
    }

    let full_path = security.workspace_dir.join(path);
    let Some(parent) = full_path.parent() else {
        anyhow::bail!("Invalid path: missing parent directory");
    };

    tokio::fs::create_dir_all(parent).await?;
    let resolved_parent = tokio::fs::canonicalize(parent).await?;
    if !security.is_resolved_path_allowed(&resolved_parent) {
        anyhow::bail!(
            "{}",
            security.resolved_path_violation_message(&resolved_parent)
        );
    }

    let Some(file_name) = full_path.file_name() else {
        anyhow::bail!("Invalid path: missing file name");
    };
    let resolved_target = resolved_parent.join(file_name);

    if let Ok(meta) = tokio::fs::symlink_metadata(&resolved_target).await {
        if meta.file_type().is_symlink() {
            anyhow::bail!(
                "Refusing to operate through symlink: {}",
                resolved_target.display()
            );
        }
    }

    if require_existing && tokio::fs::metadata(&resolved_target).await.is_err() {
        anyhow::bail!(
            "Target Office file does not exist: {}",
            resolved_target.display()
        );
    }

    if !extension_is_supported(&resolved_target) {
        anyhow::bail!("Unsupported Office file type. Supported extensions: .docx, .pptx, .xlsx");
    }

    Ok(resolved_target)
}

async fn run_officecli(
    security: &SecurityPolicy,
    operation: OperationKind,
    args: Vec<String>,
) -> anyhow::Result<ToolResult> {
    match operation {
        OperationKind::Read => {
            if security.is_rate_limited() {
                return Ok(ToolResult {
                    success: false,
                    output: String::new(),
                    error: Some("Rate limit exceeded: too many actions in the last hour".into()),
                });
            }
        }
        OperationKind::Write => {
            if security.is_rate_limited() {
                return Ok(ToolResult {
                    success: false,
                    output: String::new(),
                    error: Some("Rate limit exceeded: too many actions in the last hour".into()),
                });
            }
            if !security.record_action() {
                return Ok(ToolResult {
                    success: false,
                    output: String::new(),
                    error: Some("Rate limit exceeded: action budget exhausted".into()),
                });
            }
        }
    }

    let Some(officecli_path) = resolve_officecli_path() else {
        return Ok(ToolResult {
            success: false,
            output: String::new(),
            error: Some(format!(
                "OfficeCLI is unavailable. Expected the desktop app to inject a bundled binary path via {OFFICECLI_ENV_VAR}."
            )),
        });
    };

    let mut command = tokio::process::Command::new(officecli_path);
    command.args(&args);
    command.env_clear();
    command.stdin(std::process::Stdio::null());
    for var in SAFE_ENV_VARS {
        if let Ok(value) = std::env::var(var) {
            command.env(var, value);
        }
    }

    match tokio::time::timeout(
        Duration::from_secs(OFFICECLI_TIMEOUT_SECS),
        command.output(),
    )
    .await
    {
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

            Ok(ToolResult {
                success: true,
                output: if stdout.is_empty() {
                    "OfficeCLI completed successfully".to_string()
                } else {
                    stdout
                },
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

pub struct OfficeCreateTool {
    security: Arc<SecurityPolicy>,
}

impl OfficeCreateTool {
    pub fn new(security: Arc<SecurityPolicy>) -> Self {
        Self { security }
    }
}

#[async_trait]
impl Tool for OfficeCreateTool {
    fn name(&self) -> &str {
        "office_create"
    }

    fn description(&self) -> &str {
        "Create a blank DOCX, PPTX, or XLSX file through OfficeCLI."
    }

    fn parameters_schema(&self) -> serde_json::Value {
        json!({
            "type": "object",
            "properties": {
                "path": {
                    "type": "string",
                    "description": "Output Office file path inside workspace, ending with .docx, .pptx, or .xlsx."
                }
            },
            "required": ["path"]
        })
    }

    async fn execute(&self, args: serde_json::Value) -> anyhow::Result<ToolResult> {
        let path = args
            .get("path")
            .and_then(|v| v.as_str())
            .ok_or_else(|| anyhow::anyhow!("Missing 'path' parameter"))?;
        let resolved_target = resolve_office_output_path(&self.security, path, false).await?;
        let command_args = vec![
            "create".to_string(),
            resolved_target.to_string_lossy().to_string(),
        ];
        run_officecli(&self.security, OperationKind::Write, command_args).await
    }
}

pub struct OfficeQueryTool {
    security: Arc<SecurityPolicy>,
}

impl OfficeQueryTool {
    pub fn new(security: Arc<SecurityPolicy>) -> Self {
        Self { security }
    }
}

#[async_trait]
impl Tool for OfficeQueryTool {
    fn name(&self) -> &str {
        "office_query"
    }

    fn description(&self) -> &str {
        "Query DOCX, PPTX, and XLSX structure with OfficeCLI selectors."
    }

    fn parameters_schema(&self) -> serde_json::Value {
        json!({
            "type": "object",
            "properties": {
                "path": {
                    "type": "string",
                    "description": "Path to an existing DOCX, XLSX, or PPTX file."
                },
                "selector": {
                    "type": "string",
                    "description": "OfficeCLI selector expression, for example 'paragraph[style=Heading1]' or 'shape[fill=FF0000]'."
                }
            },
            "required": ["path", "selector"]
        })
    }

    async fn execute(&self, args: serde_json::Value) -> anyhow::Result<ToolResult> {
        let path = args
            .get("path")
            .and_then(|v| v.as_str())
            .ok_or_else(|| anyhow::anyhow!("Missing 'path' parameter"))?;
        let selector = args
            .get("selector")
            .and_then(|v| v.as_str())
            .ok_or_else(|| anyhow::anyhow!("Missing 'selector' parameter"))?;
        let resolved_target = resolve_office_output_path(&self.security, path, true).await?;
        let command_args = vec![
            "query".to_string(),
            resolved_target.to_string_lossy().to_string(),
            selector.to_string(),
        ];
        run_officecli(&self.security, OperationKind::Read, command_args).await
    }
}

pub struct OfficeSetTool {
    security: Arc<SecurityPolicy>,
}

impl OfficeSetTool {
    pub fn new(security: Arc<SecurityPolicy>) -> Self {
        Self { security }
    }
}

#[async_trait]
impl Tool for OfficeSetTool {
    fn name(&self) -> &str {
        "office_set"
    }

    fn description(&self) -> &str {
        "Modify Office document elements in place through OfficeCLI set --prop operations."
    }

    fn parameters_schema(&self) -> serde_json::Value {
        json!({
            "type": "object",
            "properties": {
                "path": {
                    "type": "string",
                    "description": "Path to an existing DOCX, XLSX, or PPTX file."
                },
                "target": {
                    "type": "string",
                    "description": "Element path inside the Office document, for example '/body/p[1]' or '/slide[1]/shape[2]'."
                },
                "props": {
                    "type": "object",
                    "description": "Property map converted to repeated --prop key=value arguments."
                }
            },
            "required": ["path", "target", "props"]
        })
    }

    async fn execute(&self, args: serde_json::Value) -> anyhow::Result<ToolResult> {
        let path = args
            .get("path")
            .and_then(|v| v.as_str())
            .ok_or_else(|| anyhow::anyhow!("Missing 'path' parameter"))?;
        let target = args
            .get("target")
            .and_then(|v| v.as_str())
            .ok_or_else(|| anyhow::anyhow!("Missing 'target' parameter"))?;
        let props = args
            .get("props")
            .and_then(|v| v.as_object())
            .ok_or_else(|| anyhow::anyhow!("Missing 'props' object parameter"))?;
        if props.is_empty() {
            anyhow::bail!("'props' must contain at least one property");
        }

        let resolved_target = resolve_office_output_path(&self.security, path, true).await?;
        let mut command_args = vec![
            "set".to_string(),
            resolved_target.to_string_lossy().to_string(),
            target.to_string(),
        ];
        for (key, value) in props {
            let rendered = match value {
                serde_json::Value::String(v) => v.clone(),
                _ => value.to_string(),
            };
            command_args.push("--prop".to_string());
            command_args.push(format!("{key}={rendered}"));
        }
        run_officecli(&self.security, OperationKind::Write, command_args).await
    }
}

pub struct OfficeAddTool {
    security: Arc<SecurityPolicy>,
}

impl OfficeAddTool {
    pub fn new(security: Arc<SecurityPolicy>) -> Self {
        Self { security }
    }
}

#[async_trait]
impl Tool for OfficeAddTool {
    fn name(&self) -> &str {
        "office_add"
    }

    fn description(&self) -> &str {
        "Add elements to DOCX, PPTX, and XLSX files through OfficeCLI add operations."
    }

    fn parameters_schema(&self) -> serde_json::Value {
        json!({
            "type": "object",
            "properties": {
                "path": {
                    "type": "string",
                    "description": "Path to an existing DOCX, XLSX, or PPTX file."
                },
                "parent": {
                    "type": "string",
                    "description": "Parent path inside the Office document where the new element should be added."
                },
                "element_type": {
                    "type": "string",
                    "description": "OfficeCLI element type, for example slide, shape, paragraph, row, cell, chart."
                },
                "props": {
                    "type": "object",
                    "description": "Property map converted to repeated --prop key=value arguments."
                }
            },
            "required": ["path", "parent", "element_type"]
        })
    }

    async fn execute(&self, args: serde_json::Value) -> anyhow::Result<ToolResult> {
        let path = args
            .get("path")
            .and_then(|v| v.as_str())
            .ok_or_else(|| anyhow::anyhow!("Missing 'path' parameter"))?;
        let parent = args
            .get("parent")
            .and_then(|v| v.as_str())
            .ok_or_else(|| anyhow::anyhow!("Missing 'parent' parameter"))?;
        let element_type = args
            .get("element_type")
            .and_then(|v| v.as_str())
            .ok_or_else(|| anyhow::anyhow!("Missing 'element_type' parameter"))?;
        let props = args.get("props").and_then(|v| v.as_object());

        let resolved_target = resolve_office_output_path(&self.security, path, true).await?;
        let mut command_args = vec![
            "add".to_string(),
            resolved_target.to_string_lossy().to_string(),
            parent.to_string(),
            "--type".to_string(),
            element_type.to_string(),
        ];
        if let Some(props) = props {
            for (key, value) in props {
                let rendered = match value {
                    serde_json::Value::String(v) => v.clone(),
                    _ => value.to_string(),
                };
                command_args.push("--prop".to_string());
                command_args.push(format!("{key}={rendered}"));
            }
        }
        run_officecli(&self.security, OperationKind::Write, command_args).await
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::security::{AutonomyLevel, SecurityPolicy};
    use tempfile::TempDir;

    fn test_security(workspace: std::path::PathBuf) -> Arc<SecurityPolicy> {
        Arc::new(SecurityPolicy {
            autonomy: AutonomyLevel::Supervised,
            workspace_dir: workspace,
            ..SecurityPolicy::default()
        })
    }

    #[test]
    fn create_tool_has_expected_name() {
        let tool = OfficeCreateTool::new(test_security(std::env::temp_dir()));
        assert_eq!(tool.name(), "office_create");
    }

    #[test]
    fn query_tool_has_expected_name() {
        let tool = OfficeQueryTool::new(test_security(std::env::temp_dir()));
        assert_eq!(tool.name(), "office_query");
    }

    #[test]
    fn set_tool_has_expected_name() {
        let tool = OfficeSetTool::new(test_security(std::env::temp_dir()));
        assert_eq!(tool.name(), "office_set");
    }

    #[test]
    fn add_tool_has_expected_name() {
        let tool = OfficeAddTool::new(test_security(std::env::temp_dir()));
        assert_eq!(tool.name(), "office_add");
    }

    #[tokio::test]
    async fn resolve_output_path_rejects_outside_path() {
        let security = test_security(std::env::temp_dir());
        let result = resolve_office_output_path(&security, "/tmp/report.docx", false).await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn resolve_output_path_accepts_supported_extension() {
        let tmp = TempDir::new().unwrap();
        let security = test_security(tmp.path().to_path_buf());
        let resolved = resolve_office_output_path(&security, "slides/demo.pptx", false)
            .await
            .unwrap();
        assert!(resolved.ends_with("slides/demo.pptx"));
    }

    #[tokio::test]
    async fn resolve_output_path_requires_existing_when_requested() {
        let tmp = TempDir::new().unwrap();
        let security = test_security(tmp.path().to_path_buf());
        let result = resolve_office_output_path(&security, "missing.xlsx", true).await;
        assert!(result.is_err());
    }
}
