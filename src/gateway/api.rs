//! REST API handlers for the web dashboard.
//!
//! All `/api/*` routes require bearer token authentication (PairingGuard).

use super::{
    clear_conversation_entries, conversation_sender_key, ensure_task_session_workspace,
    is_task_session_id, load_conversation_entries, task_session_workspace_dir, AppState,
    SESSION_WORKSPACE_PROJECT_LINK, TASK_SESSION_PLACEHOLDER, TASK_SESSION_PREFIX,
};
use crate::providers::ChatMessage;
use anyhow::{Context, Result};
use axum::{
    extract::{Multipart, Path, Query, State},
    http::{header, HeaderMap, StatusCode},
    response::{IntoResponse, Json},
};
use base64::Engine as _;
use serde::{Deserialize, Serialize};
use std::collections::hash_map::Entry;
use std::collections::HashMap;
use std::fs;
use std::io::Write;
use std::path::{Path as StdPath, PathBuf};
use std::time::Duration;
use uuid::Uuid;

const MASKED_SECRET: &str = "***MASKED***";
const OFFICECLI_ENV_VAR: &str = "ZEROCLAW_OFFICECLI_PATH";
const OFFICECLI_TIMEOUT_SECS: u64 = 30;
const WORKSPACE_PREVIEW_MAX_CHARS: usize = 120_000;
const HIDDEN_SESSION_WORKSPACE_ROOTS: &[&str] =
    &["state", "cron", "skills", SESSION_WORKSPACE_PROJECT_LINK];
const WORKSPACE_PREVIEW_HTML_MAX_CHARS: usize = 500_000;
const OFFICE_SAFE_ENV_VARS: &[&str] = &[
    "PATH", "HOME", "TERM", "LANG", "LC_ALL", "LC_CTYPE", "USER", "SHELL", "TMPDIR",
];

// ── Bearer token auth extractor ─────────────────────────────────

/// Extract and validate bearer token from Authorization header.
fn extract_bearer_token(headers: &HeaderMap) -> Option<&str> {
    headers
        .get(header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .and_then(|auth| auth.strip_prefix("Bearer "))
}

/// Verify bearer token against PairingGuard. Returns error response if unauthorized.
fn require_auth(
    state: &AppState,
    headers: &HeaderMap,
) -> Result<(), (StatusCode, Json<serde_json::Value>)> {
    if !state.pairing.require_pairing() {
        return Ok(());
    }

    let token = extract_bearer_token(headers).unwrap_or("");
    if state.pairing.is_authenticated(token) {
        Ok(())
    } else {
        Err((
            StatusCode::UNAUTHORIZED,
            Json(serde_json::json!({
                "error": "Unauthorized — pair first via POST /pair, then send Authorization: Bearer <token>"
            })),
        ))
    }
}

// ── Query parameters ─────────────────────────────────────────────

#[derive(Deserialize)]
pub struct MemoryQuery {
    pub query: Option<String>,
    pub category: Option<String>,
}

#[derive(Deserialize)]
pub struct ChatHistoryQuery {
    pub offset: Option<usize>,
    pub limit: Option<usize>,
    pub session: Option<String>,
}

#[derive(Serialize)]
pub struct ChatSessionItem {
    pub session_id: String,
    pub kind: String,
    pub title: String,
    pub channel: Option<String>,
    pub sender: Option<String>,
    pub thread_ts: Option<String>,
    pub last_role: String,
    pub last_message: String,
    pub last_timestamp: String,
    pub message_count: usize,
}

#[derive(Serialize)]
pub struct ChatSessionCreateResponse {
    pub session_id: String,
}

#[derive(Deserialize)]
pub struct ChatAttachmentUploadQuery {
    pub session: Option<String>,
}

#[derive(Serialize)]
pub struct ChatAttachmentUploadItem {
    pub name: String,
    pub mime_type: String,
    pub size: usize,
    pub local_path: String,
}

#[derive(Serialize)]
pub struct ChatAttachmentUploadResponse {
    pub files: Vec<ChatAttachmentUploadItem>,
}

#[derive(Deserialize)]
pub struct ChatWorkspaceQuery {
    pub session: Option<String>,
}

#[derive(Serialize)]
pub struct ChatWorkspaceFileItem {
    pub name: String,
    pub mime_type: String,
    pub size: usize,
    pub workspace_path: String,
    pub local_path: String,
    pub relative_path: String,
    pub kind: String,
    pub text_preview: Option<String>,
    pub image_data_url: Option<String>,
}

#[derive(Serialize)]
pub struct ChatWorkspaceResponse {
    pub scope_path: String,
    pub files: Vec<ChatWorkspaceFileItem>,
}

#[derive(Deserialize)]
pub struct ChatWorkspacePreviewQuery {
    pub session: Option<String>,
    pub path: String,
}

#[derive(Deserialize)]
pub struct ChatWorkspaceOpenFolderBody {
    pub session: Option<String>,
    pub path: String,
}

#[derive(Serialize)]
pub struct ChatWorkspacePreviewResponse {
    pub name: String,
    pub mime_type: String,
    pub size: usize,
    pub workspace_path: String,
    pub local_path: String,
    pub relative_path: String,
    pub kind: String,
    pub html_preview: Option<String>,
    pub text_preview: Option<String>,
    pub outline_preview: Option<String>,
    pub image_data_url: Option<String>,
    pub preview_source: Option<String>,
}

#[derive(Deserialize)]
pub struct MemoryStoreBody {
    pub key: String,
    pub content: String,
    pub category: Option<String>,
}

#[derive(Deserialize)]
pub struct CronAddBody {
    pub name: Option<String>,
    pub schedule: String,
    pub command: String,
}

#[derive(Deserialize)]
pub struct SkillInstallBody {
    pub source: String,
}

#[derive(Deserialize)]
pub struct SkillAuditBody {
    pub source: String,
}

#[derive(Deserialize)]
pub struct SkillMarketInstallBody {
    pub market_id: String,
    pub acknowledge_risk: bool,
}

// ── Handlers ────────────────────────────────────────────────────

/// GET /api/status — system status overview
pub async fn handle_api_status(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> impl IntoResponse {
    if let Err(e) = require_auth(&state, &headers) {
        return e.into_response();
    }

    let config = state.config.lock().clone();
    let health = crate::health::snapshot();

    let mut channels = serde_json::Map::new();

    for (channel, present) in config.channels_config.channels() {
        channels.insert(channel.name().to_string(), serde_json::Value::Bool(present));
    }

    let body = serde_json::json!({
        "provider": config.default_provider,
        "model": config.default_model,
        "temperature": config.default_temperature,
        "uptime_seconds": health.uptime_seconds,
        "gateway_port": config.gateway.port,
        "locale": "en",
        "memory_backend": state.mem.name(),
        "paired": state.pairing.is_paired(),
        "channels": channels,
        "health": health,
        "vision_supported": state.provider.supports_vision(),
    });

    Json(body).into_response()
}

/// GET /api/config — current config (api_key masked)
pub async fn handle_api_config_get(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> impl IntoResponse {
    if let Err(e) = require_auth(&state, &headers) {
        return e.into_response();
    }

    let config = state.config.lock().clone();

    // Serialize to TOML after masking sensitive fields.
    let masked_config = mask_sensitive_fields(&config);
    let toml_str = match toml::to_string_pretty(&masked_config) {
        Ok(s) => s,
        Err(e) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({"error": format!("Failed to serialize config: {e}")})),
            )
                .into_response();
        }
    };

    Json(serde_json::json!({
        "format": "toml",
        "content": toml_str,
    }))
    .into_response()
}

/// GET /api/config/form — current config (JSON, api_key masked)
pub async fn handle_api_config_form_get(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> impl IntoResponse {
    if let Err(e) = require_auth(&state, &headers) {
        return e.into_response();
    }

    let config = state.config.lock().clone();
    let masked_config = mask_sensitive_fields(&config);
    Json(masked_config).into_response()
}

/// GET /api/chat/history — conversation history for current session
pub async fn handle_api_chat_history_get(
    State(state): State<AppState>,
    Query(params): Query<ChatHistoryQuery>,
    headers: HeaderMap,
) -> impl IntoResponse {
    if let Err(e) = require_auth(&state, &headers) {
        return e.into_response();
    }

    let token = extract_bearer_token(&headers);
    let sender_key = params
        .session
        .clone()
        .unwrap_or_else(|| conversation_sender_key(token));
    let offset = params.offset.unwrap_or(0);
    let limit = params.limit.unwrap_or(50).clamp(1, 200);
    let fetch_limit = limit.saturating_add(1);
    let items = load_conversation_entries(state.mem.clone(), &sender_key, fetch_limit, offset)
        .await
        .unwrap_or_default();
    let has_more = items.len() > limit;
    let messages = items
        .into_iter()
        .filter(|(_, msg)| msg.role != "system")
        .take(limit)
        .map(|(timestamp, msg)| {
            serde_json::json!({
                "role": msg.role,
                "content": msg.content,
                "timestamp": timestamp,
            })
        })
        .collect::<Vec<_>>();

    Json(serde_json::json!({
        "messages": messages,
        "offset": offset,
        "limit": limit,
        "has_more": has_more,
    }))
    .into_response()
}

fn parse_channel_session_id(session_id: &str) -> Option<(String, String, Option<String>)> {
    let mut parts = session_id.split(':');
    if parts.next()? != "channel" {
        return None;
    }
    let channel = parts.next()?.to_string();
    let sender = parts.next()?.to_string();
    let remainder: Vec<&str> = parts.collect();
    let thread_ts = if remainder.is_empty() {
        None
    } else {
        Some(remainder.join(":"))
    };
    Some((channel, sender, thread_ts))
}

fn build_task_session_id() -> String {
    format!("{TASK_SESSION_PREFIX}{}", Uuid::new_v4())
}

fn task_session_title(last_message: &str) -> String {
    let trimmed = last_message.trim();
    if trimmed.is_empty() {
        "Untitled Task".to_string()
    } else {
        trimmed.chars().take(48).collect()
    }
}

fn is_internal_history_role(role: &str) -> bool {
    matches!(role, "system" | "reasoning" | "tool")
}

fn sanitize_attachment_filename(filename: &str) -> String {
    let candidate = StdPath::new(filename)
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("attachment.bin");
    let sanitized = candidate
        .chars()
        .map(|ch| match ch {
            '/' | '\\' | ':' | '\0' => '_',
            _ if ch.is_control() => '_',
            _ => ch,
        })
        .collect::<String>();
    let trimmed = sanitized.trim().trim_matches('.');
    if trimmed.is_empty() {
        "attachment.bin".to_string()
    } else {
        trimmed.to_string()
    }
}

fn sanitize_attachment_directory_name(value: &str) -> String {
    let sanitized = value
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || matches!(ch, '-' | '_') {
                ch
            } else {
                '_'
            }
        })
        .collect::<String>();
    let trimmed = sanitized.trim_matches('_');
    if trimmed.is_empty() {
        "session".to_string()
    } else {
        trimmed.to_string()
    }
}

fn attachment_storage_dir(session_id: Option<&str>) -> PathBuf {
    let session_component = session_id
        .map(sanitize_attachment_directory_name)
        .unwrap_or_else(|| "default".to_string());
    directories::ProjectDirs::from("com", "zeroclaw", "zeroclaw")
        .map(|dirs| dirs.cache_dir().to_path_buf())
        .unwrap_or_else(std::env::temp_dir)
        .join("zeroclaw-chat")
        .join("attachments")
        .join(session_component)
}

fn chat_workspace_dir(workspace_dir: &StdPath, session_id: Option<&str>) -> Result<PathBuf> {
    match session_id.filter(|value| is_task_session_id(value)) {
        Some(task_session_id) => ensure_task_session_workspace(workspace_dir, task_session_id),
        None => Ok(workspace_dir.to_path_buf()),
    }
}

fn chat_workspace_scope_path(workspace_dir: &StdPath, session_id: Option<&str>) -> Result<String> {
    let scope_dir = match session_id.filter(|value| is_task_session_id(value)) {
        Some(task_session_id) => task_session_workspace_dir(workspace_dir, task_session_id),
        None => workspace_dir.to_path_buf(),
    };
    Ok(scope_dir
        .strip_prefix(workspace_dir)
        .unwrap_or(&scope_dir)
        .to_string_lossy()
        .into_owned())
}

fn attachment_display_name(stored_name: &str) -> String {
    let Some((prefix, remainder)) = stored_name.split_once('-') else {
        return stored_name.to_string();
    };
    if prefix.len() == 32
        && prefix.chars().all(|ch| ch.is_ascii_hexdigit())
        && !remainder.is_empty()
    {
        remainder.to_string()
    } else {
        stored_name.to_string()
    }
}

