//! WebSocket agent chat handler.
//!
//! Protocol:
//! ```text
//! Client -> Server: {"type":"message","content":"Hello"}
//! Client -> Server: {"type":"session_policy_update","autonomy_level":"supervised"}
//! Server -> Client: {"type":"session_policy", ...}
//! Server -> Client: {"type":"chunk","content":"Hi! "}
//! Server -> Client: {"type":"tool_call","name":"shell","args":{...}}
//! Server -> Client: {"type":"tool_result","name":"shell","output":"..."}
//! Server -> Client: {"type":"done","full_response":"..."}
//! ```

use super::AppState;
use crate::agent::loop_::is_tool_loop_cancelled;
use crate::approval::{ApprovalManager, ApprovalPrompter, ApprovalRequest, ApprovalResponse};
use crate::hooks::{HookHandler, HookResult, HookRunner};
use crate::tools::traits::ToolResult;
use axum::{
    extract::{
        ws::{Message, WebSocket},
        Query, State, WebSocketUpgrade,
    },
    response::IntoResponse,
};
use futures_util::{SinkExt, StreamExt};
use parking_lot::Mutex;
use serde::Deserialize;
use std::collections::{BTreeSet, HashMap};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tokio::sync::{mpsc, oneshot};
use tokio_util::sync::CancellationToken;
use tracing::warn;
use uuid::Uuid;

const REASONING_SENTINEL: &str = "\x01REASONING\x01";
const REASONING_DELTA_SENTINEL: &str = "\x01REASONING_DELTA\x01";

#[derive(Deserialize)]
pub struct WsQuery {
    pub token: Option<String>,
    pub session: Option<String>,
}

enum WsHookEvent {
    Reasoning {
        content: String,
    },
    ToolCall {
        name: String,
        args: serde_json::Value,
    },
    ToolResult {
        name: String,
        output: String,
        error: Option<String>,
    },
}

struct WsHookHandler {
    tx: mpsc::UnboundedSender<WsHookEvent>,
}

struct PendingApprovalRequest {
    request_id: String,
    tool_name: String,
    arguments: serde_json::Value,
}

struct GatewayApprovalPrompter {
    tx: mpsc::Sender<PendingApprovalRequest>,
    pending: Arc<Mutex<HashMap<String, oneshot::Sender<ApprovalResponse>>>>,
}

#[async_trait::async_trait]
impl ApprovalPrompter for GatewayApprovalPrompter {
    async fn prompt(&self, request: &ApprovalRequest, _channel: &str) -> ApprovalResponse {
        let request_id = Uuid::new_v4().to_string();
        let (tx, rx) = oneshot::channel();
        self.pending.lock().insert(request_id.clone(), tx);

        let queued = self
            .tx
            .send(PendingApprovalRequest {
                request_id: request_id.clone(),
                tool_name: request.tool_name.clone(),
                arguments: request.arguments.clone(),
            })
            .await;
        if queued.is_err() {
            self.pending.lock().remove(&request_id);
            return ApprovalResponse::No;
        }

        rx.await.unwrap_or(ApprovalResponse::No)
    }
}

async fn store_history_event(
    state: &AppState,
    sender_key: &str,
    turn: crate::providers::ChatMessage,
) {
    if let Err(err) = super::store_conversation_turn(state.mem.clone(), sender_key, &turn).await {
        warn!("Failed to store chat history event: {err:#}");
    }
}

async fn flush_pending_reasoning(
    state: &AppState,
    sender_key: &str,
    pending_reasoning: &mut String,
) {
    let content = pending_reasoning.trim();
    if content.is_empty() {
        pending_reasoning.clear();
        return;
    }
    store_history_event(
        state,
        sender_key,
        crate::providers::ChatMessage {
            role: "reasoning".to_string(),
            content: content.to_string(),
        },
    )
    .await;
    pending_reasoning.clear();
}

