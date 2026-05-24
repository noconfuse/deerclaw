use super::traits::{Tool, ToolResult};
use crate::security::SecurityPolicy;
use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::path::{Component, Path, PathBuf};
use std::sync::Arc;

const MAX_PREVIEW_CHARS: usize = 4000;

#[derive(Clone)]
pub struct CanvasTool {
    security: Arc<SecurityPolicy>,
    workspace_dir: PathBuf,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct CanvasState {
    current_target: String,
}

#[derive(Debug, Clone)]
enum ResolvedTarget {
    External(String),
    Local { path: PathBuf, url: String },
}

impl CanvasTool {
    pub fn new(security: Arc<SecurityPolicy>, workspace_dir: PathBuf) -> Self {
        Self {
            security,
            workspace_dir,
        }
    }

    fn validate_session(session: &str) -> anyhow::Result<String> {
        let session = session.trim();
        if session.is_empty() {
            anyhow::bail!("session must not be empty");
        }
        if session.len() > 64 {
            anyhow::bail!("session must be <= 64 characters");
        }
        if !session
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || ch == '-' || ch == '_')
        {
            anyhow::bail!("session may only contain letters, digits, '-' and '_'");
        }
        Ok(session.to_string())
    }

    fn canvas_root(&self, session: &str) -> PathBuf {
        self.workspace_dir.join("canvas").join(session)
    }

    fn state_path(&self, session: &str) -> PathBuf {
        self.canvas_root(session).join(".canvas_state.json")
    }

    fn index_path(&self, session: &str) -> PathBuf {
        self.canvas_root(session).join("index.html")
    }