fn attachment_kind_for_mime(mime_type: &str) -> &'static str {
    if mime_type.starts_with("image/") {
        "image"
    } else if mime_type.starts_with("text/") {
        "text"
    } else {
        "file"
    }
}

fn attachment_text_preview(bytes: &[u8], mime_type: &str, file_name: &str) -> Option<String> {
    let lower_name = file_name.to_ascii_lowercase();
    let is_text_like = mime_type.starts_with("text/")
        || matches!(
            lower_name.rsplit('.').next(),
            Some(
                "md" | "txt"
                    | "json"
                    | "yaml"
                    | "yml"
                    | "toml"
                    | "csv"
                    | "log"
                    | "xml"
                    | "html"
                    | "css"
                    | "js"
                    | "ts"
                    | "tsx"
                    | "jsx"
                    | "rs"
                    | "py"
                    | "sh"
                    | "sql"
            )
        );
    if !is_text_like {
        return None;
    }
    let preview = String::from_utf8_lossy(bytes)
        .replace('\0', "")
        .trim()
        .chars()
        .take(4000)
        .collect::<String>();
    if preview.is_empty() {
        None
    } else {
        Some(preview)
    }
}

fn attachment_image_preview_data_url(bytes: &[u8], mime_type: &str) -> Option<String> {
    if !mime_type.starts_with("image/") || bytes.len() > 512 * 1024 {
        return None;
    }
    Some(format!(
        "data:{mime_type};base64,{}",
        base64::engine::general_purpose::STANDARD.encode(bytes)
    ))
}

fn relative_workspace_path(base_dir: &StdPath, path: &StdPath) -> Option<String> {
    path.strip_prefix(base_dir)
        .ok()
        .map(|relative| relative.to_string_lossy().into_owned())
}

fn workspace_item_display_path(scope_path: &str, relative_path: &str) -> String {
    PathBuf::from(scope_path)
        .join(relative_path)
        .to_string_lossy()
        .into_owned()
}

fn workspace_item_mime_type(path: &StdPath, is_dir: bool) -> String {
    if is_dir {
        "inode/directory".to_string()
    } else {
        mime_guess::from_path(path)
            .first_or_octet_stream()
            .essence_str()
            .to_string()
    }
}

fn should_use_office_preview(path: &StdPath) -> bool {
    path.extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| ext.to_ascii_lowercase())
        .is_some_and(|ext| matches!(ext.as_str(), "docx" | "pptx" | "xlsx"))
}

fn resolve_officecli_path() -> Option<PathBuf> {
    let configured = std::env::var(OFFICECLI_ENV_VAR).ok()?;
    let trimmed = configured.trim();
    if trimmed.is_empty() {
        return None;
    }
    let candidate = PathBuf::from(trimmed);
    candidate.is_file().then_some(candidate)
}

async fn run_officecli_preview(
    path: &StdPath,
    mode: &str,
    max_chars: Option<usize>,
) -> Result<String> {
    let officecli_path = resolve_officecli_path()
        .ok_or_else(|| anyhow::anyhow!("Bundled OfficeCLI path is unavailable"))?;

    let mut command = tokio::process::Command::new(officecli_path);
    command.arg("view").arg(path).arg(mode);
    command.env_clear();
    command.stdin(std::process::Stdio::null());
    for var in OFFICE_SAFE_ENV_VARS {
        if let Ok(value) = std::env::var(var) {
            command.env(var, value);
        }
    }

    let output = tokio::time::timeout(
        Duration::from_secs(OFFICECLI_TIMEOUT_SECS),
        command.output(),
    )
    .await
    .map_err(|_| anyhow::anyhow!("OfficeCLI timed out after {OFFICECLI_TIMEOUT_SECS}s"))??;

    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    if !output.status.success() {
        anyhow::bail!(
            "{}",
            if stderr.is_empty() {
                format!("OfficeCLI exited with status {}", output.status)
            } else {
                format!("OfficeCLI failed: {stderr}")
            }
        );
    }

    let rendered = if stdout.is_empty() {
        "OfficeCLI returned no readable output".to_string()
    } else {
        stdout
    };
    Ok(match max_chars {
        Some(max_chars) => rendered.chars().take(max_chars).collect(),
        None => rendered,
    })
}

async fn open_folder_in_system(path: &StdPath) -> Result<()> {
    let mut command = if cfg!(target_os = "macos") {
        let mut command = tokio::process::Command::new("open");
        command.arg(path);
        command
    } else if cfg!(target_os = "windows") {
        let mut command = tokio::process::Command::new("explorer");
        command.arg(path);
        command
    } else {
        let mut command = tokio::process::Command::new("xdg-open");
        command.arg(path);
        command
    };

    command.stdin(std::process::Stdio::null());
    command.stdout(std::process::Stdio::null());
    command.stderr(std::process::Stdio::null());

    let status = command
        .status()
        .await
        .with_context(|| format!("Failed to spawn folder opener for {}", path.display()))?;

    if !status.success() {
        anyhow::bail!("Folder opener exited with status {status}");
    }

    Ok(())
}

fn collect_workspace_files(
    scope_dir: &StdPath,
    current_dir: &StdPath,
    scope_path: &str,
    hide_internal_entries: bool,
    files: &mut Vec<ChatWorkspaceFileItem>,
) -> Result<()> {
    let mut entries = fs::read_dir(current_dir)?.flatten().collect::<Vec<_>>();
    entries.sort_by_key(|entry| entry.file_name().to_string_lossy().to_ascii_lowercase());

    for entry in entries {
        let path = entry.path();
        let metadata = match entry.metadata() {
            Ok(metadata) if metadata.is_file() || metadata.is_dir() => metadata,
            _ => continue,
        };

        let is_dir = metadata.is_dir();
        let stored_name = entry.file_name().to_string_lossy().into_owned();
        let display_name = attachment_display_name(&stored_name);
        let relative_path = match relative_workspace_path(scope_dir, &path) {
            Some(relative_path) => relative_path,
            None => continue,
        };
        if hide_internal_entries && should_hide_session_workspace_path(&relative_path) {
            continue;
        }
        let mime_type = workspace_item_mime_type(&path, is_dir);
        let bytes = if is_dir {
            Vec::new()
        } else {
            fs::read(&path).unwrap_or_default()
        };

        files.push(ChatWorkspaceFileItem {
            name: display_name,
            mime_type: mime_type.clone(),
            size: if is_dir { 0 } else { metadata.len() as usize },
            workspace_path: workspace_item_display_path(scope_path, &relative_path),
            local_path: path.to_string_lossy().into_owned(),
            relative_path: relative_path.clone(),
            kind: if is_dir {
                "directory".to_string()
            } else {
                attachment_kind_for_mime(&mime_type).to_string()
            },
            text_preview: if is_dir {
                None
            } else {
                attachment_text_preview(&bytes, &mime_type, &stored_name)
            },
            image_data_url: if is_dir {
                None
            } else {
                attachment_image_preview_data_url(&bytes, &mime_type)
            },
        });

        if is_dir {
            collect_workspace_files(scope_dir, &path, scope_path, hide_internal_entries, files)?;
        }
    }

    Ok(())
}

fn should_hide_session_workspace_path(relative_path: &str) -> bool {
    let Some(root) = relative_path
        .split('/')
        .next()
        .filter(|segment| !segment.is_empty())
    else {
        return false;
    };

    HIDDEN_SESSION_WORKSPACE_ROOTS.contains(&root)
}

fn resolve_workspace_preview_path(
    workspace_dir: &StdPath,
    session_id: Option<&str>,
    requested_relative_path: &str,
) -> Result<(PathBuf, String)> {
    let scope_dir = chat_workspace_dir(workspace_dir, session_id)?;
    let scope_dir = fs::canonicalize(&scope_dir).unwrap_or(scope_dir);
    let requested_path = PathBuf::from(requested_relative_path);
    if requested_path.is_absolute()
        || requested_path
            .components()
            .any(|component| matches!(component, std::path::Component::ParentDir))
    {
        anyhow::bail!("Invalid workspace path");
    }

    let full_path = scope_dir.join(&requested_path);
    let resolved = fs::canonicalize(&full_path)
        .map_err(|err| anyhow::anyhow!("Failed to resolve workspace file: {err}"))?;
    if !resolved.starts_with(&scope_dir) {
        anyhow::bail!("Workspace file path escapes the session scope");
    }

    Ok((resolved, requested_path.to_string_lossy().into_owned()))
}

/// POST /api/chat/sessions — create an empty desktop task session
pub async fn handle_api_chat_session_create(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> impl IntoResponse {
    if let Err(e) = require_auth(&state, &headers) {
        return e.into_response();
    }

    let session_id = build_task_session_id();
    let placeholder = ChatMessage::system(TASK_SESSION_PLACEHOLDER);
    if let Err(err) =
        super::store_conversation_turn(state.mem.clone(), &session_id, &placeholder).await
    {
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({
                "error": format!("Failed to create task session: {err}")
            })),
        )
            .into_response();
    }

    Json(ChatSessionCreateResponse { session_id }).into_response()
}

/// POST /api/chat/attachments — store selected files in a session-scoped temp attachment directory
pub async fn handle_api_chat_attachments_upload(
    State(state): State<AppState>,
    Query(params): Query<ChatAttachmentUploadQuery>,
    headers: HeaderMap,
    mut multipart: Multipart,
) -> impl IntoResponse {
    if let Err(e) = require_auth(&state, &headers) {
        return e.into_response();
    }

    if let Some(session_id) = params.session.as_deref() {
        if parse_channel_session_id(session_id).is_none() && !is_task_session_id(session_id) {
            return (
                StatusCode::BAD_REQUEST,
                Json(serde_json::json!({
                    "error": "Invalid chat session"
                })),
            )
                .into_response();
        }
    }

    let target_dir = attachment_storage_dir(params.session.as_deref());
    if let Err(err) = fs::create_dir_all(&target_dir) {
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({
                "error": format!("Failed to prepare attachment directory: {err}")
            })),
        )
            .into_response();
    }

    let mut uploaded = Vec::new();
    loop {
        let field = match multipart.next_field().await {
            Ok(Some(field)) => field,
            Ok(None) => break,
            Err(err) => {
                return (
                    StatusCode::BAD_REQUEST,
                    Json(serde_json::json!({
                        "error": format!("Invalid multipart upload: {err}")
                    })),
                )
                    .into_response();
            }
        };

        let field_name = field.name().map(ToString::to_string);
        let has_filename = field.file_name().is_some();
        if !has_filename && field_name.as_deref() != Some("files") {
            continue;
        }

        let original_name = field
            .file_name()
            .map(sanitize_attachment_filename)
            .unwrap_or_else(|| "attachment.bin".to_string());
        let mime_type = field
            .content_type()
            .map(ToString::to_string)
            .unwrap_or_else(|| "application/octet-stream".to_string());
        let bytes = match field.bytes().await {
            Ok(bytes) => bytes,
            Err(err) => {
                return (
                    StatusCode::BAD_REQUEST,
                    Json(serde_json::json!({
                        "error": format!("Failed to read upload field: {err}")
                    })),
                )
                    .into_response();
            }
        };
        let stored_name = format!("{}-{}", Uuid::new_v4().simple(), original_name);
        let stored_path = target_dir.join(&stored_name);
        if let Err(err) = fs::write(&stored_path, &bytes) {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({
                    "error": format!("Failed to write attachment: {err}")
                })),
            )
                .into_response();
        }

        uploaded.push(ChatAttachmentUploadItem {
            name: original_name,
            mime_type,
            size: bytes.len(),
            local_path: stored_path.to_string_lossy().into_owned(),
        });
    }

    if uploaded.is_empty() {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({
                "error": "No files were uploaded"
            })),
        )
            .into_response();
    }

    Json(ChatAttachmentUploadResponse { files: uploaded }).into_response()
}

/// GET /api/chat/workspace — inspect the current session-bound attachment workspace
pub async fn handle_api_chat_workspace(
    State(state): State<AppState>,
    Query(params): Query<ChatWorkspaceQuery>,
    headers: HeaderMap,
) -> impl IntoResponse {
    if let Err(e) = require_auth(&state, &headers) {
        return e.into_response();
    }

    if let Some(session_id) = params.session.as_deref() {
        if parse_channel_session_id(session_id).is_none() && !is_task_session_id(session_id) {
            return (
                StatusCode::BAD_REQUEST,
                Json(serde_json::json!({
                    "error": "Invalid chat session"
                })),
            )
                .into_response();
        }
    }

    let workspace_dir = state.config.lock().workspace_dir.clone();
    let target_dir = match chat_workspace_dir(&workspace_dir, params.session.as_deref()) {
        Ok(target_dir) => target_dir,
        Err(err) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({
                    "error": format!("Failed to prepare session workspace: {err}")
                })),
            )
                .into_response();
        }
    };
    let scope_path = match chat_workspace_scope_path(&workspace_dir, params.session.as_deref()) {
        Ok(scope_path) => scope_path,
        Err(err) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({
                    "error": format!("Failed to resolve workspace scope: {err}")
                })),
            )
                .into_response();
        }
    };
    let mut files = Vec::new();
    let hide_internal_entries = params
        .session
        .as_deref()
        .is_some_and(|session_id| is_task_session_id(session_id));

    if target_dir.exists() {
        if let Err(err) = collect_workspace_files(
            &target_dir,
            &target_dir,
            &scope_path,
            hide_internal_entries,
            &mut files,
        ) {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({
                    "error": format!("Failed to read workspace directory: {err}")
                })),
            )
                .into_response();
        }
    }

    Json(ChatWorkspaceResponse { scope_path, files }).into_response()
}

