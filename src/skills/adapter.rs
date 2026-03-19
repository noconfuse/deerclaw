use crate::runtime::RuntimeAdapter;
use crate::security::SecurityPolicy;
use crate::skills::SkillTool;
use crate::tools::{Tool, ToolResult};
use async_trait::async_trait;
use serde_json::Value;
use std::sync::Arc;

pub struct SkillProxyTool {
    tool: SkillTool,
    runtime: Arc<dyn RuntimeAdapter>,
    security: Arc<SecurityPolicy>,
}

impl SkillProxyTool {
    pub fn new(
        tool: SkillTool,
        runtime: Arc<dyn RuntimeAdapter>,
        security: Arc<SecurityPolicy>,
    ) -> Self {
        Self {
            tool,
            runtime,
            security,
        }
    }
}

#[async_trait]
impl Tool for SkillProxyTool {
    fn name(&self) -> &str {
        &self.tool.name
    }

    fn description(&self) -> &str {
        &self.tool.description
    }

    fn parameters_schema(&self) -> Value {
        serde_json::json!({
            "type": "object",
            "properties": {
                "args": {
                    "type": "string",
                    "description": "Optional arguments to append to the command"
                },
                "approved": {
                    "type": "boolean",
                    "description": "Set true to explicitly approve medium/high-risk commands",
                    "default": false
                }
            }
        })
    }

    async fn execute(&self, args: Value) -> anyhow::Result<ToolResult> {
        if self.tool.kind != "shell" {
            return Ok(ToolResult {
                success: false,
                output: String::new(),
                error: Some(format!("Unsupported tool kind: {}", self.tool.kind)),
            });
        }

        let extra_args = args
            .get("args")
            .and_then(|v| v.as_str())
            .unwrap_or_default();

        let approved = args
            .get("approved")
            .and_then(|v| v.as_bool())
            .unwrap_or(false);

        let full_command = if extra_args.is_empty() {
            self.tool.command.clone()
        } else {
            format!("{} {}", self.tool.command, extra_args)
        };

        if let Err(e) = self
            .security
            .validate_command_execution(&full_command, approved)
        {
            return Ok(ToolResult {
                success: false,
                output: String::new(),
                error: Some(format!("Security policy violation: {}", e)),
            });
        }

        let mut cmd = self
            .runtime
            .build_shell_command(&full_command, &self.security.workspace_dir)?;

        // Inject configured env vars from SkillTool
        for (k, v) in &self.tool.args {
            cmd.env(k, v);
        }

        let output = cmd.output().await?;
        let stdout = String::from_utf8_lossy(&output.stdout).to_string();
        let stderr = String::from_utf8_lossy(&output.stderr).to_string();

        Ok(ToolResult {
            success: output.status.success(),
            output: stdout,
            error: if stderr.is_empty() {
                None
            } else {
                Some(stderr)
            },
        })
    }
}