    fn scaffold_html() -> &'static str {
        "<!doctype html><html><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><title>Canvas</title><style>body{font-family:-apple-system,BlinkMacSystemFont,\"Segoe UI\",sans-serif;margin:24px;background:#0b1020;color:#e6edf3}h1{margin:0 0 12px;font-size:24px}p{opacity:.9}</style></head><body><h1>Canvas Ready</h1><p>This session is ready for agent-driven UI updates.</p></body></html>"
    }

    fn file_url(path: &Path) -> String {
        format!("file://{}", path.display())
    }

    async fn ensure_session(&self, session: &str) -> anyhow::Result<PathBuf> {
        let root = self.canvas_root(session);
        tokio::fs::create_dir_all(&root).await?;
        let index = self.index_path(session);
        if tokio::fs::metadata(&index).await.is_err() {
            tokio::fs::write(&index, Self::scaffold_html()).await?;
        }
        Ok(root)
    }

    async fn load_state(&self, session: &str) -> anyhow::Result<Option<CanvasState>> {
        let state_path = self.state_path(session);
        match tokio::fs::read_to_string(&state_path).await {
            Ok(content) => Ok(Some(serde_json::from_str::<CanvasState>(&content)?)),
            Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(None),
            Err(err) => Err(err.into()),
        }
    }

    async fn save_state(&self, session: &str, state: &CanvasState) -> anyhow::Result<()> {
        let state_path = self.state_path(session);
        let content = serde_json::to_string_pretty(state)?;
        tokio::fs::write(state_path, content).await?;
        Ok(())
    }

    fn valid_local_relative(path: &str) -> bool {
        !Path::new(path)
            .components()
            .any(|component| matches!(component, Component::ParentDir))
    }

    fn resolve_target(&self, session: &str, target: &str) -> anyhow::Result<ResolvedTarget> {
        let target = target.trim();
        if target.is_empty() {
            anyhow::bail!("url must not be empty");
        }
        if target.starts_with("http://")
            || target.starts_with("https://")
            || target.starts_with("file://")
        {
            return Ok(ResolvedTarget::External(target.to_string()));
        }

        let normalized = if target == "/" {
            "index.html".to_string()
        } else {
            target.trim_start_matches('/').to_string()
        };
        if normalized.is_empty() {
            anyhow::bail!("invalid local target");
        }
        if !Self::valid_local_relative(&normalized) {
            anyhow::bail!("local target cannot contain '..'");
        }
        let path = self.canvas_root(session).join(&normalized);
        let url = Self::file_url(&path);
        Ok(ResolvedTarget::Local { path, url })
    }

    async fn action_present(&self, session: &str) -> anyhow::Result<ToolResult> {
        let root = self.ensure_session(session).await?;
        let index = self.index_path(session);
        let existing_state = self.load_state(session).await?;
        let state = existing_state.unwrap_or(CanvasState {
            current_target: Self::file_url(&index),
        });
        self.save_state(session, &state).await?;

        Ok(ToolResult {
            success: true,
            output: serde_json::to_string_pretty(&json!({
                "session": session,
                "canvas_root": root.display().to_string(),
                "current_target": state.current_target
            }))?,
            error: None,
        })
    }

    async fn action_navigate(&self, session: &str, target: &str) -> anyhow::Result<ToolResult> {
        self.ensure_session(session).await?;
        let resolved = self.resolve_target(session, target)?;
        let current_target = match resolved {
            ResolvedTarget::External(url) => url,
            ResolvedTarget::Local { path, url } => {
                if let Some(parent) = path.parent() {
                    tokio::fs::create_dir_all(parent).await?;
                }
                if tokio::fs::metadata(&path).await.is_err() {
                    if path.extension().and_then(|s| s.to_str()) == Some("html") {
                        tokio::fs::write(&path, Self::scaffold_html()).await?;
                    } else {
                        tokio::fs::write(&path, "").await?;
                    }
                }
                url
            }
        };

        let state = CanvasState {
            current_target: current_target.clone(),
        };
        self.save_state(session, &state).await?;

        Ok(ToolResult {
            success: true,
            output: serde_json::to_string_pretty(&json!({
                "session": session,
                "current_target": current_target
            }))?,
            error: None,
        })
    }

    async fn action_snapshot(&self, session: &str) -> anyhow::Result<ToolResult> {
        let state = self.load_state(session).await?;
        let fallback_target = Self::file_url(&self.index_path(session));
        let current_target = state.map(|s| s.current_target).unwrap_or(fallback_target);

        if let Some(local_path) = current_target.strip_prefix("file://") {
            let local_path = PathBuf::from(local_path);
            let metadata = tokio::fs::metadata(&local_path).await;
            match metadata {
                Ok(meta) => {
                    let content = tokio::fs::read_to_string(&local_path).await.ok();
                    let preview = content.map(|mut text| {
                        if text.len() > MAX_PREVIEW_CHARS {
                            text.truncate(text.floor_char_boundary(MAX_PREVIEW_CHARS));
                        }
                        text
                    });
                    return Ok(ToolResult {
                        success: true,
                        output: serde_json::to_string_pretty(&json!({
                            "session": session,
                            "current_target": current_target,
                            "exists": true,
                            "size_bytes": meta.len(),
                            "preview": preview
                        }))?,
                        error: None,
                    });
                }
                Err(err) if err.kind() == std::io::ErrorKind::NotFound => {
                    return Ok(ToolResult {
                        success: false,
                        output: serde_json::to_string_pretty(&json!({
                            "session": session,
                            "current_target": current_target,
                            "exists": false
                        }))?,
                        error: Some("Current canvas target does not exist".to_string()),
                    });
                }
                Err(err) => return Err(err.into()),
            }
        }

        Ok(ToolResult {
            success: true,
            output: serde_json::to_string_pretty(&json!({
                "session": session,
                "current_target": current_target,
                "exists": true,
                "preview": serde_json::Value::Null
            }))?,
            error: None,
        })
    }
}

#[async_trait]
impl Tool for CanvasTool {
    fn name(&self) -> &str {
        "canvas"
    }

    fn description(&self) -> &str {
        "Manage a local visual canvas session. Supports action='present' (create/open session), action='navigate' (set target URL/path), and action='snapshot' (return current target metadata and preview)."
    }