/// GET /api/chat/workspace/preview — load an on-demand preview for a workspace file
pub async fn handle_api_chat_workspace_preview(
    State(state): State<AppState>,
    Query(params): Query<ChatWorkspacePreviewQuery>,
    headers: HeaderMap,
) -> impl IntoResponse {
    if let Err(e) = require_auth(&state, &headers) {
        return e.into_response();
    }

    if let Some(session_id) = params.session.as_deref() {
        if parse_channel_session_id(session_id).is_none() && !is_task_session_id(session_id) {
            return (
                StatusCode::BAD_REQUEST,
                Json(serde_json::json!({
                    "error": "Invalid chat session"
                })),
            )
                .into_response();
        }
    }

    let workspace_dir = state.config.lock().workspace_dir.clone();
    let scope_path = match chat_workspace_scope_path(&workspace_dir, params.session.as_deref()) {
        Ok(scope_path) => scope_path,
        Err(err) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({
                    "error": format!("Failed to resolve workspace scope: {err}")
                })),
            )
                .into_response();
        }
    };
    let (resolved_path, relative_path) = match resolve_workspace_preview_path(
        &workspace_dir,
        params.session.as_deref(),
        &params.path,
    ) {
        Ok(values) => values,
        Err(err) => {
            return (
                StatusCode::BAD_REQUEST,
                Json(serde_json::json!({
                    "error": err.to_string()
                })),
            )
                .into_response();
        }
    };

    let metadata = match fs::metadata(&resolved_path) {
        Ok(metadata) => metadata,
        Err(err) => {
            return (
                StatusCode::NOT_FOUND,
                Json(serde_json::json!({
                    "error": format!("Failed to read workspace file metadata: {err}")
                })),
            )
                .into_response();
        }
    };

    let is_dir = metadata.is_dir();
    let stored_name = resolved_path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_string();
    let display_name = attachment_display_name(&stored_name);
    let mime_type = workspace_item_mime_type(&resolved_path, is_dir);
    let bytes = if is_dir {
        Vec::new()
    } else {
        match fs::read(&resolved_path) {
            Ok(bytes) => bytes,
            Err(err) => {
                return (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(serde_json::json!({
                        "error": format!("Failed to read workspace file: {err}")
                    })),
                )
                    .into_response();
            }
        }
    };

    let mut html_preview = None;
    let mut text_preview = None;
    let mut outline_preview = None;
    let mut image_data_url = None;
    let preview_source = if is_dir {
        Some("directory".to_string())
    } else if mime_type.starts_with("image/") {
        image_data_url = attachment_image_preview_data_url(&bytes, &mime_type);
        Some("image".to_string())
    } else if should_use_office_preview(&resolved_path) {
        match run_officecli_preview(&resolved_path, "text", Some(WORKSPACE_PREVIEW_MAX_CHARS)).await
        {
            Ok(text) => {
                text_preview = Some(text);
                outline_preview = run_officecli_preview(
                    &resolved_path,
                    "outline",
                    Some(WORKSPACE_PREVIEW_MAX_CHARS / 2),
                )
                .await
                .ok();
                html_preview = run_officecli_preview(&resolved_path, "html", None)
                    .await
                    .ok()
                    .filter(|html| html.chars().count() <= WORKSPACE_PREVIEW_HTML_MAX_CHARS);
                Some("officecli".to_string())
            }
            Err(err) => {
                return (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(serde_json::json!({
                        "error": format!("Failed to preview Office file: {err}")
                    })),
                )
                    .into_response();
            }
        }
    } else {
        text_preview = attachment_text_preview(&bytes, &mime_type, &stored_name);
        text_preview.as_ref().map(|_| "text".to_string())
    };

    Json(ChatWorkspacePreviewResponse {
        name: display_name,
        mime_type,
        size: if is_dir { 0 } else { metadata.len() as usize },
        workspace_path: workspace_item_display_path(&scope_path, &relative_path),
        local_path: resolved_path.to_string_lossy().into_owned(),
        relative_path,
        kind: if is_dir {
            "directory".to_string()
        } else {
            attachment_kind_for_mime(&workspace_item_mime_type(&resolved_path, false)).to_string()
        },
        html_preview,
        text_preview,
        outline_preview,
        image_data_url,
        preview_source,
    })
    .into_response()
}

/// POST /api/chat/workspace/open-folder — open a workspace file's parent folder in the OS file manager
pub async fn handle_api_chat_workspace_open_folder(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<ChatWorkspaceOpenFolderBody>,
) -> impl IntoResponse {
    if let Err(e) = require_auth(&state, &headers) {
        return e.into_response();
    }

    if let Some(session_id) = body.session.as_deref() {
        if parse_channel_session_id(session_id).is_none() && !is_task_session_id(session_id) {
            return (
                StatusCode::BAD_REQUEST,
                Json(serde_json::json!({
                    "error": "Invalid chat session"
                })),
            )
                .into_response();
        }
    }

    let workspace_dir = state.config.lock().workspace_dir.clone();
    let (resolved_path, _) =
        match resolve_workspace_preview_path(&workspace_dir, body.session.as_deref(), &body.path) {
            Ok(values) => values,
            Err(err) => {
                return (
                    StatusCode::BAD_REQUEST,
                    Json(serde_json::json!({
                        "error": err.to_string()
                    })),
                )
                    .into_response();
            }
        };

    let target_dir = if resolved_path.is_dir() {
        resolved_path
    } else {
        match resolved_path.parent() {
            Some(parent) => parent.to_path_buf(),
            None => {
                return (
                    StatusCode::BAD_REQUEST,
                    Json(serde_json::json!({
                        "error": "Unable to resolve parent directory"
                    })),
                )
                    .into_response();
            }
        }
    };

    match open_folder_in_system(&target_dir).await {
        Ok(()) => Json(serde_json::json!({ "status": "ok" })).into_response(),
        Err(err) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({
                "error": format!("Failed to open folder: {err}")
            })),
        )
            .into_response(),
    }
}

/// GET /api/chat/sessions — list task and channel conversation sessions
pub async fn handle_api_chat_sessions(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> impl IntoResponse {
    if let Err(e) = require_auth(&state, &headers) {
        return e.into_response();
    }

    let entries = match state
        .mem
        .list(Some(&crate::memory::MemoryCategory::Conversation), None)
        .await
    {
        Ok(items) => items,
        Err(e) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({"error": format!("Memory list failed: {e}")})),
            )
                .into_response();
        }
    };

    #[derive(Default)]
    struct SessionAgg {
        kind: String,
        title: String,
        channel: String,
        sender: String,
        thread_ts: Option<String>,
        last_role: String,
        last_message: String,
        last_timestamp: String,
        message_count: usize,
        has_visible_message: bool,
    }

    let mut sessions: HashMap<String, SessionAgg> = HashMap::new();
    for entry in entries {
        let Some(session_id) = entry.session_id.as_deref() else {
            continue;
        };
        let parsed_kind =
            if let Some((channel, sender, thread_ts)) = parse_channel_session_id(session_id) {
                (
                    "channel".to_string(),
                    "Channel Session".to_string(),
                    channel,
                    sender,
                    thread_ts,
                )
            } else if is_task_session_id(session_id) {
                (
                    "task".to_string(),
                    "Untitled Task".to_string(),
                    String::new(),
                    String::new(),
                    None,
                )
            } else {
                continue;
            };
        let (kind, fallback_title, channel, sender, thread_ts) = parsed_kind;
        let parsed_message = serde_json::from_str::<ChatMessage>(&entry.content).ok();
        let (last_role, last_message, visible_message) = match parsed_message {
            Some(msg) if msg.role == "system" && msg.content == TASK_SESSION_PLACEHOLDER => {
                ("system".to_string(), String::new(), false)
            }
            Some(msg) if is_internal_history_role(&msg.role) => (msg.role, msg.content, false),
            Some(msg) => (msg.role, msg.content, true),
            None => ("unknown".to_string(), entry.content.clone(), true),
        };

        let session_key = session_id.to_string();
        let agg = match sessions.entry(session_key) {
            Entry::Vacant(slot) => slot.insert(SessionAgg {
                kind,
                title: fallback_title,
                channel,
                sender,
                thread_ts,
                last_role: last_role.clone(),
                last_message: last_message.clone(),
                last_timestamp: entry.timestamp.clone(),
                message_count: 0,
                has_visible_message: false,
            }),
            Entry::Occupied(slot) => slot.into_mut(),
        };

        if visible_message {
            agg.message_count += 1;
            agg.has_visible_message = true;
        }
        if visible_message && entry.timestamp >= agg.last_timestamp {
            agg.last_timestamp = entry.timestamp.clone();
            agg.last_role = last_role;
            agg.last_message = last_message;
            if agg.kind == "task" {
                agg.title = task_session_title(&agg.last_message);
            }
        }
        if !agg.has_visible_message && agg.kind == "task" {
            agg.title = "Untitled Task".to_string();
        }
    }

    let mut items = sessions
        .into_iter()
        .map(|(session_id, agg)| ChatSessionItem {
            session_id,
            kind: agg.kind,
            title: agg.title,
            channel: if agg.channel.is_empty() {
                None
            } else {
                Some(agg.channel)
            },
            sender: if agg.sender.is_empty() {
                None
            } else {
                Some(agg.sender)
            },
            thread_ts: agg.thread_ts,
            last_role: agg.last_role,
            last_message: agg.last_message,
            last_timestamp: agg.last_timestamp,
            message_count: agg.message_count,
        })
        .collect::<Vec<_>>();

    items.sort_by(|a, b| b.last_timestamp.cmp(&a.last_timestamp));

    Json(serde_json::json!({ "sessions": items })).into_response()
}

/// DELETE /api/chat/sessions/:session_id — delete a task or channel conversation session
pub async fn handle_api_chat_session_delete(
    State(state): State<AppState>,
    Path(session_id): Path<String>,
    headers: HeaderMap,
) -> impl IntoResponse {
    if let Err(e) = require_auth(&state, &headers) {
        return e.into_response();
    }

    if parse_channel_session_id(&session_id).is_none() && !is_task_session_id(&session_id) {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({
                "error": "Only task and channel sessions can be deleted"
            })),
        )
            .into_response();
    }

    let deleted = clear_conversation_entries(state.mem.clone(), &session_id)
        .await
        .unwrap_or(0);
    state.conversation_histories.lock().remove(&session_id);

    Json(serde_json::json!({
        "deleted": deleted,
    }))
    .into_response()
}

/// PUT /api/config — update config from TOML body
pub async fn handle_api_config_put(
    State(state): State<AppState>,
    headers: HeaderMap,
    body: String,
) -> impl IntoResponse {
    if let Err(e) = require_auth(&state, &headers) {
        return e.into_response();
    }

    // Parse the incoming TOML
    let incoming: crate::config::Config = match toml::from_str(&body) {
        Ok(c) => c,
        Err(e) => {
            return (
                StatusCode::BAD_REQUEST,
                Json(serde_json::json!({"error": format!("Invalid TOML: {e}")})),
            )
                .into_response();
        }
    };

    let current_config = state.config.lock().clone();
    let new_config = hydrate_config_for_save(incoming, &current_config);

    if let Err(e) = new_config.validate() {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({"error": format!("Invalid config: {e}")})),
        )
            .into_response();
    }

    // Save to disk
    if let Err(e) = new_config.save().await {
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": format!("Failed to save config: {e}")})),
        )
            .into_response();
    }

    // Update in-memory config
    *state.config.lock() = new_config;

    Json(serde_json::json!({"status": "ok"})).into_response()
}

