use super::traits::{Tool, ToolResult};
use crate::security::SecurityPolicy;
use async_trait::async_trait;
use serde_json::json;
use std::sync::Arc;
use std::time::Duration;

const OP_TIMEOUT_SECS: u64 = 20;

pub struct OnePasswordTool {
    security: Arc<SecurityPolicy>,
}

impl OnePasswordTool {
    pub fn new(security: Arc<SecurityPolicy>) -> Self {
        Self { security }
    }

    fn op_available() -> bool {
        if let Some(path_var) = std::env::var_os("PATH") {
            for dir in std::env::split_paths(&path_var) {
                let candidate = dir.join("op");
                if candidate.is_file() {
                    return true;
                }
                #[cfg(target_os = "windows")]
                {
                    let candidate_exe = dir.join("op.exe");
                    if candidate_exe.is_file() {
                        return true;
                    }
                }
            }
        }
        false
    }

    fn parse_string_list(value: Option<&serde_json::Value>) -> anyhow::Result<Vec<String>> {
        let Some(value) = value else {
            return Ok(Vec::new());
        };
        let Some(items) = value.as_array() else {
            anyhow::bail!("'fields' must be an array of strings");
        };
        let mut out = Vec::with_capacity(items.len());
        for item in items {
            let Some(text) = item.as_str() else {
                anyhow::bail!("'fields' must contain only strings");
            };
            let trimmed = text.trim();
            if !trimmed.is_empty() {
                out.push(trimmed.to_string());
            }
        }
        Ok(out)
    }

    async fn run_op(&self, args: &[String]) -> anyhow::Result<String> {
        if !Self::op_available() {
            anyhow::bail!("1Password CLI ('op') not found in PATH");
        }
        let mut command = tokio::process::Command::new("op");
        command.args(args);
        let output = tokio::time::timeout(Duration::from_secs(OP_TIMEOUT_SECS), command.output())
            .await
            .map_err(|_| anyhow::anyhow!("1Password CLI command timed out"))??;
        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
            anyhow::bail!(if stderr.is_empty() {
                "1Password CLI command failed".to_string()
            } else {
                stderr
            });
        }
        Ok(String::from_utf8_lossy(&output.stdout).to_string())
    }

    async fn status(&self) -> anyhow::Result<ToolResult> {
        let output = self
            .run_op(&[
                "whoami".to_string(),
                "--format".to_string(),
                "json".to_string(),
            ])
            .await?;
        let parsed: serde_json::Value = serde_json::from_str(&output)?;
        Ok(ToolResult {
            success: true,
            output: serde_json::to_string_pretty(&json!({
                "logged_in": true,
                "account": parsed
            }))?,
            error: None,
        })
    }

    async fn vaults(&self) -> anyhow::Result<ToolResult> {
        let output = self
            .run_op(&[
                "vault".to_string(),
                "list".to_string(),
                "--format".to_string(),
                "json".to_string(),
            ])
            .await?;
        let parsed: serde_json::Value = serde_json::from_str(&output)?;
        Ok(ToolResult {
            success: true,
            output: serde_json::to_string_pretty(&json!({
                "vaults": parsed
            }))?,
            error: None,
        })
    }

    fn match_field_value(item: &serde_json::Value, wanted: &str) -> Option<serde_json::Value> {
        let fields = item.get("fields")?.as_array()?;
        for field in fields {
            let id_match = field
                .get("id")
                .and_then(|v| v.as_str())
                .is_some_and(|v| v.eq_ignore_ascii_case(wanted));
            let label_match = field
                .get("label")
                .and_then(|v| v.as_str())
                .is_some_and(|v| v.eq_ignore_ascii_case(wanted));
            let purpose_match = field
                .get("purpose")
                .and_then(|v| v.as_str())
                .is_some_and(|v| v.eq_ignore_ascii_case(wanted));
            if id_match || label_match || purpose_match {
                if let Some(v) = field.get("value") {
                    return Some(v.clone());
                }
            }
        }
        None
    }

    async fn item_get(
        &self,
        item: &str,
        vault: Option<&str>,
        fields: Vec<String>,
    ) -> anyhow::Result<ToolResult> {
        let mut args = vec![
            "item".to_string(),
            "get".to_string(),
            item.to_string(),
            "--format".to_string(),
            "json".to_string(),
        ];
        if let Some(vault) = vault.map(str::trim).filter(|v| !v.is_empty()) {
            args.push("--vault".to_string());
            args.push(vault.to_string());
        }

        let output = self.run_op(&args).await?;
        let parsed: serde_json::Value = serde_json::from_str(&output)?;

        if fields.is_empty() {
            return Ok(ToolResult {
                success: true,
                output: serde_json::to_string_pretty(&json!({ "item": parsed }))?,
                error: None,
            });
        }

        let mut selected = serde_json::Map::new();
        for field_name in fields {
            selected.insert(
                field_name.clone(),
                Self::match_field_value(&parsed, &field_name).unwrap_or(serde_json::Value::Null),
            );
        }

        Ok(ToolResult {
            success: true,
            output: serde_json::to_string_pretty(&json!({
                "item": {
                    "id": parsed.get("id"),
                    "title": parsed.get("title")
                },
                "fields": selected
            }))?,
            error: None,
        })
    }

    async fn read(&self, reference: &str) -> anyhow::Result<ToolResult> {
        let output = self
            .run_op(&["read".to_string(), reference.to_string()])
            .await?;
        Ok(ToolResult {
            success: true,
            output: serde_json::to_string_pretty(&json!({
                "reference": reference,
                "value": output.trim_end()
            }))?,
            error: None,
        })
    }
}