    fn parameters_schema(&self) -> serde_json::Value {
        json!({
            "type": "object",
            "properties": {
                "action": {
                    "type": "string",
                    "enum": ["present", "navigate", "snapshot"],
                    "description": "Canvas operation"
                },
                "session": {
                    "type": "string",
                    "description": "Canvas session name (letters, digits, '-' and '_'). Default: 'main'"
                },
                "url": {
                    "type": "string",
                    "description": "Target URL or local path for action='navigate'. Examples: '/', '/widgets/panel.html', 'https://example.com'"
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

        let session = Self::validate_session(
            args.get("session")
                .and_then(|v| v.as_str())
                .unwrap_or("main"),
        )?;

        if action != "snapshot" && !self.security.record_action() {
            return Ok(ToolResult {
                success: false,
                output: String::new(),
                error: Some("Action blocked: rate limit exceeded".into()),
            });
        }

        let result = match action {
            "present" => self.action_present(&session).await,
            "navigate" => {
                let target = args
                    .get("url")
                    .and_then(|v| v.as_str())
                    .ok_or_else(|| anyhow::anyhow!("Missing 'url' parameter for navigate"))?;
                self.action_navigate(&session, target).await
            }
            "snapshot" => self.action_snapshot(&session).await,
            _ => Ok(ToolResult {
                success: false,
                output: String::new(),
                error: Some(format!(
                    "Unknown action '{action}'. Expected one of: present, navigate, snapshot"
                )),
            }),
        };

        match result {
            Ok(result) => Ok(result),
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
    use tempfile::TempDir;

    fn tool_with_workspace(tmp: &TempDir) -> CanvasTool {
        let security = Arc::new(SecurityPolicy {
            autonomy: AutonomyLevel::Full,
            workspace_dir: tmp.path().to_path_buf(),
            ..SecurityPolicy::default()
        });
        CanvasTool::new(security, tmp.path().to_path_buf())
    }

    #[tokio::test]
    async fn present_creates_session_and_index() {
        let tmp = TempDir::new().unwrap();
        let tool = tool_with_workspace(&tmp);
        let result = tool.execute(json!({"action":"present"})).await.unwrap();
        assert!(result.success);
        assert!(tmp.path().join("canvas/main/index.html").exists());
        assert!(result.output.contains("current_target"));
    }

    #[tokio::test]
    async fn navigate_updates_state_for_local_path() {
        let tmp = TempDir::new().unwrap();
        let tool = tool_with_workspace(&tmp);
        let _ = tool.execute(json!({"action":"present"})).await.unwrap();
        let result = tool
            .execute(json!({"action":"navigate","url":"/widgets/todo.html"}))
            .await
            .unwrap();
        assert!(result.success);
        assert!(tmp.path().join("canvas/main/widgets/todo.html").exists());
    }

    #[tokio::test]
    async fn snapshot_returns_preview_for_local_file() {
        let tmp = TempDir::new().unwrap();
        let tool = tool_with_workspace(&tmp);
        let _ = tool.execute(json!({"action":"present"})).await.unwrap();
        let _ = tool
            .execute(json!({"action":"navigate","url":"/widgets/view.html"}))
            .await
            .unwrap();
        tokio::fs::write(
            tmp.path().join("canvas/main/widgets/view.html"),
            "<html><body>hello</body></html>",
        )
        .await
        .unwrap();
        let snapshot = tool.execute(json!({"action":"snapshot"})).await.unwrap();
        assert!(snapshot.success);
        assert!(snapshot.output.contains("hello"));
    }

    #[tokio::test]
    async fn navigate_rejects_parent_dir_escape() {
        let tmp = TempDir::new().unwrap();
        let tool = tool_with_workspace(&tmp);
        let result = tool
            .execute(json!({"action":"navigate","url":"../../etc/passwd"}))
            .await
            .unwrap();
        assert!(!result.success);
        assert!(result.error.unwrap().contains("cannot contain '..'"));
    }
}