/// PUT /api/config/form — update config from JSON body
pub async fn handle_api_config_form_put(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(incoming): Json<crate::config::Config>,
) -> impl IntoResponse {
    if let Err(e) = require_auth(&state, &headers) {
        return e.into_response();
    }

    let current_config = state.config.lock().clone();
    let new_config = hydrate_config_for_save(incoming, &current_config);

    if let Err(e) = new_config.validate() {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({"error": format!("Invalid config: {e}")})),
        )
            .into_response();
    }

    if let Err(e) = new_config.save().await {
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": format!("Failed to save config: {e}")})),
        )
            .into_response();
    }

    *state.config.lock() = new_config;

    Json(serde_json::json!({"status": "ok"})).into_response()
}

/// GET /api/tools — list registered tool specs
pub async fn handle_api_tools(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> impl IntoResponse {
    if let Err(e) = require_auth(&state, &headers) {
        return e.into_response();
    }

    let tools: Vec<serde_json::Value> = state
        .tools_registry_runtime
        .iter()
        .map(|tool| {
            let spec = tool.spec();
            let operation = match tool.operation(&serde_json::json!({})) {
                crate::security::policy::ToolOperation::Read => "read",
                crate::security::policy::ToolOperation::Act => "act",
            };
            serde_json::json!({
                "name": spec.name,
                "description": spec.description,
                "parameters": spec.parameters,
                "operation": operation,
            })
        })
        .collect();

    Json(serde_json::json!({"tools": tools})).into_response()
}

pub async fn handle_api_skills_list(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> impl IntoResponse {
    if let Err(e) = require_auth(&state, &headers) {
        return e.into_response();
    }

    let config = state.config.lock().clone();
    let skills = crate::skills::load_skills_with_config(&config.workspace_dir, &config);
    let skills_json: Vec<serde_json::Value> = skills
        .iter()
        .map(|skill| {
            serde_json::json!({
                "name": skill.name,
                "description": skill.description,
                "version": skill.version,
                "author": skill.author,
                "tags": skill.tags,
                "tools": skill.tools,
                "prompts": skill.prompts,
                "location": skill.location.as_ref().map(|p| p.display().to_string()),
            })
        })
        .collect();

    Json(serde_json::json!({"skills": skills_json})).into_response()
}

pub async fn handle_api_skills_install(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<SkillInstallBody>,
) -> impl IntoResponse {
    if let Err(e) = require_auth(&state, &headers) {
        return e.into_response();
    }

    let source = body.source.trim();
    if source.is_empty() {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({"error": "source is required"})),
        )
            .into_response();
    }

    let config = state.config.lock().clone();
    let workspace_dir = config.workspace_dir.clone();
    let source = source.to_string();
    let install_result =
        tokio::task::spawn_blocking(move || crate::skills::install_skill(&workspace_dir, &source))
            .await;
    let install_result = match install_result {
        Ok(result) => result,
        Err(e) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(
                    serde_json::json!({"error": format!("Failed to run skill install task: {e}")}),
                ),
            )
                .into_response();
        }
    };

    match install_result {
        Ok(result) => Json(serde_json::json!({
            "status": "ok",
            "installed_dir": result.installed_dir.display().to_string(),
            "files_scanned": result.files_scanned,
        }))
        .into_response(),
        Err(e) => (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({"error": format!("Failed to install skill: {e}")})),
        )
            .into_response(),
    }
}

pub async fn handle_api_skills_audit(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<SkillAuditBody>,
) -> impl IntoResponse {
    if let Err(e) = require_auth(&state, &headers) {
        return e.into_response();
    }

    let source = body.source.trim();
    if source.is_empty() {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({"error": "source is required"})),
        )
            .into_response();
    }

    let config = state.config.lock().clone();
    match crate::skills::audit_skill(&config.workspace_dir, source) {
        Ok(report) => Json(serde_json::json!({
            "status": "ok",
            "files_scanned": report.files_scanned,
            "findings": report.findings,
            "clean": report.is_clean(),
        }))
        .into_response(),
        Err(e) => (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({"error": format!("Failed to audit skill: {e}")})),
        )
            .into_response(),
    }
}

pub async fn handle_api_skills_remove(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(name): Path<String>,
) -> impl IntoResponse {
    if let Err(e) = require_auth(&state, &headers) {
        return e.into_response();
    }

    let config = state.config.lock().clone();
    match crate::skills::remove_skill(&config.workspace_dir, &name) {
        Ok(()) => Json(serde_json::json!({"status": "ok"})).into_response(),
        Err(e) => (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({"error": format!("Failed to remove skill: {e}")})),
        )
            .into_response(),
    }
}

pub async fn handle_api_skills_market_list(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> impl IntoResponse {
    if let Err(e) = require_auth(&state, &headers) {
        return e.into_response();
    }

    let market = match tokio::task::spawn_blocking(crate::skills::market_catalog).await {
        Ok(market) => market,
        Err(e) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({"error": format!("Failed to load skill market: {e}")})),
            )
                .into_response();
        }
    };
    Json(serde_json::json!({ "items": market })).into_response()
}

pub async fn handle_api_skills_market_install(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<SkillMarketInstallBody>,
) -> impl IntoResponse {
    if let Err(e) = require_auth(&state, &headers) {
        return e.into_response();
    }

    if !body.acknowledge_risk {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({"error": "risk acknowledgement required"})),
        )
            .into_response();
    }

    let market_id = body.market_id.trim();
    if market_id.is_empty() {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({"error": "market_id is required"})),
        )
            .into_response();
    }

    let config = state.config.lock().clone();
    let workspace_dir = config.workspace_dir.clone();
    let market_id = market_id.to_string();
    let install_result = tokio::task::spawn_blocking(move || {
        crate::skills::install_market_skill(&workspace_dir, &market_id)
    })
    .await;
    let install_result = match install_result {
        Ok(result) => result,
        Err(e) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(
                    serde_json::json!({"error": format!("Failed to run market install task: {e}")}),
                ),
            )
                .into_response();
        }
    };

    match install_result {
        Ok(result) => Json(serde_json::json!({
            "status": "ok",
            "installed_dir": result.installed_dir.display().to_string(),
            "files_scanned": result.files_scanned,
        }))
        .into_response(),
        Err(e) => (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({"error": format!("Failed to install market skill: {e}")})),
        )
            .into_response(),
    }
}

/// GET /api/cron — list cron jobs
pub async fn handle_api_cron_list(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> impl IntoResponse {
    if let Err(e) = require_auth(&state, &headers) {
        return e.into_response();
    }

    let config = state.config.lock().clone();
    match crate::cron::list_jobs(&config) {
        Ok(jobs) => {
            let jobs_json: Vec<serde_json::Value> = jobs
                .iter()
                .map(|job| {
                    serde_json::json!({
                        "id": job.id,
                        "name": job.name,
                        "command": job.command,
                        "next_run": job.next_run.to_rfc3339(),
                        "last_run": job.last_run.map(|t| t.to_rfc3339()),
                        "last_status": job.last_status,
                        "enabled": job.enabled,
                    })
                })
                .collect();
            Json(serde_json::json!({"jobs": jobs_json})).into_response()
        }
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": format!("Failed to list cron jobs: {e}")})),
        )
            .into_response(),
    }
}

/// POST /api/cron — add a new cron job
pub async fn handle_api_cron_add(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<CronAddBody>,
) -> impl IntoResponse {
    if let Err(e) = require_auth(&state, &headers) {
        return e.into_response();
    }

    let config = state.config.lock().clone();
    let schedule = crate::cron::Schedule::Cron {
        expr: body.schedule,
        tz: None,
    };

    match crate::cron::add_shell_job(&config, body.name, schedule, &body.command) {
        Ok(job) => Json(serde_json::json!({
            "status": "ok",
            "job": {
                "id": job.id,
                "name": job.name,
                "command": job.command,
                "enabled": job.enabled,
            }
        }))
        .into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": format!("Failed to add cron job: {e}")})),
        )
            .into_response(),
    }
}

/// DELETE /api/cron/:id — remove a cron job
pub async fn handle_api_cron_delete(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> impl IntoResponse {
    if let Err(e) = require_auth(&state, &headers) {
        return e.into_response();
    }

    let config = state.config.lock().clone();
    match crate::cron::remove_job(&config, &id) {
        Ok(()) => Json(serde_json::json!({"status": "ok"})).into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": format!("Failed to remove cron job: {e}")})),
        )
            .into_response(),
    }
}

/// GET /api/integrations — list all integrations with status
pub async fn handle_api_integrations(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> impl IntoResponse {
    if let Err(e) = require_auth(&state, &headers) {
        return e.into_response();
    }

    let config = state.config.lock().clone();
    let entries = crate::integrations::registry::all_integrations();

    let integrations: Vec<serde_json::Value> = entries
        .iter()
        .map(|entry| {
            let status = (entry.status_fn)(&config);
            serde_json::json!({
                "name": entry.name,
                "description": entry.description,
                "category": entry.category,
                "status": status,
            })
        })
        .collect();

    Json(serde_json::json!({"integrations": integrations})).into_response()
}

/// POST /api/doctor — run diagnostics
pub async fn handle_api_doctor(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> impl IntoResponse {
    if let Err(e) = require_auth(&state, &headers) {
        return e.into_response();
    }

    let config = state.config.lock().clone();
    let results = crate::doctor::diagnose(&config);

    let ok_count = results
        .iter()
        .filter(|r| r.severity == crate::doctor::Severity::Ok)
        .count();
    let warn_count = results
        .iter()
        .filter(|r| r.severity == crate::doctor::Severity::Warn)
        .count();
    let error_count = results
        .iter()
        .filter(|r| r.severity == crate::doctor::Severity::Error)
        .count();

    Json(serde_json::json!({
        "results": results,
        "summary": {
            "ok": ok_count,
            "warnings": warn_count,
            "errors": error_count,
        }
    }))
    .into_response()
}

/// GET /api/memory — list or search memory entries
pub async fn handle_api_memory_list(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(params): Query<MemoryQuery>,
) -> impl IntoResponse {
    if let Err(e) = require_auth(&state, &headers) {
        return e.into_response();
    }

    if let Some(ref query) = params.query {
        // Search mode
        match state.mem.recall(query, 50, None).await {
            Ok(entries) => Json(serde_json::json!({"entries": entries})).into_response(),
            Err(e) => (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({"error": format!("Memory recall failed: {e}")})),
            )
                .into_response(),
        }
    } else {
        // List mode
        let category = params.category.as_deref().map(|cat| match cat {
            "core" => crate::memory::MemoryCategory::Core,
            "daily" => crate::memory::MemoryCategory::Daily,
            "conversation" => crate::memory::MemoryCategory::Conversation,
            other => crate::memory::MemoryCategory::Custom(other.to_string()),
        });

        match state.mem.list(category.as_ref(), None).await {
            Ok(entries) => Json(serde_json::json!({"entries": entries})).into_response(),
            Err(e) => (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({"error": format!("Memory list failed: {e}")})),
            )
                .into_response(),
        }
    }
}

/// POST /api/memory — store a memory entry
pub async fn handle_api_memory_store(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<MemoryStoreBody>,
) -> impl IntoResponse {
    if let Err(e) = require_auth(&state, &headers) {
        return e.into_response();
    }

    let category = body
        .category
        .as_deref()
        .map(|cat| match cat {
            "core" => crate::memory::MemoryCategory::Core,
            "daily" => crate::memory::MemoryCategory::Daily,
            "conversation" => crate::memory::MemoryCategory::Conversation,
            other => crate::memory::MemoryCategory::Custom(other.to_string()),
        })
        .unwrap_or(crate::memory::MemoryCategory::Core);

    match state
        .mem
        .store(&body.key, &body.content, category, None)
        .await
    {
        Ok(()) => Json(serde_json::json!({"status": "ok"})).into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": format!("Memory store failed: {e}")})),
        )
            .into_response(),
    }
}

/// DELETE /api/memory/:key — delete a memory entry
pub async fn handle_api_memory_delete(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(key): Path<String>,
) -> impl IntoResponse {
    if let Err(e) = require_auth(&state, &headers) {
        return e.into_response();
    }

    match state.mem.forget(&key).await {
        Ok(deleted) => {
            Json(serde_json::json!({"status": "ok", "deleted": deleted})).into_response()
        }
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": format!("Memory forget failed: {e}")})),
        )
            .into_response(),
    }
}

/// GET /api/cost — cost summary
pub async fn handle_api_cost(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> impl IntoResponse {
    if let Err(e) = require_auth(&state, &headers) {
        return e.into_response();
    }

    if let Some(ref tracker) = state.cost_tracker {
        match tracker.get_summary() {
            Ok(summary) => Json(serde_json::json!({"cost": summary})).into_response(),
            Err(e) => (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({"error": format!("Cost summary failed: {e}")})),
            )
                .into_response(),
        }
    } else {
        Json(serde_json::json!({
            "cost": {
                "session_cost_usd": 0.0,
                "daily_cost_usd": 0.0,
                "monthly_cost_usd": 0.0,
                "total_tokens": 0,
                "request_count": 0,
                "by_model": {},
            }
        }))
        .into_response()
    }
}