#[async_trait]
impl Tool for OnePasswordTool {
    fn name(&self) -> &str {
        "onepassword"
    }

    fn description(&self) -> &str {
        "Interact with 1Password via local 'op' CLI. Supports action='status', 'vaults', 'item_get', and 'read'."
    }

    fn parameters_schema(&self) -> serde_json::Value {
        json!({
            "type": "object",
            "properties": {
                "action": {
                    "type": "string",
                    "enum": ["status", "vaults", "item_get", "read"],
                    "description": "1Password operation to run"
                },
                "item": {
                    "type": "string",
                    "description": "Item id/title for action='item_get'"
                },
                "vault": {
                    "type": "string",
                    "description": "Optional vault id/name for action='item_get'"
                },
                "fields": {
                    "type": "array",
                    "items": { "type": "string" },
                    "description": "Optional field selectors for action='item_get' (match by id/label/purpose)"
                },
                "reference": {
                    "type": "string",
                    "description": "Secret reference for action='read' (for example: op://Vault/Item/password)"
                }
            },
            "required": ["action"]
        })
    }

    async fn execute(&self, args: serde_json::Value) -> anyhow::Result<ToolResult> {
        let action = args
            .get("action")
            .and_then(|v| v.as_str())
            .ok_or_else(|| anyhow::anyhow!("Missing 'action' parameter"))?;

        if action != "status" && !self.security.record_action() {
            return Ok(ToolResult {
                success: false,
                output: String::new(),
                error: Some("Action blocked: rate limit exceeded".into()),
            });
        }

        let result = match action {
            "status" => self.status().await,
            "vaults" => self.vaults().await,
            "item_get" => {
                let item = args
                    .get("item")
                    .and_then(|v| v.as_str())
                    .ok_or_else(|| anyhow::anyhow!("Missing 'item' parameter for item_get"))?;
                let vault = args.get("vault").and_then(|v| v.as_str());
                let fields = Self::parse_string_list(args.get("fields"))?;
                self.item_get(item, vault, fields).await
            }
            "read" => {
                let reference = args
                    .get("reference")
                    .and_then(|v| v.as_str())
                    .ok_or_else(|| anyhow::anyhow!("Missing 'reference' parameter for read"))?;
                self.read(reference).await
            }
            _ => Ok(ToolResult {
                success: false,
                output: String::new(),
                error: Some(format!(
                    "Unknown action '{action}'. Expected one of: status, vaults, item_get, read"
                )),
            }),
        };

        match result {
            Ok(ok) => Ok(ok),
            Err(err) => Ok(ToolResult {
                success: false,
                output: String::new(),
                error: Some(err.to_string()),
            }),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::security::AutonomyLevel;
    use std::path::PathBuf;

    fn tool_with_policy(autonomy: AutonomyLevel) -> OnePasswordTool {
        let security = Arc::new(SecurityPolicy {
            autonomy,
            workspace_dir: PathBuf::from("."),
            ..SecurityPolicy::default()
        });
        OnePasswordTool::new(security)
    }

    #[test]
    fn onepassword_tool_name() {
        let tool = tool_with_policy(AutonomyLevel::Full);
        assert_eq!(tool.name(), "onepassword");
    }

    #[test]
    fn onepassword_schema_actions_exist() {
        let tool = tool_with_policy(AutonomyLevel::Full);
        let schema = tool.parameters_schema();
        let actions: Vec<&str> = schema["properties"]["action"]["enum"]
            .as_array()
            .unwrap()
            .iter()
            .filter_map(|v| v.as_str())
            .collect();
        assert!(actions.contains(&"status"));
        assert!(actions.contains(&"vaults"));
        assert!(actions.contains(&"item_get"));
        assert!(actions.contains(&"read"));
    }

    #[test]
    fn parse_string_list_rejects_invalid_entries() {
        let invalid = json!(["ok", 1]);
        let result = OnePasswordTool::parse_string_list(Some(&invalid));
        assert!(result.is_err());
    }

    #[test]
    fn match_field_value_by_label() {
        let item = json!({
            "fields": [
                {"label":"username","value":"alice"},
                {"id":"password","value":"s3cr3t"}
            ]
        });
        let username = OnePasswordTool::match_field_value(&item, "username");
        assert_eq!(username, Some(json!("alice")));
    }

}