fn drain_pending_approvals(
    pending: &Arc<Mutex<HashMap<String, oneshot::Sender<ApprovalResponse>>>>,
    decision: ApprovalResponse,
) {
    let waiting = {
        let mut pending = pending.lock();
        pending.drain().map(|(_, tx)| tx).collect::<Vec<_>>()
    };
    for tx in waiting {
        let _ = tx.send(decision);
    }
}

#[async_trait::async_trait]
impl HookHandler for WsHookHandler {
    fn name(&self) -> &str {
        "ws-tool-events"
    }

    async fn before_tool_call(
        &self,
        name: String,
        args: serde_json::Value,
    ) -> HookResult<(String, serde_json::Value)> {
        let _ = self.tx.send(WsHookEvent::ToolCall {
            name: name.clone(),
            args: args.clone(),
        });
        HookResult::Continue((name, args))
    }

    async fn on_after_tool_call(
        &self,
        tool: &str,
        result: &ToolResult,
        _duration: std::time::Duration,
    ) {
        let _ = self.tx.send(WsHookEvent::ToolResult {
            name: tool.to_string(),
            output: result.output.clone(),
            error: result.error.clone(),
        });
    }

    async fn on_llm_output(&self, response: &crate::providers::ChatResponse) {
        let Some(content) = response
            .reasoning_content
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
        else {
            return;
        };
        let _ = self.tx.send(WsHookEvent::Reasoning {
            content: content.to_string(),
        });
    }
}

fn progress_payload(delta: &str) -> Option<serde_json::Value> {
    let trimmed = delta.trim();
    if trimmed == "🤔 Thinking..." {
        return Some(serde_json::json!({
            "type": "progress",
            "progress_kind": "thinking",
            "round": 1,
        }));
    }

    if let Some(round) = trimmed
        .strip_prefix("🤔 Thinking (round ")
        .and_then(|rest| rest.strip_suffix(")..."))
        .and_then(|value| value.parse::<u32>().ok())
    {
        return Some(serde_json::json!({
            "type": "progress",
            "progress_kind": "thinking",
            "round": round,
        }));
    }

    if let Some(rest) = trimmed.strip_prefix("💬 Got ") {
        let (count_text, after_count) = rest.split_once(" tool call(s) (")?;
        let count = count_text.parse::<u32>().ok()?;
        let secs = after_count.strip_suffix("s)")?.parse::<u64>().ok()?;
        return Some(serde_json::json!({
            "type": "progress",
            "progress_kind": "tool_calls",
            "count": count,
            "seconds": secs,
        }));
    }

    if let Some(rest) = trimmed.strip_prefix("⏳ ") {
        let (tool_name, hint) = if let Some((tool_name, hint)) = rest.split_once(": ") {
            (tool_name, Some(hint))
        } else {
            (rest, None)
        };
        return Some(serde_json::json!({
            "type": "progress",
            "progress_kind": "tool_start",
            "tool_name": tool_name,
            "hint": hint,
        }));
    }

    let (success, rest) = if let Some(rest) = trimmed.strip_prefix("✅ ") {
        (true, rest)
    } else if let Some(rest) = trimmed.strip_prefix("❌ ") {
        (false, rest)
    } else {
        return None;
    };
    let (tool_name, secs_text) = rest.rsplit_once(" (")?;
    let secs = secs_text.strip_suffix("s)")?.parse::<u64>().ok()?;
    Some(serde_json::json!({
        "type": "progress",
        "progress_kind": "tool_finished",
        "tool_name": tool_name,
        "seconds": secs,
        "success": success,
    }))
}

fn attachment_allowed_roots(local_paths: &[String]) -> Vec<String> {
    let mut roots = BTreeSet::new();
    for raw_path in local_paths {
        let candidate = raw_path.trim();
        if candidate.is_empty() {
            continue;
        }
        let path = Path::new(candidate);
        if !path.is_absolute() {
            continue;
        }
        let resolved = std::fs::canonicalize(path).unwrap_or_else(|_| path.to_path_buf());
        let root = if resolved.is_dir() {
            resolved
        } else {
            resolved.parent().map(Path::to_path_buf).unwrap_or(resolved)
        };
        roots.insert(root.to_string_lossy().into_owned());
    }
    roots.into_iter().collect()
}