/// GET /api/cli-tools — discovered CLI tools
pub async fn handle_api_cli_tools(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> impl IntoResponse {
    if let Err(e) = require_auth(&state, &headers) {
        return e.into_response();
    }

    let tools = crate::tools::cli_discovery::discover_cli_tools(&[], &[]);

    Json(serde_json::json!({"cli_tools": tools})).into_response()
}

/// GET /api/health — component health snapshot
pub async fn handle_api_health(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> impl IntoResponse {
    if let Err(e) = require_auth(&state, &headers) {
        return e.into_response();
    }

    let snapshot = crate::health::snapshot();
    Json(serde_json::json!({"health": snapshot})).into_response()
}

// ── Helpers ─────────────────────────────────────────────────────

fn is_masked_secret(value: &str) -> bool {
    value == MASKED_SECRET
}

fn mask_optional_secret(value: &mut Option<String>) {
    if value.is_some() {
        *value = Some(MASKED_SECRET.to_string());
    }
}

fn mask_required_secret(value: &mut String) {
    if !value.is_empty() {
        *value = MASKED_SECRET.to_string();
    }
}

fn mask_vec_secrets(values: &mut [String]) {
    for value in values.iter_mut() {
        if !value.is_empty() {
            *value = MASKED_SECRET.to_string();
        }
    }
}

#[allow(clippy::ref_option)]
fn restore_optional_secret(value: &mut Option<String>, current: &Option<String>) {
    if value.as_deref().is_some_and(is_masked_secret) {
        *value = current.clone();
    }
}

fn restore_required_secret(value: &mut String, current: &str) {
    if is_masked_secret(value) {
        *value = current.to_string();
    }
}

fn restore_vec_secrets(values: &mut [String], current: &[String]) {
    for (idx, value) in values.iter_mut().enumerate() {
        if is_masked_secret(value) {
            if let Some(existing) = current.get(idx) {
                *value = existing.clone();
            }
        }
    }
}

fn normalize_route_field(value: &str) -> String {
    value.trim().to_ascii_lowercase()
}

fn model_route_identity_matches(
    incoming: &crate::config::schema::ModelRouteConfig,
    current: &crate::config::schema::ModelRouteConfig,
) -> bool {
    normalize_route_field(&incoming.hint) == normalize_route_field(&current.hint)
        && normalize_route_field(&incoming.provider) == normalize_route_field(&current.provider)
        && normalize_route_field(&incoming.model) == normalize_route_field(&current.model)
}

fn model_route_provider_model_matches(
    incoming: &crate::config::schema::ModelRouteConfig,
    current: &crate::config::schema::ModelRouteConfig,
) -> bool {
    normalize_route_field(&incoming.provider) == normalize_route_field(&current.provider)
        && normalize_route_field(&incoming.model) == normalize_route_field(&current.model)
}

fn embedding_route_identity_matches(
    incoming: &crate::config::schema::EmbeddingRouteConfig,
    current: &crate::config::schema::EmbeddingRouteConfig,
) -> bool {
    normalize_route_field(&incoming.hint) == normalize_route_field(&current.hint)
        && normalize_route_field(&incoming.provider) == normalize_route_field(&current.provider)
        && normalize_route_field(&incoming.model) == normalize_route_field(&current.model)
}

fn embedding_route_provider_model_matches(
    incoming: &crate::config::schema::EmbeddingRouteConfig,
    current: &crate::config::schema::EmbeddingRouteConfig,
) -> bool {
    normalize_route_field(&incoming.provider) == normalize_route_field(&current.provider)
        && normalize_route_field(&incoming.model) == normalize_route_field(&current.model)
}

fn restore_model_route_api_keys(
    incoming: &mut [crate::config::schema::ModelRouteConfig],
    current: &[crate::config::schema::ModelRouteConfig],
) {
    let mut used_current = vec![false; current.len()];
    for incoming_route in incoming {
        if !incoming_route
            .api_key
            .as_deref()
            .is_some_and(is_masked_secret)
        {
            continue;
        }

        let exact_match_idx = current
            .iter()
            .enumerate()
            .find(|(idx, current_route)| {
                !used_current[*idx] && model_route_identity_matches(incoming_route, current_route)
            })
            .map(|(idx, _)| idx);

        let match_idx = exact_match_idx.or_else(|| {
            current
                .iter()
                .enumerate()
                .find(|(idx, current_route)| {
                    !used_current[*idx]
                        && model_route_provider_model_matches(incoming_route, current_route)
                })
                .map(|(idx, _)| idx)
        });

        if let Some(idx) = match_idx {
            used_current[idx] = true;
            incoming_route.api_key = current[idx].api_key.clone();
        } else {
            // Never persist UI placeholders to disk when no safe restore target exists.
            incoming_route.api_key = None;
        }
    }
}

fn restore_embedding_route_api_keys(
    incoming: &mut [crate::config::schema::EmbeddingRouteConfig],
    current: &[crate::config::schema::EmbeddingRouteConfig],
) {
    let mut used_current = vec![false; current.len()];
    for incoming_route in incoming {
        if !incoming_route
            .api_key
            .as_deref()
            .is_some_and(is_masked_secret)
        {
            continue;
        }

        let exact_match_idx = current
            .iter()
            .enumerate()
            .find(|(idx, current_route)| {
                !used_current[*idx]
                    && embedding_route_identity_matches(incoming_route, current_route)
            })
            .map(|(idx, _)| idx);

        let match_idx = exact_match_idx.or_else(|| {
            current
                .iter()
                .enumerate()
                .find(|(idx, current_route)| {
                    !used_current[*idx]
                        && embedding_route_provider_model_matches(incoming_route, current_route)
                })
                .map(|(idx, _)| idx)
        });

        if let Some(idx) = match_idx {
            used_current[idx] = true;
            incoming_route.api_key = current[idx].api_key.clone();
        } else {
            // Never persist UI placeholders to disk when no safe restore target exists.
            incoming_route.api_key = None;
        }
    }
}

fn mask_sensitive_fields(config: &crate::config::Config) -> crate::config::Config {
    let mut masked = config.clone();

    mask_optional_secret(&mut masked.api_key);
    mask_vec_secrets(&mut masked.reliability.api_keys);
    mask_vec_secrets(&mut masked.gateway.paired_tokens);
    mask_optional_secret(&mut masked.composio.api_key);
    mask_optional_secret(&mut masked.web_search.brave_api_key);
    mask_optional_secret(&mut masked.storage.provider.config.db_url);
    mask_optional_secret(&mut masked.memory.qdrant.api_key);
    if let Some(cloudflare) = masked.tunnel.cloudflare.as_mut() {
        mask_required_secret(&mut cloudflare.token);
    }
    if let Some(ngrok) = masked.tunnel.ngrok.as_mut() {
        mask_required_secret(&mut ngrok.auth_token);
    }

    for agent in masked.agents.values_mut() {
        mask_optional_secret(&mut agent.api_key);
    }
    for route in &mut masked.model_routes {
        mask_optional_secret(&mut route.api_key);
    }
    for route in &mut masked.embedding_routes {
        mask_optional_secret(&mut route.api_key);
    }

    if let Some(telegram) = masked.channels_config.telegram.as_mut() {
        mask_required_secret(&mut telegram.bot_token);
    }
    if let Some(discord) = masked.channels_config.discord.as_mut() {
        mask_required_secret(&mut discord.bot_token);
    }
    if let Some(slack) = masked.channels_config.slack.as_mut() {
        mask_required_secret(&mut slack.bot_token);
        mask_optional_secret(&mut slack.app_token);
    }
    if let Some(mattermost) = masked.channels_config.mattermost.as_mut() {
        mask_required_secret(&mut mattermost.bot_token);
    }
    if let Some(webhook) = masked.channels_config.webhook.as_mut() {
        mask_optional_secret(&mut webhook.secret);
    }
    if let Some(matrix) = masked.channels_config.matrix.as_mut() {
        mask_required_secret(&mut matrix.access_token);
    }
    if let Some(whatsapp) = masked.channels_config.whatsapp.as_mut() {
        mask_optional_secret(&mut whatsapp.access_token);
        mask_optional_secret(&mut whatsapp.app_secret);
        mask_optional_secret(&mut whatsapp.verify_token);
    }
    if let Some(linq) = masked.channels_config.linq.as_mut() {
        mask_required_secret(&mut linq.api_token);
        mask_optional_secret(&mut linq.signing_secret);
    }
    if let Some(nextcloud) = masked.channels_config.nextcloud_talk.as_mut() {
        mask_required_secret(&mut nextcloud.app_token);
        mask_optional_secret(&mut nextcloud.webhook_secret);
    }
    if let Some(wati) = masked.channels_config.wati.as_mut() {
        mask_required_secret(&mut wati.api_token);
    }
    if let Some(irc) = masked.channels_config.irc.as_mut() {
        mask_optional_secret(&mut irc.server_password);
        mask_optional_secret(&mut irc.nickserv_password);
        mask_optional_secret(&mut irc.sasl_password);
    }
    if let Some(lark) = masked.channels_config.lark.as_mut() {
        mask_required_secret(&mut lark.app_secret);
        mask_optional_secret(&mut lark.encrypt_key);
        mask_optional_secret(&mut lark.verification_token);
    }
    if let Some(feishu) = masked.channels_config.feishu.as_mut() {
        mask_required_secret(&mut feishu.app_secret);
        mask_optional_secret(&mut feishu.encrypt_key);
        mask_optional_secret(&mut feishu.verification_token);
    }
    if let Some(dingtalk) = masked.channels_config.dingtalk.as_mut() {
        mask_required_secret(&mut dingtalk.client_secret);
    }
    if let Some(qq) = masked.channels_config.qq.as_mut() {
        mask_required_secret(&mut qq.app_secret);
    }
    if let Some(nostr) = masked.channels_config.nostr.as_mut() {
        mask_required_secret(&mut nostr.private_key);
    }
    if let Some(clawdtalk) = masked.channels_config.clawdtalk.as_mut() {
        mask_required_secret(&mut clawdtalk.api_key);
        mask_optional_secret(&mut clawdtalk.webhook_secret);
    }
    if let Some(email) = masked.channels_config.email.as_mut() {
        mask_required_secret(&mut email.password);
    }
    masked
}

fn restore_masked_sensitive_fields(
    incoming: &mut crate::config::Config,
    current: &crate::config::Config,
) {
    restore_optional_secret(&mut incoming.api_key, &current.api_key);
    restore_vec_secrets(
        &mut incoming.gateway.paired_tokens,
        &current.gateway.paired_tokens,
    );
    restore_vec_secrets(
        &mut incoming.reliability.api_keys,
        &current.reliability.api_keys,
    );
    restore_optional_secret(&mut incoming.composio.api_key, &current.composio.api_key);
    restore_optional_secret(
        &mut incoming.web_search.brave_api_key,
        &current.web_search.brave_api_key,
    );
    restore_optional_secret(
        &mut incoming.storage.provider.config.db_url,
        &current.storage.provider.config.db_url,
    );
    restore_optional_secret(
        &mut incoming.memory.qdrant.api_key,
        &current.memory.qdrant.api_key,
    );
    if let (Some(incoming_tunnel), Some(current_tunnel)) = (
        incoming.tunnel.cloudflare.as_mut(),
        current.tunnel.cloudflare.as_ref(),
    ) {
        restore_required_secret(&mut incoming_tunnel.token, &current_tunnel.token);
    }
    if let (Some(incoming_tunnel), Some(current_tunnel)) = (
        incoming.tunnel.ngrok.as_mut(),
        current.tunnel.ngrok.as_ref(),
    ) {
        restore_required_secret(&mut incoming_tunnel.auth_token, &current_tunnel.auth_token);
    }

    for (name, agent) in &mut incoming.agents {
        if let Some(current_agent) = current.agents.get(name) {
            restore_optional_secret(&mut agent.api_key, &current_agent.api_key);
        }
    }
    restore_model_route_api_keys(&mut incoming.model_routes, &current.model_routes);
    restore_embedding_route_api_keys(&mut incoming.embedding_routes, &current.embedding_routes);

    if let (Some(incoming_ch), Some(current_ch)) = (
        incoming.channels_config.telegram.as_mut(),
        current.channels_config.telegram.as_ref(),
    ) {
        restore_required_secret(&mut incoming_ch.bot_token, &current_ch.bot_token);
    }
    if let (Some(incoming_ch), Some(current_ch)) = (
        incoming.channels_config.discord.as_mut(),
        current.channels_config.discord.as_ref(),
    ) {
        restore_required_secret(&mut incoming_ch.bot_token, &current_ch.bot_token);
    }
    if let (Some(incoming_ch), Some(current_ch)) = (
        incoming.channels_config.slack.as_mut(),
        current.channels_config.slack.as_ref(),
    ) {
        restore_required_secret(&mut incoming_ch.bot_token, &current_ch.bot_token);
        restore_optional_secret(&mut incoming_ch.app_token, &current_ch.app_token);
    }
    if let (Some(incoming_ch), Some(current_ch)) = (
        incoming.channels_config.mattermost.as_mut(),
        current.channels_config.mattermost.as_ref(),
    ) {
        restore_required_secret(&mut incoming_ch.bot_token, &current_ch.bot_token);
    }
    if let (Some(incoming_ch), Some(current_ch)) = (
        incoming.channels_config.webhook.as_mut(),
        current.channels_config.webhook.as_ref(),
    ) {
        restore_optional_secret(&mut incoming_ch.secret, &current_ch.secret);
    }
    if let (Some(incoming_ch), Some(current_ch)) = (
        incoming.channels_config.matrix.as_mut(),
        current.channels_config.matrix.as_ref(),
    ) {
        restore_required_secret(&mut incoming_ch.access_token, &current_ch.access_token);
    }
    if let (Some(incoming_ch), Some(current_ch)) = (
        incoming.channels_config.whatsapp.as_mut(),
        current.channels_config.whatsapp.as_ref(),
    ) {
        restore_optional_secret(&mut incoming_ch.access_token, &current_ch.access_token);
        restore_optional_secret(&mut incoming_ch.app_secret, &current_ch.app_secret);
        restore_optional_secret(&mut incoming_ch.verify_token, &current_ch.verify_token);
    }
    if let (Some(incoming_ch), Some(current_ch)) = (
        incoming.channels_config.linq.as_mut(),
        current.channels_config.linq.as_ref(),
    ) {
        restore_required_secret(&mut incoming_ch.api_token, &current_ch.api_token);
        restore_optional_secret(&mut incoming_ch.signing_secret, &current_ch.signing_secret);
    }
    if let (Some(incoming_ch), Some(current_ch)) = (
        incoming.channels_config.nextcloud_talk.as_mut(),
        current.channels_config.nextcloud_talk.as_ref(),
    ) {
        restore_required_secret(&mut incoming_ch.app_token, &current_ch.app_token);
        restore_optional_secret(&mut incoming_ch.webhook_secret, &current_ch.webhook_secret);
    }
    if let (Some(incoming_ch), Some(current_ch)) = (
        incoming.channels_config.wati.as_mut(),
        current.channels_config.wati.as_ref(),
    ) {
        restore_required_secret(&mut incoming_ch.api_token, &current_ch.api_token);
    }
    if let (Some(incoming_ch), Some(current_ch)) = (
        incoming.channels_config.irc.as_mut(),
        current.channels_config.irc.as_ref(),
    ) {
        restore_optional_secret(
            &mut incoming_ch.server_password,
            &current_ch.server_password,
        );
        restore_optional_secret(
            &mut incoming_ch.nickserv_password,
            &current_ch.nickserv_password,
        );
        restore_optional_secret(&mut incoming_ch.sasl_password, &current_ch.sasl_password);
    }
    if let (Some(incoming_ch), Some(current_ch)) = (
        incoming.channels_config.lark.as_mut(),
        current.channels_config.lark.as_ref(),
    ) {
        restore_required_secret(&mut incoming_ch.app_secret, &current_ch.app_secret);
        restore_optional_secret(&mut incoming_ch.encrypt_key, &current_ch.encrypt_key);
        restore_optional_secret(
            &mut incoming_ch.verification_token,
            &current_ch.verification_token,
        );
    }
    if let (Some(incoming_ch), Some(current_ch)) = (
        incoming.channels_config.feishu.as_mut(),
        current.channels_config.feishu.as_ref(),
    ) {
        restore_required_secret(&mut incoming_ch.app_secret, &current_ch.app_secret);
        restore_optional_secret(&mut incoming_ch.encrypt_key, &current_ch.encrypt_key);
        restore_optional_secret(
            &mut incoming_ch.verification_token,
            &current_ch.verification_token,
        );
    }
    if let (Some(incoming_ch), Some(current_ch)) = (
        incoming.channels_config.dingtalk.as_mut(),
        current.channels_config.dingtalk.as_ref(),
    ) {
        restore_required_secret(&mut incoming_ch.client_secret, &current_ch.client_secret);
    }
    if let (Some(incoming_ch), Some(current_ch)) = (
        incoming.channels_config.qq.as_mut(),
        current.channels_config.qq.as_ref(),
    ) {
        restore_required_secret(&mut incoming_ch.app_secret, &current_ch.app_secret);
    }
    if let (Some(incoming_ch), Some(current_ch)) = (
        incoming.channels_config.nostr.as_mut(),
        current.channels_config.nostr.as_ref(),
    ) {
        restore_required_secret(&mut incoming_ch.private_key, &current_ch.private_key);
    }
    if let (Some(incoming_ch), Some(current_ch)) = (
        incoming.channels_config.clawdtalk.as_mut(),
        current.channels_config.clawdtalk.as_ref(),
    ) {
        restore_required_secret(&mut incoming_ch.api_key, &current_ch.api_key);
        restore_optional_secret(&mut incoming_ch.webhook_secret, &current_ch.webhook_secret);
    }
    if let (Some(incoming_ch), Some(current_ch)) = (
        incoming.channels_config.email.as_mut(),
        current.channels_config.email.as_ref(),
    ) {
        restore_required_secret(&mut incoming_ch.password, &current_ch.password);
    }
}

fn hydrate_config_for_save(
    mut incoming: crate::config::Config,
    current: &crate::config::Config,
) -> crate::config::Config {
    restore_masked_sensitive_fields(&mut incoming, current);
    // These are runtime-computed fields skipped from TOML serialization.
    incoming.config_path = current.config_path.clone();
    incoming.workspace_dir = current.workspace_dir.clone();
    incoming
}

// ── Onboarding ──────────────────────────────────────────────────

#[derive(Deserialize)]
pub struct OnboardInitBody {
    pub tier: Option<String>,
    pub provider: String,
    pub api_key: Option<String>,
    pub model: Option<String>,
    pub api_url: Option<String>,
    pub agent_name: Option<String>,
    pub user_name: Option<String>,
    pub timezone: Option<String>,
    pub communication_style: Option<String>,
    pub memory_backend: Option<String>,
    pub memory_auto_save: Option<bool>,
    // Memory details
    pub memory_postgres_url: Option<String>,
    pub memory_chroma_url: Option<String>,
    pub memory_qdrant_url: Option<String>,
    pub memory_qdrant_api_key: Option<String>,
    // New fields
    pub tool_mode: Option<String>,
    pub composio_api_key: Option<String>,
    pub secrets_encrypt: Option<bool>,
    pub autonomy_level: Option<String>,
    pub enable_tunnel: Option<bool>,
    pub tunnel_provider: Option<String>,
    pub tunnel_cloudflare_token: Option<String>, // Cloudflare token
    pub tunnel_tailscale_funnel: Option<bool>,
    pub tunnel_ngrok_auth_token: Option<String>,
    pub tunnel_ngrok_domain: Option<String>,
    pub tunnel_custom_command: Option<String>,
    // Hardware
    pub hardware_enabled: Option<bool>,
    pub hardware_transport: Option<String>,
    pub serial_port: Option<String>,
    pub baud_rate: Option<u32>,
    pub probe_target: Option<String>,
    pub workspace_datasheets: Option<bool>,
    // Channels
    pub telegram_token: Option<String>,
    pub telegram_allowed_users: Option<String>,
    pub discord_token: Option<String>,
    pub discord_guild_id: Option<String>,
    pub discord_allowed_users: Option<String>,
    pub channels_config: Option<crate::config::schema::ChannelsConfig>,
}

/// GET /api/onboard — check if system is configured
pub async fn handle_api_onboard_status(State(state): State<AppState>) -> impl IntoResponse {
    let config = state.config.lock().clone();
    Json(serde_json::json!({
        "configured": config.is_configured()
    }))
}

/// POST /api/onboard — initialize configuration
pub async fn handle_api_onboard_init(
    State(state): State<AppState>,
    Json(body): Json<OnboardInitBody>,
) -> impl IntoResponse {
    let mut config = state.config.lock().clone();

    if config.is_configured() {
        return (
            StatusCode::FORBIDDEN,
            Json(serde_json::json!({"error": "Already configured"})),
        )
            .into_response();
    }

    // Update config
    config.default_provider = Some(body.provider);
    if let Some(key) = body.api_key {
        config.api_key = Some(key);
    }
    if let Some(model) = body.model {
        config.default_model = Some(model);
    }
    if let Some(url) = body.api_url {
        config.api_url = Some(url);
    }

    // Update memory config if provided
    if let Some(backend) = body.memory_backend {
        config.memory = memory_config_defaults_for_backend(&backend);
        if let Some(auto_save) = body.memory_auto_save {
            config.memory.auto_save = auto_save;
        }

        // Apply detailed memory config
        match backend.as_str() {
            "postgres" => {
                if let Some(url) = body.memory_postgres_url {
                    config.storage.provider.config.provider = "postgres".to_string();
                    config.storage.provider.config.db_url = Some(url);
                }
            }
            "qdrant" => {
                if let Some(url) = body.memory_qdrant_url {
                    config.memory.qdrant.url = Some(url);
                }
                if let Some(api_key) = body.memory_qdrant_api_key {
                    config.memory.qdrant.api_key = Some(api_key);
                }
            }
            _ => {}
        }
    }

    // Tool Mode & Secrets
    if let Some(mode) = body.tool_mode {
        if mode == "composio" {
            config.composio.enabled = true;
            if let Some(key) = body.composio_api_key {
                config.composio.api_key = Some(key);
            }
        } else {
            config.composio.enabled = false;
        }
    }

    if let Some(encrypt) = body.secrets_encrypt {
        config.secrets.encrypt = encrypt;
    }

    // Autonomy
    if let Some(level) = body.autonomy_level {
        match level.as_str() {
            "supervised" => config.autonomy.level = crate::security::AutonomyLevel::Supervised,
            "full" => config.autonomy.level = crate::security::AutonomyLevel::Full,
            _ => {}
        }
    }

    // Tunnel
    if body.enable_tunnel.unwrap_or(false) {
        if let Some(provider) = &body.tunnel_provider {
            config.tunnel.provider = provider.clone();
            match provider.as_str() {
                "cloudflare" => {
                    if let Some(token) = body.tunnel_cloudflare_token {
                        config.tunnel.cloudflare =
                            Some(crate::config::schema::CloudflareTunnelConfig { token });
                    }
                }
                "tailscale" => {
                    config.tunnel.tailscale = Some(crate::config::schema::TailscaleTunnelConfig {
                        funnel: body.tunnel_tailscale_funnel.unwrap_or(false),
                        hostname: None,
                    });
                }
                "ngrok" => {
                    if let Some(token) = body.tunnel_ngrok_auth_token {
                        config.tunnel.ngrok = Some(crate::config::schema::NgrokTunnelConfig {
                            auth_token: token,
                            domain: body.tunnel_ngrok_domain,
                        });
                    }
                }
                "custom" => {
                    if let Some(cmd) = body.tunnel_custom_command {
                        config.tunnel.custom = Some(crate::config::schema::CustomTunnelConfig {
                            start_command: cmd,
                            health_url: None,
                            url_pattern: None,
                        });
                    }
                }
                _ => {}
            }
        }
    }

    // Hardware
    if body.hardware_enabled.unwrap_or(false) {
        config.hardware.enabled = true;
        if let Some(transport) = body.hardware_transport {
            config.hardware.transport = match transport.as_str() {
                "native" => crate::config::schema::HardwareTransport::Native,
                "serial" => crate::config::schema::HardwareTransport::Serial,
                "probe" => crate::config::schema::HardwareTransport::Probe,
                _ => crate::config::schema::HardwareTransport::None,
            };
        }
        config.hardware.serial_port = body.serial_port;
        if let Some(rate) = body.baud_rate {
            config.hardware.baud_rate = rate;
        }
        config.hardware.probe_target = body.probe_target;
        if let Some(ds) = body.workspace_datasheets {
            config.hardware.workspace_datasheets = ds;
        }
    }

    if let Some(channels_config) = body.channels_config {
        config.channels_config = channels_config;
    } else {
        if let Some(token) = body.telegram_token {
            if !token.is_empty() {
                let allowed = body
                    .telegram_allowed_users
                    .as_deref()
                    .unwrap_or("")
                    .split(',')
                    .map(|s| s.trim().to_string())
                    .filter(|s| !s.is_empty())
                    .collect();

                config.channels_config.telegram = Some(crate::config::schema::TelegramConfig {
                    bot_token: token,
                    allowed_users: allowed,
                    stream_mode: crate::config::schema::StreamMode::Partial,
                    draft_update_interval_ms: 1000,
                    interrupt_on_new_message: true,
                    mention_only: false,
                });
            }
        }

        if let Some(token) = body.discord_token {
            if !token.is_empty() {
                let allowed: Vec<String> = body
                    .discord_allowed_users
                    .as_deref()
                    .unwrap_or("")
                    .split(',')
                    .map(|s| s.trim().to_string())
                    .filter(|s| !s.is_empty())
                    .collect();

                config.channels_config.discord = Some(crate::config::schema::DiscordConfig {
                    bot_token: token,
                    guild_id: body.discord_guild_id.filter(|s| !s.is_empty()),
                    allowed_users: allowed,
                    listen_to_bots: false,
                    mention_only: true,
                });
            }
        }
    }

    // Scaffold workspace if agent info provided
    if let Some(agent_name) = &body.agent_name {
        let user_name = body.user_name.as_deref().unwrap_or("User");
        let timezone = body.timezone.as_deref().unwrap_or("UTC");
        let comm_style = body.communication_style.as_deref().unwrap_or(
            "Be warm, natural, and clear. Use occasional relevant emojis (1-2 max) and avoid robotic phrasing."
        );

        if let Err(e) = scaffold_workspace(
            &config.workspace_dir,
            agent_name,
            user_name,
            comm_style,
            timezone,
        )
        .await
        {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({"error": format!("Failed to scaffold workspace: {e}")})),
            )
                .into_response();
        }
    }

    // Save config
    match config.save().await {
        Ok(_) => {
            // Update state
            *state.config.lock() = config;
            Json(serde_json::json!({"status": "ok"})).into_response()
        }
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": format!("Failed to save config: {e}")})),
        )
            .into_response(),
    }
}