fn extend_runtime_allowed_roots(
    mut config: crate::Config,
    local_paths: &[String],
) -> crate::Config {
    for root in attachment_allowed_roots(local_paths) {
        if !config
            .autonomy
            .allowed_roots
            .iter()
            .any(|value| value == &root)
        {
            config.autonomy.allowed_roots.push(root);
        }
    }
    config
}

fn local_image_refs(content: &str) -> Vec<PathBuf> {
    crate::multimodal::parse_image_markers(content)
        .1
        .into_iter()
        .filter(|value| {
            !value.starts_with("data:")
                && !value.starts_with("http://")
                && !value.starts_with("https://")
        })
        .map(PathBuf::from)
        .collect()
}

fn validate_local_image_refs(
    content: &str,
    workspace_dir: &Path,
    allowed_roots: &[String],
) -> Result<(), String> {
    let mut allowed = Vec::with_capacity(allowed_roots.len() + 1);
    allowed.push(
        workspace_dir
            .canonicalize()
            .unwrap_or_else(|_| workspace_dir.to_path_buf()),
    );
    for root in allowed_roots {
        let path = PathBuf::from(root);
        allowed.push(path.canonicalize().unwrap_or(path));
    }

    for image_ref in local_image_refs(content) {
        let resolved = std::fs::canonicalize(&image_ref).unwrap_or_else(|_| image_ref.clone());
        if !allowed.iter().any(|root| resolved.starts_with(root)) {
            return Err(format!(
                "Local image path is not authorized for this message: {}",
                image_ref.display()
            ));
        }
    }
    Ok(())
}

async fn send_session_policy(
    sender: &mut futures_util::stream::SplitSink<WebSocket, Message>,
    requested: super::SessionExecutionPolicy,
    effective: super::SessionExecutionPolicy,
) -> bool {
    let payload = serde_json::json!({
        "type": "session_policy",
        "autonomy_level": super::autonomy_level_to_wire(requested.autonomy_level),
        "effective_autonomy_level": super::autonomy_level_to_wire(effective.autonomy_level),
    });

    sender
        .send(Message::Text(payload.to_string().into()))
        .await
        .is_ok()
}

/// GET /ws/chat — WebSocket upgrade for agent chat
pub async fn handle_ws_chat(
    State(state): State<AppState>,
    Query(params): Query<WsQuery>,
    ws: WebSocketUpgrade,
) -> impl IntoResponse {
    // Auth via query param (browser WebSocket limitation)
    if state.pairing.require_pairing() {
        let token = params.token.as_deref().unwrap_or("");
        if !state.pairing.is_authenticated(token) {
            return (
                axum::http::StatusCode::UNAUTHORIZED,
                "Unauthorized — provide ?token=<bearer_token>",
            )
                .into_response();
        }
    }

    ws.on_upgrade(move |socket| handle_socket(socket, state, params.token, params.session))
        .into_response()
}