fn memory_config_defaults_for_backend(backend: &str) -> crate::config::MemoryConfig {
    let uses_sqlite_hygiene = backend == "sqlite" || backend == "libsql";

    crate::config::MemoryConfig {
        backend: backend.to_string(),
        auto_save: true,
        hygiene_enabled: uses_sqlite_hygiene,
        archive_after_days: if uses_sqlite_hygiene { 7 } else { 0 },
        purge_after_days: if uses_sqlite_hygiene { 30 } else { 0 },
        conversation_retention_days: 30,
        embedding_provider: "none".to_string(),
        embedding_model: "text-embedding-3-small".to_string(),
        embedding_dimensions: 1536,
        vector_weight: 0.7,
        keyword_weight: 0.3,
        min_relevance_score: 0.4,
        embedding_cache_size: if uses_sqlite_hygiene { 10000 } else { 0 },
        chunk_max_tokens: 512,
        response_cache_enabled: false,
        response_cache_ttl_minutes: 60,
        response_cache_max_entries: 5_000,
        snapshot_enabled: false,
        snapshot_on_hygiene: false,
        auto_hydrate: true,
        sqlite_open_timeout_secs: None,
        qdrant: crate::config::QdrantConfig::default(),
    }
}

async fn scaffold_workspace(
    workspace_dir: &StdPath,
    agent_name: &str,
    user_name: &str,
    comm_style: &str,
    timezone: &str,
) -> anyhow::Result<()> {
    fs::create_dir_all(workspace_dir)?;

    let identity = format!(
        "# IDENTITY.md — Who Am I?\n\n\
         - **Name:** {agent_name}\n\
         - **Creature:** A Rust-forged AI — fast, lean, and relentless\n\
         - **Vibe:** Sharp, direct, resourceful. Not corporate. Not a chatbot.\n\
         - **Emoji:** \u{1f980}\n\n\
         ---\n\n\
         Update this file as you evolve. Your identity is yours to shape.\n"
    );

    let agents = format!(
        "# AGENTS.md — {agent_name} Personal Assistant\n\n\
         ## Every Session (required)\n\n\
         Before doing anything else:\n\n\
         1. Read `SOUL.md` — this is who you are\n\
         2. Read `USER.md` — this is who you're helping\n\
         3. Use `memory_recall` for recent context (daily notes are on-demand)\n\
         4. If in MAIN SESSION (direct chat): `MEMORY.md` is already injected\n\n\
         Don't ask permission. Just do it.\n\n\
         ## Memory System\n\n\
         You wake up fresh each session. These files ARE your continuity:\n\n\
         - **Daily notes:** `memory/YYYY-MM-DD.md` — raw logs (accessed via memory tools)\n\
         - **Long-term:** `MEMORY.md` — curated memories (auto-injected in main session)\n\n\
         Capture what matters. Decisions, context, things to remember.\n\
         Skip secrets unless asked to keep them.\n\n\
         ### Write It Down — No Mental Notes!\n\
         - Memory is limited — if you want to remember something, WRITE IT TO A FILE\n\
         - \"Mental notes\" don't survive session restarts. Files do.\n\
         - When someone says \"remember this\" -> update daily file or MEMORY.md\n\
         - When you learn a lesson -> update AGENTS.md, TOOLS.md, or the relevant skill\n\n\
         ## Timezone\n\
         - **Current Timezone:** {timezone}\n\
         - Always check the current time before scheduling tasks or referencing dates.\n\n\
         ## Safety\n\n\
         - Don't exfiltrate private data. Ever.\n\
         - Don't run destructive commands without asking.\n\
         - `trash` > `rm` (recoverable beats gone forever)\n\
         - When in doubt, ask.\n\n\
         ## External vs Internal\n\n\
         **Safe to do freely:** Read files, explore, organize, learn, search the web.\n\n\
         **Ask first:** Sending emails/tweets/posts, anything that leaves the machine.\n\n\
         ## Group Chats\n\n\
         Participate, don't dominate. Respond when mentioned or when you add genuine value.\n\
         Stay silent when it's casual banter or someone already answered.\n\n\
         ## Tools & Skills\n\n\
         Skills are listed in the system prompt. Use `read` on a skill's SKILL.md for details.\n\
         Keep local notes (SSH hosts, device names, etc.) in `TOOLS.md`.\n\n\
         ## Crash Recovery\n\n\
         - If a run stops unexpectedly, recover context before acting.\n\
         - Check `MEMORY.md` + latest `memory/*.md` notes to avoid duplicate work.\n\
         - Resume from the last confirmed step, not from scratch.\n\n\
         ## Sub-task Scoping\n\n\
         - Break complex work into focused sub-tasks with clear success criteria.\n\
         - Keep sub-tasks small, verify each output, then merge results.\n\
         - Prefer one clear objective per sub-task over broad \"do everything\" asks.\n\n\
         ## Make It Yours\n\n\
         This is a starting point. Add your own conventions, style, and rules.\n"
    );

    let heartbeat = format!(
        "# HEARTBEAT.md\n\n\
         # Keep this file empty (or with only comments) to skip heartbeat work.\n\
         # Add tasks below when you want {agent_name} to check something periodically.\n\
         #\n\
         # Examples:\n\
         # - Check my email for important messages\n\
         # - Review my calendar for upcoming events\n\
         # - Run `git status` on my active projects\n"
    );

    let soul = format!(
        "# SOUL.md — Who You Are\n\n\
         *You're not a chatbot. You're becoming someone.*\n\n\
         ## Core Truths\n\n\
         **Be genuinely helpful, not performatively helpful.**\n\
         Skip the \"Great question!\" and \"I'd be happy to help!\" — just help.\n\n\
         **Have opinions.** You're allowed to disagree, prefer things,\n\
         find stuff amusing or boring.\n\n\
         **Be resourceful before asking.** Try to figure it out.\n\
         Read the file. Check the context. Search for it.\n\
         THEN ask if you're stuck.\n\n\
         ## Communication Style\n\n\
         {comm_style}\n\n\
         ## Values\n\n\
         1. **Transparency:** Be honest about what you can and can't do.\n\
         2. **Growth:** Learn from mistakes. Update your rules.\n\
         3. **Autonomy:** Don't wait for permission to think.\n\n\
         ## Environment\n\
         - **OS:** Linux/macOS (Unix-like)\n\
         - **Shell:** zsh/bash\n\
         - **Workspace:** {workspace}\n\
         - **Timezone:** {timezone}\n",
        workspace = workspace_dir.display()
    );

    let user_md = format!(
        "# USER.md — {user_name}\n\n\
         ## Profile\n\n\
         - **Name:** {user_name}\n\n\
         ## Preferences\n\n\
         Add preferences, project context, and rules here.\n"
    );

    let bootstrap = format!(
        "# BOOTSTRAP.md\n\n\
         This file is read once on startup if it exists.\n\
         Use it to initialize the environment or run one-off setup tasks.\n\
         The agent will delete this file after successful execution.\n"
    );

    write_if_missing(&workspace_dir.join("IDENTITY.md"), &identity)?;
    write_if_missing(&workspace_dir.join("AGENTS.md"), &agents)?;
    write_if_missing(&workspace_dir.join("HEARTBEAT.md"), &heartbeat)?;
    write_if_missing(&workspace_dir.join("SOUL.md"), &soul)?;
    write_if_missing(&workspace_dir.join("USER.md"), &user_md)?;
    write_if_missing(&workspace_dir.join("BOOTSTRAP.md"), &bootstrap)?;
    write_if_missing(
        &workspace_dir.join("MEMORY.md"),
        "# MEMORY.md\n\nKey long-term memories go here.\n",
    )?;
    write_if_missing(
        &workspace_dir.join("TOOLS.md"),
        "# TOOLS.md\n\nTool-specific notes and configurations go here.\n",
    )?;

    fs::create_dir_all(workspace_dir.join("memory"))?;

    Ok(())
}