async fn handle_socket(
    socket: WebSocket,
    state: AppState,
    token: Option<String>,
    session: Option<String>,
) {
    let (mut sender, mut receiver) = socket.split();
    let sender_key = super::resolve_chat_session_key(token.as_deref(), session.as_deref());
    let initial_config = state.config.lock().clone();
    let requested_policy = state.session_policy_for(&sender_key, &initial_config);
    let (_, effective_policy) =
        super::apply_session_policy_to_config(&initial_config, requested_policy);
    if !send_session_policy(&mut sender, requested_policy, effective_policy).await {
        return;
    }

    loop {
        let msg = match receiver.next().await {
            Some(Ok(Message::Text(text))) => text,
            Some(Ok(Message::Close(_))) => break,
            Some(Err(_)) => break,
            Some(_) => continue,
            None => break,
        };

        // Parse incoming message
        let parsed: serde_json::Value = match serde_json::from_str(&msg) {
            Ok(v) => v,
            Err(_) => {
                let err = serde_json::json!({"type": "error", "message": "Invalid JSON"});
                let _ = sender.send(Message::Text(err.to_string().into())).await;
                continue;
            }
        };

        let msg_type = parsed["type"].as_str().unwrap_or("");
        if msg_type == "session_policy_update" {
            let runtime_config = state.config.lock().clone();
            let current_policy = state.session_policy_for(&sender_key, &runtime_config);
            let autonomy_level = match parsed["autonomy_level"].as_str() {
                Some(value) => match super::autonomy_level_from_wire(value) {
                    Some(level) => level,
                    None => {
                        let err = serde_json::json!({
                            "type": "error",
                            "message": format!("Invalid autonomy level: {value}"),
                        });
                        let _ = sender.send(Message::Text(err.to_string().into())).await;
                        continue;
                    }
                },
                None => current_policy.autonomy_level,
            };
            let requested_policy = super::SessionExecutionPolicy {
                autonomy_level,
            };
            state.update_session_policy(&sender_key, requested_policy);
            let (_, effective_policy) =
                super::apply_session_policy_to_config(&runtime_config, requested_policy);
            if !send_session_policy(&mut sender, requested_policy, effective_policy).await {
                break;
            }
            continue;
        }
        if msg_type == "stop" {
            let token = state.cancellation_tokens.lock().get(&sender_key).cloned();
            if let Some(token) = token {
                token.cancel();
                let stopped = serde_json::json!({ "type": "stopped" });
                let _ = sender.send(Message::Text(stopped.to_string().into())).await;
            }
            continue;
        }
        if msg_type != "message" {
            continue;
        }

        let content = parsed["content"].as_str().unwrap_or("").to_string();
        if content.is_empty() {
            continue;
        }
        let local_paths = parsed["local_paths"]
            .as_array()
            .map(|items| {
                items
                    .iter()
                    .filter_map(|value| value.as_str().map(ToString::to_string))
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default();

        let runtime_config = state.config.lock().clone();
        let requested_policy = state.session_policy_for(&sender_key, &runtime_config);
        let (runtime_config, effective_policy) =
            super::apply_session_policy_to_config(&runtime_config, requested_policy);
        let (runtime_config, base_workspace_dir) = if super::is_task_session_id(&sender_key) {
            match super::apply_task_session_workspace_to_config(&runtime_config, &sender_key) {
                Ok((config, base_workspace_dir)) => (config, Some(base_workspace_dir)),
                Err(err) => {
                    let error = serde_json::json!({
                        "type": "error",
                        "error": format!("Failed to prepare session workspace: {err}"),
                    });
                    let _ = sender.send(Message::Text(error.to_string().into())).await;
                    continue;
                }
            }
        } else {
            (runtime_config, None)
        };
        let runtime_config = extend_runtime_allowed_roots(runtime_config, &local_paths);
        if let Err(err) = validate_local_image_refs(
            &content,
            &runtime_config.workspace_dir,
            &runtime_config.autonomy.allowed_roots,
        ) {
            let error = serde_json::json!({
                "type": "error",
                "message": err,
            });
            let _ = sender.send(Message::Text(error.to_string().into())).await;
            continue;
        }
        let provider_label = runtime_config
            .default_provider
            .clone()
            .unwrap_or_else(|| "unknown".to_string());
        let runtime_security = Arc::new(crate::security::SecurityPolicy::from_config(
            &runtime_config.autonomy,
            &runtime_config.workspace_dir,
        ));
        let (runtime_tools, runtime_skills) = super::build_tools_and_skills_for_config(
            &runtime_config,
            Arc::clone(&state.runtime_adapter),
            runtime_security,
            Arc::clone(&state.mem),
        );
        let tools_registry_runtime = Arc::new(runtime_tools);
        let (runtime_provider, model, temperature) =
            match super::runtime_inference_from_config(&runtime_config, state.cost_tracker.clone())
            {
                Ok(runtime) => runtime,
                Err(err) => {
                    let error = serde_json::json!({
                        "type": "error",
                        "error": format!("Failed to apply runtime config: {err}"),
                    });
                    let _ = sender.send(Message::Text(error.to_string().into())).await;
                    continue;
                }
            };

        state.emit_event(serde_json::json!({
            "type": "agent_start",
            "provider": provider_label.clone(),
            "model": model.clone(),
            "autonomy_level": super::autonomy_level_to_wire(effective_policy.autonomy_level),
            "browser_enabled": runtime_config.browser.enabled,
            "timestamp": chrono::Utc::now().to_rfc3339(),
        }));

        let (
            system_prompt,
            multimodal_config,
            excluded_tools,
            max_tool_iterations,
            max_history_messages,
            compact_context,
            configured_context_window_tokens,
        ) = {
            let config_guard = runtime_config.clone();

            let excluded_tools =
                if config_guard.autonomy.level == crate::security::AutonomyLevel::Full {
                    std::sync::Arc::new(Vec::new())
                } else {
                    state.non_cli_excluded_tools.clone()
                };

            let mut tool_descs_owned: Vec<(String, String)> = tools_registry_runtime
                .iter()
                .filter(|tool| !excluded_tools.iter().any(|ex| ex == tool.name()))
                .map(|tool| (tool.name().to_string(), tool.description().to_string()))
                .collect();
            tool_descs_owned.sort_by(|a, b| a.0.cmp(&b.0));
            let tool_descs: Vec<(&str, &str)> = tool_descs_owned
                .iter()
                .map(|(name, desc)| (name.as_str(), desc.as_str()))
                .collect();
            let native_tools = runtime_provider.supports_native_tools() && !tool_descs.is_empty();
            let mut prompt = crate::channels::build_system_prompt_with_mode(
                &config_guard.workspace_dir,
                &model,
                &tool_descs,
                &runtime_skills,
                Some(&config_guard.identity),
                None,
                native_tools,
                config_guard.skills.prompt_injection_mode,
            );
            if !native_tools {
                prompt.push_str(&crate::agent::loop_::build_tool_instructions(
                    tools_registry_runtime.as_ref(),
                ));
            }
            if let Some(base_workspace_dir) = base_workspace_dir.as_ref() {
                prompt.push_str("\n\n## Task Session Workspace\n\n");
                prompt.push_str(&format!(
                    "- Current session workspace: `{}`\n- The original project workspace is exposed at `./project/`\n- Absolute base workspace path: `{}`\n- Keep session-specific outputs in the current session workspace. Use `project/` when you need to read or modify the original project tree.\n",
                    config_guard.workspace_dir.display(),
                    base_workspace_dir.display()
                ));
            }
            (
                prompt,
                config_guard.multimodal.clone(),
                excluded_tools,
                config_guard.agent.max_tool_iterations,
                config_guard.agent.max_history_messages,
                config_guard.agent.compact_context,
                config_guard.cached_model_context_window_tokens(&model),
            )
        };

        let mut previous_history = state
            .conversation_histories
            .lock()
            .get(&sender_key)
            .cloned()
            .unwrap_or_default();
        if previous_history.is_empty() && max_history_messages > 0 {
            if let Ok(items) = super::load_conversation_entries(
                state.mem.clone(),
                &sender_key,
                max_history_messages,
                0,
            )
            .await
            {
                if !items.is_empty() {
                    let loaded: Vec<crate::providers::ChatMessage> =
                        items.into_iter().map(|(_, msg)| msg).collect();
                    state
                        .conversation_histories
                        .lock()
                        .insert(sender_key.clone(), loaded.clone());
                    previous_history = loaded;
                }
            }
        }
        let mut previous_history =
            crate::agent::loop_::sanitize_history_for_provider(&previous_history);
        if compact_context {
            let _ = crate::agent::loop_::auto_compact_history(
                &mut previous_history,
                runtime_provider.as_ref(),
                &model,
                max_history_messages,
            )
            .await;
        }
        crate::agent::loop_::trim_history(&mut previous_history, max_history_messages);

        let mut history = Vec::with_capacity(previous_history.len() + 2);
        history.push(crate::providers::ChatMessage::system(system_prompt));
        history.append(&mut previous_history);
        let user_turn = crate::providers::ChatMessage::user(&content);
        history.push(user_turn.clone());
        if let Err(err) =
            super::store_conversation_turn(state.mem.clone(), &sender_key, &user_turn).await
        {
            warn!("Failed to store user chat message: {err:#}");
        }

        let (delta_tx, mut delta_rx) = mpsc::channel(16);
        let (hook_tx, mut hook_rx) = mpsc::unbounded_channel();
        let (approval_tx, mut approval_rx) = mpsc::channel(8);
        let pending_approvals = Arc::new(Mutex::new(HashMap::<
            String,
            oneshot::Sender<ApprovalResponse>,
        >::new()));
        let mut hooks = HookRunner::new();
        hooks.register(Box::new(WsHookHandler { tx: hook_tx }));
        let hooks = Arc::new(hooks);
        let (result_tx, mut result_rx) =
            oneshot::channel::<(anyhow::Result<String>, Vec<crate::providers::ChatMessage>)>();
        let provider = Arc::clone(&runtime_provider);
        let tools_registry = Arc::clone(&tools_registry_runtime);
        let observer = Arc::clone(&state.observer);
        let model_for_loop = model.clone();
        let excluded_tools = excluded_tools.as_ref().clone();
        let provider_label_for_loop = provider_label.clone();
        let hooks_for_loop = Arc::clone(&hooks);
        let approval_manager = ApprovalManager::with_prompter(
            &runtime_config.autonomy,
            Arc::new(GatewayApprovalPrompter {
                tx: approval_tx,
                pending: Arc::clone(&pending_approvals),
            }),
        );
        let cancellation_token = CancellationToken::new();
        let run_token = cancellation_token.clone();
        state
            .cancellation_tokens
            .lock()
            .insert(sender_key.clone(), cancellation_token.clone());
        let mut stop_ack_sent = false;
        let mut receiver_closed = false;
        let mut pending_reasoning = String::new();
        tokio::spawn(async move {
            let result = crate::agent::loop_::run_tool_call_loop(
                provider.as_ref(),
                &mut history,
                tools_registry.as_ref(),
                observer.as_ref(),
                provider_label_for_loop.as_str(),
                &model_for_loop,
                temperature,
                true,
                Some(&approval_manager),
                "gateway",
                &multimodal_config,
                max_tool_iterations,
                configured_context_window_tokens,
                Some(run_token),
                Some(delta_tx),
                Some(hooks_for_loop.as_ref()),
                &excluded_tools,
            )
            .await;
            let _ = result_tx.send((result, history));
        });

        loop {
            tokio::select! {
                delta = delta_rx.recv() => {
                    let Some(delta) = delta else { continue };
                    if delta == crate::agent::loop_::DRAFT_CLEAR_SENTINEL {
                        let clear = serde_json::json!({
                            "type": "draft_clear",
                        });
                        if sender.send(Message::Text(clear.to_string().into())).await.is_err() {
                            break;
                        }
                        continue;
                    }
                    if let Some(content) = delta.strip_prefix(REASONING_DELTA_SENTINEL) {
                        pending_reasoning.push_str(content);
                        let payload = serde_json::json!({
                            "type": "reasoning",
                            "content": content,
                            "append": true,
                        });
                        if sender.send(Message::Text(payload.to_string().into())).await.is_err() {
                            break;
                        }
                        continue;
                    }
                    if let Some(content) = delta.strip_prefix(REASONING_SENTINEL) {
                        pending_reasoning.clear();
                        pending_reasoning.push_str(content);
                        let payload = serde_json::json!({
                            "type": "reasoning",
                            "content": content,
                        });
                        if sender.send(Message::Text(payload.to_string().into())).await.is_err() {
                            break;
                        }
                        continue;
                    }
                    let payload = progress_payload(&delta).unwrap_or_else(|| {
                        serde_json::json!({
                            "type": "chunk",
                            "content": delta,
                        })
                    });
                    if sender.send(Message::Text(payload.to_string().into())).await.is_err() {
                        break;
                    }
                }
                approval = approval_rx.recv() => {
                    let Some(approval) = approval else { continue };
                    let payload = serde_json::json!({
                        "type": "approval_request",
                        "request_id": approval.request_id,
                        "tool_name": approval.tool_name,
                        "arguments": approval.arguments,
                    });
                    if sender.send(Message::Text(payload.to_string().into())).await.is_err() {
                        drain_pending_approvals(&pending_approvals, ApprovalResponse::No);
                        break;
                    }
                }
                result = &mut result_rx => {
                    let (result, history) = match result {
                        Ok(v) => v,
                        Err(_) => break,
                    };
                    state.cancellation_tokens.lock().remove(&sender_key);
                    match result {
                        Ok(response) => {
                            flush_pending_reasoning(&state, &sender_key, &mut pending_reasoning).await;
                            let done = serde_json::json!({
                                "type": "done",
                                "full_response": response,
                            });
                            let _ = sender.send(Message::Text(done.to_string().into())).await;
                            let mut history_to_store = history;
                            if !history_to_store.is_empty() {
                                history_to_store.remove(0);
                            }
                            if compact_context {
                                let _ = crate::agent::loop_::auto_compact_history(
                                    &mut history_to_store,
                                    runtime_provider.as_ref(),
                                    &model,
                                    max_history_messages,
                                )
                                .await;
                            }
                            crate::agent::loop_::trim_history(
                                &mut history_to_store,
                                max_history_messages,
                            );
                            state
                                .conversation_histories
                                .lock()
                                .insert(sender_key.clone(), history_to_store);
                            if !response.trim().is_empty() {
                                let assistant_turn =
                                    crate::providers::ChatMessage::assistant(response);
                                if let Err(err) = super::store_conversation_turn(
                                    state.mem.clone(),
                                    &sender_key,
                                    &assistant_turn,
                                )
                                .await
                                {
                                    warn!("Failed to store assistant chat message: {err:#}");
                                }
                            }
                            state.emit_event(serde_json::json!({
                                "type": "agent_end",
                                "provider": provider_label,
                                "model": model,
                                "timestamp": chrono::Utc::now().to_rfc3339(),
                            }));
                        }
                        Err(e) => {
                            flush_pending_reasoning(&state, &sender_key, &mut pending_reasoning).await;
                            if is_tool_loop_cancelled(&e) {
                                if !stop_ack_sent {
                                    let stopped = serde_json::json!({ "type": "stopped" });
                                    let _ = sender.send(Message::Text(stopped.to_string().into())).await;
                                }
                                break;
                            }
                            let sanitized = crate::providers::sanitize_api_error(&e.to_string());
                            let err = serde_json::json!({
                                "type": "error",
                                "message": sanitized,
                            });
                            let _ = sender.send(Message::Text(err.to_string().into())).await;
                            state.emit_event(serde_json::json!({
                                "type": "error",
                                "component": "ws_chat",
                                "message": sanitized,
                                "timestamp": chrono::Utc::now().to_rfc3339(),
                            }));
                        }
                    }
                    break;
                }
                event = hook_rx.recv() => {
                    let Some(event) = event else { continue };
                    match event {
                        WsHookEvent::Reasoning { content } => {
                            pending_reasoning.clear();
                            pending_reasoning.push_str(&content);
                            let payload = serde_json::json!({
                                "type": "reasoning",
                                "content": content,
                            });
                            if sender.send(Message::Text(payload.to_string().into())).await.is_err() {
                                break;
                            }
                        }
                        WsHookEvent::ToolCall { name, args } => {
                            flush_pending_reasoning(&state, &sender_key, &mut pending_reasoning).await;
                            let history_turn = crate::providers::ChatMessage::tool(
                                serde_json::json!({
                                    "type": "tool_call",
                                    "name": name,
                                    "args": args,
                                })
                                .to_string(),
                            );
                            store_history_event(&state, &sender_key, history_turn).await;
                            let payload = serde_json::json!({
                                "type": "tool_call",
                                "name": name,
                                "args": args,
                            });
                            if sender.send(Message::Text(payload.to_string().into())).await.is_err() {
                                break;
                            }
                        }
                        WsHookEvent::ToolResult { name, output, error } => {
                            let history_turn = crate::providers::ChatMessage::tool(
                                serde_json::json!({
                                    "type": "tool_result",
                                    "name": name,
                                    "output": output,
                                    "error": error,
                                })
                                .to_string(),
                            );
                            store_history_event(&state, &sender_key, history_turn).await;
                            let payload = serde_json::json!({
                                "type": "tool_result",
                                "name": name,
                                "output": output,
                                "error": error,
                            });
                            if sender.send(Message::Text(payload.to_string().into())).await.is_err() {
                                break;
                            }
                        }
                    }
                }
                incoming = receiver.next() => {
                    let Some(incoming) = incoming else {
                        cancellation_token.cancel();
                        receiver_closed = true;
                        break;
                    };
                    match incoming {
                        Ok(Message::Text(text)) => {
                            let parsed: serde_json::Value = match serde_json::from_str(&text) {
                                Ok(v) => v,
                                Err(_) => continue,
                            };
                            match parsed["type"].as_str() {
                                Some("stop") => {
                                    cancellation_token.cancel();
                                    if !stop_ack_sent {
                                        let stopped = serde_json::json!({ "type": "stopped" });
                                        let _ = sender.send(Message::Text(stopped.to_string().into())).await;
                                        stop_ack_sent = true;
                                    }
                                }
                                Some("session_policy_update") => {
                                    let runtime_config = state.config.lock().clone();
                                    let current_policy = state.session_policy_for(&sender_key, &runtime_config);
                                    let autonomy_level = match parsed["autonomy_level"].as_str() {
                                        Some(value) => match super::autonomy_level_from_wire(value) {
                                            Some(level) => level,
                                            None => {
                                                let err = serde_json::json!({
                                                    "type": "error",
                                                    "message": format!("Invalid autonomy level: {value}"),
                                                });
                                                let _ = sender.send(Message::Text(err.to_string().into())).await;
                                                continue;
                                            }
                                        },
                                        None => current_policy.autonomy_level,
                                    };
                                    let requested_policy = super::SessionExecutionPolicy {
                                        autonomy_level,
                                    };
                                    state.update_session_policy(&sender_key, requested_policy);
                                    let (_, effective_policy) =
                                        super::apply_session_policy_to_config(&runtime_config, requested_policy);
                                    if !send_session_policy(&mut sender, requested_policy, effective_policy).await {
                                        break;
                                    }
                                }
                                Some("approval_response") => {
                                    let Some(request_id) = parsed["request_id"].as_str() else {
                                        let err = serde_json::json!({
                                            "type": "error",
                                            "message": "Missing approval request id",
                                        });
                                        let _ = sender.send(Message::Text(err.to_string().into())).await;
                                        continue;
                                    };
                                    let Some(decision) = parsed["decision"]
                                        .as_str()
                                        .and_then(|value| match value {
                                            "yes" => Some(ApprovalResponse::Yes),
                                            "no" => Some(ApprovalResponse::No),
                                            "always" => Some(ApprovalResponse::Always),
                                            _ => None,
                                        }) else {
                                        let err = serde_json::json!({
                                            "type": "error",
                                            "message": "Invalid approval decision",
                                        });
                                        let _ = sender.send(Message::Text(err.to_string().into())).await;
                                        continue;
                                    };
                                    if let Some(tx) = pending_approvals.lock().remove(request_id) {
                                        let _ = tx.send(decision);
                                    }
                                }
                                _ => {}
                            }
                        }
                        Ok(Message::Close(_)) => {
                            drain_pending_approvals(&pending_approvals, ApprovalResponse::No);
                            cancellation_token.cancel();
                            receiver_closed = true;
                            break;
                        }
                        Err(_) => {
                            drain_pending_approvals(&pending_approvals, ApprovalResponse::No);
                            cancellation_token.cancel();
                            receiver_closed = true;
                            break;
                        }
                        _ => {}
                    }
                }
            }
        }
        drain_pending_approvals(&pending_approvals, ApprovalResponse::No);
        if receiver_closed {
            break;
        }
    }
}