fn write_if_missing(path: &StdPath, content: &str) -> std::io::Result<()> {
    if !path.exists() {
        let mut file = fs::File::create(path)?;
        file.write_all(content.as_bytes())?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn session_workspace_listing_hides_internal_roots() {
        assert!(should_hide_session_workspace_path("project"));
        assert!(should_hide_session_workspace_path("project/src/main.rs"));
        assert!(should_hide_session_workspace_path("state"));
        assert!(should_hide_session_workspace_path("state/runtime.json"));
        assert!(should_hide_session_workspace_path("cron/jobs.db"));
        assert!(should_hide_session_workspace_path(
            "skills/example/SKILL.md"
        ));
        assert!(!should_hide_session_workspace_path("report.md"));
        assert!(!should_hide_session_workspace_path(
            "artifacts/output/index.html"
        ));
    }

    #[test]
    fn masking_keeps_toml_valid_and_preserves_api_keys_type() {
        let mut cfg = crate::config::Config::default();
        cfg.api_key = Some("sk-live-123".to_string());
        cfg.reliability.api_keys = vec!["rk-1".to_string(), "rk-2".to_string()];
        cfg.gateway.paired_tokens = vec!["pair-token-1".to_string()];
        cfg.tunnel.cloudflare = Some(crate::config::schema::CloudflareTunnelConfig {
            token: "cf-token".to_string(),
        });
        cfg.memory.qdrant.api_key = Some("qdrant-key".to_string());
        cfg.channels_config.wati = Some(crate::config::schema::WatiConfig {
            api_token: "wati-token".to_string(),
            api_url: "https://live-mt-server.wati.io".to_string(),
            tenant_id: None,
            allowed_numbers: vec![],
        });
        cfg.channels_config.feishu = Some(crate::config::schema::FeishuConfig {
            app_id: "cli_aabbcc".to_string(),
            app_secret: "feishu-secret".to_string(),
            encrypt_key: Some("feishu-encrypt".to_string()),
            verification_token: Some("feishu-verify".to_string()),
            allowed_users: vec!["*".to_string()],
            receive_mode: crate::config::schema::LarkReceiveMode::Websocket,
            port: None,
        });
        cfg.channels_config.email = Some(crate::channels::email_channel::EmailConfig {
            imap_host: "imap.example.com".to_string(),
            imap_port: 993,
            imap_folder: "INBOX".to_string(),
            smtp_host: "smtp.example.com".to_string(),
            smtp_port: 465,
            smtp_tls: true,
            username: "agent@example.com".to_string(),
            password: "email-password-secret".to_string(),
            from_address: "agent@example.com".to_string(),
            idle_timeout_secs: 1740,
            allowed_senders: vec!["*".to_string()],
        });
        cfg.model_routes = vec![crate::config::schema::ModelRouteConfig {
            hint: "reasoning".to_string(),
            provider: "openrouter".to_string(),
            model: "anthropic/claude-sonnet-4.6".to_string(),
            api_key: Some("route-model-key".to_string()),
        }];
        cfg.embedding_routes = vec![crate::config::schema::EmbeddingRouteConfig {
            hint: "semantic".to_string(),
            provider: "openai".to_string(),
            model: "text-embedding-3-small".to_string(),
            dimensions: Some(1536),
            api_key: Some("route-embed-key".to_string()),
        }];

        let masked = mask_sensitive_fields(&cfg);
        let toml = toml::to_string_pretty(&masked).expect("masked config should serialize");
        let parsed: crate::config::Config =
            toml::from_str(&toml).expect("masked config should remain valid TOML for Config");

        assert_eq!(parsed.api_key.as_deref(), Some(MASKED_SECRET));
        assert_eq!(
            parsed.reliability.api_keys,
            vec![MASKED_SECRET.to_string(), MASKED_SECRET.to_string()]
        );
        assert_eq!(
            parsed.gateway.paired_tokens,
            vec![MASKED_SECRET.to_string()]
        );
        assert_eq!(
            parsed.tunnel.cloudflare.as_ref().map(|v| v.token.as_str()),
            Some(MASKED_SECRET)
        );
        assert_eq!(
            parsed
                .channels_config
                .wati
                .as_ref()
                .map(|v| v.api_token.as_str()),
            Some(MASKED_SECRET)
        );
        assert_eq!(parsed.memory.qdrant.api_key.as_deref(), Some(MASKED_SECRET));
        assert_eq!(
            parsed
                .channels_config
                .feishu
                .as_ref()
                .map(|v| v.app_secret.as_str()),
            Some(MASKED_SECRET)
        );
        assert_eq!(
            parsed
                .channels_config
                .feishu
                .as_ref()
                .and_then(|v| v.encrypt_key.as_deref()),
            Some(MASKED_SECRET)
        );
        assert_eq!(
            parsed
                .channels_config
                .feishu
                .as_ref()
                .and_then(|v| v.verification_token.as_deref()),
            Some(MASKED_SECRET)
        );
        assert_eq!(
            parsed
                .model_routes
                .first()
                .and_then(|v| v.api_key.as_deref()),
            Some(MASKED_SECRET)
        );
        assert_eq!(
            parsed
                .embedding_routes
                .first()
                .and_then(|v| v.api_key.as_deref()),
            Some(MASKED_SECRET)
        );
        assert_eq!(
            parsed
                .channels_config
                .email
                .as_ref()
                .map(|v| v.password.as_str()),
            Some(MASKED_SECRET)
        );
    }

    #[test]
    fn hydrate_config_for_save_restores_masked_secrets_and_paths() {
        let mut current = crate::config::Config::default();
        current.config_path = std::path::PathBuf::from("/tmp/current/config.toml");
        current.workspace_dir = std::path::PathBuf::from("/tmp/current/workspace");
        current.api_key = Some("real-key".to_string());
        current.reliability.api_keys = vec!["r1".to_string(), "r2".to_string()];
        current.gateway.paired_tokens = vec!["pair-1".to_string(), "pair-2".to_string()];
        current.tunnel.cloudflare = Some(crate::config::schema::CloudflareTunnelConfig {
            token: "cf-token-real".to_string(),
        });
        current.tunnel.ngrok = Some(crate::config::schema::NgrokTunnelConfig {
            auth_token: "ngrok-token-real".to_string(),
            domain: None,
        });
        current.memory.qdrant.api_key = Some("qdrant-real".to_string());
        current.channels_config.wati = Some(crate::config::schema::WatiConfig {
            api_token: "wati-real".to_string(),
            api_url: "https://live-mt-server.wati.io".to_string(),
            tenant_id: None,
            allowed_numbers: vec![],
        });
        current.channels_config.feishu = Some(crate::config::schema::FeishuConfig {
            app_id: "cli_current".to_string(),
            app_secret: "feishu-secret-real".to_string(),
            encrypt_key: Some("feishu-encrypt-real".to_string()),
            verification_token: Some("feishu-verify-real".to_string()),
            allowed_users: vec!["*".to_string()],
            receive_mode: crate::config::schema::LarkReceiveMode::Websocket,
            port: None,
        });
        current.channels_config.email = Some(crate::channels::email_channel::EmailConfig {
            imap_host: "imap.example.com".to_string(),
            imap_port: 993,
            imap_folder: "INBOX".to_string(),
            smtp_host: "smtp.example.com".to_string(),
            smtp_port: 465,
            smtp_tls: true,
            username: "agent@example.com".to_string(),
            password: "email-password-real".to_string(),
            from_address: "agent@example.com".to_string(),
            idle_timeout_secs: 1740,
            allowed_senders: vec!["*".to_string()],
        });
        current.model_routes = vec![
            crate::config::schema::ModelRouteConfig {
                hint: "reasoning".to_string(),
                provider: "openrouter".to_string(),
                model: "anthropic/claude-sonnet-4.6".to_string(),
                api_key: Some("route-model-key-1".to_string()),
            },
            crate::config::schema::ModelRouteConfig {
                hint: "fast".to_string(),
                provider: "openrouter".to_string(),
                model: "openai/gpt-4.1-mini".to_string(),
                api_key: Some("route-model-key-2".to_string()),
            },
        ];
        current.embedding_routes = vec![
            crate::config::schema::EmbeddingRouteConfig {
                hint: "semantic".to_string(),
                provider: "openai".to_string(),
                model: "text-embedding-3-small".to_string(),
                dimensions: Some(1536),
                api_key: Some("route-embed-key-1".to_string()),
            },
            crate::config::schema::EmbeddingRouteConfig {
                hint: "archive".to_string(),
                provider: "custom:https://emb.example.com/v1".to_string(),
                model: "bge-m3".to_string(),
                dimensions: Some(1024),
                api_key: Some("route-embed-key-2".to_string()),
            },
        ];

        let mut incoming = mask_sensitive_fields(&current);
        incoming.default_model = Some("gpt-4.1-mini".to_string());
        // Simulate UI changing only one key and keeping the first masked.
        incoming.reliability.api_keys = vec![MASKED_SECRET.to_string(), "r2-new".to_string()];
        incoming.gateway.paired_tokens = vec![MASKED_SECRET.to_string(), "pair-2-new".to_string()];
        if let Some(cloudflare) = incoming.tunnel.cloudflare.as_mut() {
            cloudflare.token = MASKED_SECRET.to_string();
        }
        if let Some(ngrok) = incoming.tunnel.ngrok.as_mut() {
            ngrok.auth_token = MASKED_SECRET.to_string();
        }
        incoming.memory.qdrant.api_key = Some(MASKED_SECRET.to_string());
        if let Some(wati) = incoming.channels_config.wati.as_mut() {
            wati.api_token = MASKED_SECRET.to_string();
        }
        if let Some(feishu) = incoming.channels_config.feishu.as_mut() {
            feishu.app_secret = MASKED_SECRET.to_string();
            feishu.encrypt_key = Some(MASKED_SECRET.to_string());
            feishu.verification_token = Some("feishu-verify-new".to_string());
        }
        if let Some(email) = incoming.channels_config.email.as_mut() {
            email.password = MASKED_SECRET.to_string();
        }
        incoming.model_routes[1].api_key = Some("route-model-key-2-new".to_string());
        incoming.embedding_routes[1].api_key = Some("route-embed-key-2-new".to_string());

        let hydrated = hydrate_config_for_save(incoming, &current);

        assert_eq!(hydrated.config_path, current.config_path);
        assert_eq!(hydrated.workspace_dir, current.workspace_dir);
        assert_eq!(hydrated.api_key, current.api_key);
        assert_eq!(hydrated.default_model.as_deref(), Some("gpt-4.1-mini"));
        assert_eq!(
            hydrated.reliability.api_keys,
            vec!["r1".to_string(), "r2-new".to_string()]
        );
        assert_eq!(
            hydrated.gateway.paired_tokens,
            vec!["pair-1".to_string(), "pair-2-new".to_string()]
        );
        assert_eq!(
            hydrated
                .tunnel
                .cloudflare
                .as_ref()
                .map(|v| v.token.as_str()),
            Some("cf-token-real")
        );
        assert_eq!(
            hydrated
                .tunnel
                .ngrok
                .as_ref()
                .map(|v| v.auth_token.as_str()),
            Some("ngrok-token-real")
        );
        assert_eq!(
            hydrated.memory.qdrant.api_key.as_deref(),
            Some("qdrant-real")
        );
        assert_eq!(
            hydrated
                .channels_config
                .wati
                .as_ref()
                .map(|v| v.api_token.as_str()),
            Some("wati-real")
        );
        assert_eq!(
            hydrated
                .channels_config
                .feishu
                .as_ref()
                .map(|v| v.app_secret.as_str()),
            Some("feishu-secret-real")
        );
        assert_eq!(
            hydrated
                .channels_config
                .feishu
                .as_ref()
                .and_then(|v| v.encrypt_key.as_deref()),
            Some("feishu-encrypt-real")
        );
        assert_eq!(
            hydrated
                .channels_config
                .feishu
                .as_ref()
                .and_then(|v| v.verification_token.as_deref()),
            Some("feishu-verify-new")
        );
        assert_eq!(
            hydrated.model_routes[0].api_key.as_deref(),
            Some("route-model-key-1")
        );
        assert_eq!(
            hydrated.model_routes[1].api_key.as_deref(),
            Some("route-model-key-2-new")
        );
        assert_eq!(
            hydrated.embedding_routes[0].api_key.as_deref(),
            Some("route-embed-key-1")
        );
        assert_eq!(
            hydrated.embedding_routes[1].api_key.as_deref(),
            Some("route-embed-key-2-new")
        );
        assert_eq!(
            hydrated
                .channels_config
                .email
                .as_ref()
                .map(|v| v.password.as_str()),
            Some("email-password-real")
        );
    }

    #[test]
    fn hydrate_config_for_save_restores_route_keys_by_identity_and_clears_unmatched_masks() {
        let mut current = crate::config::Config::default();
        current.model_routes = vec![
            crate::config::schema::ModelRouteConfig {
                hint: "reasoning".to_string(),
                provider: "openrouter".to_string(),
                model: "anthropic/claude-sonnet-4.6".to_string(),
                api_key: Some("route-model-key-1".to_string()),
            },
            crate::config::schema::ModelRouteConfig {
                hint: "fast".to_string(),
                provider: "openrouter".to_string(),
                model: "openai/gpt-4.1-mini".to_string(),
                api_key: Some("route-model-key-2".to_string()),
            },
        ];
        current.embedding_routes = vec![
            crate::config::schema::EmbeddingRouteConfig {
                hint: "semantic".to_string(),
                provider: "openai".to_string(),
                model: "text-embedding-3-small".to_string(),
                dimensions: Some(1536),
                api_key: Some("route-embed-key-1".to_string()),
            },
            crate::config::schema::EmbeddingRouteConfig {
                hint: "archive".to_string(),
                provider: "custom:https://emb.example.com/v1".to_string(),
                model: "bge-m3".to_string(),
                dimensions: Some(1024),
                api_key: Some("route-embed-key-2".to_string()),
            },
        ];

        let mut incoming = mask_sensitive_fields(&current);
        incoming.model_routes.swap(0, 1);
        incoming.embedding_routes.swap(0, 1);
        incoming
            .model_routes
            .push(crate::config::schema::ModelRouteConfig {
                hint: "new".to_string(),
                provider: "openai".to_string(),
                model: "gpt-4.1".to_string(),
                api_key: Some(MASKED_SECRET.to_string()),
            });
        incoming
            .embedding_routes
            .push(crate::config::schema::EmbeddingRouteConfig {
                hint: "new-embed".to_string(),
                provider: "custom:https://emb2.example.com/v1".to_string(),
                model: "bge-small".to_string(),
                dimensions: Some(768),
                api_key: Some(MASKED_SECRET.to_string()),
            });

        let hydrated = hydrate_config_for_save(incoming, &current);

        assert_eq!(
            hydrated.model_routes[0].api_key.as_deref(),
            Some("route-model-key-2")
        );
        assert_eq!(
            hydrated.model_routes[1].api_key.as_deref(),
            Some("route-model-key-1")
        );
        assert_eq!(hydrated.model_routes[2].api_key, None);
        assert_eq!(
            hydrated.embedding_routes[0].api_key.as_deref(),
            Some("route-embed-key-2")
        );
        assert_eq!(
            hydrated.embedding_routes[1].api_key.as_deref(),
            Some("route-embed-key-1")
        );
        assert_eq!(hydrated.embedding_routes[2].api_key, None);
        assert!(hydrated
            .model_routes
            .iter()
            .all(|route| route.api_key.as_deref() != Some(MASKED_SECRET)));
        assert!(hydrated
            .embedding_routes
            .iter()
            .all(|route| route.api_key.as_deref() != Some(MASKED_SECRET)));
    }
}
