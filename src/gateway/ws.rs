//! WebSocket agent chat handler.
//!
//! Protocol:
//! ```text
//! Client -> Server: {"type":"message","content":"Hello"}
//! Server -> Client: {"type":"chunk","content":"Hi! "}
//! Server -> Client: {"type":"tool_call","name":"shell","args":{...}}
//! Server -> Client: {"type":"tool_result","name":"shell","output":"..."}
//! Server -> Client: {"type":"done","full_response":"..."}
//! ```

use super::AppState;
use crate::agent::loop_::is_tool_loop_cancelled;
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
use serde::Deserialize;
use std::sync::Arc;
use tokio::sync::{mpsc, oneshot};
use tokio_util::sync::CancellationToken;
use tracing::warn;

#[derive(Deserialize)]
pub struct WsQuery {
    pub token: Option<String>,
}

enum WsHookEvent {
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

    ws.on_upgrade(move |socket| handle_socket(socket, state, params.token))
        .into_response()
}

async fn handle_socket(socket: WebSocket, state: AppState, token: Option<String>) {
    let (mut sender, mut receiver) = socket.split();
    let sender_key = super::conversation_sender_key(token.as_deref());

    while let Some(msg) = receiver.next().await {
        let msg = match msg {
            Ok(Message::Text(text)) => text,
            Ok(Message::Close(_)) => break,
            Err(_) => break,
            _ => continue,
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
        if msg_type == "stop" {
            let token = state
                .cancellation_tokens
                .lock()
                .get(&sender_key)
                .cloned();
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

        let provider_label = state
            .config
            .lock()
            .default_provider
            .clone()
            .unwrap_or_else(|| "unknown".to_string());
        let model = state.model.clone();

        state.emit_event(serde_json::json!({
            "type": "agent_start",
            "provider": provider_label.clone(),
            "model": model.clone(),
            "timestamp": chrono::Utc::now().to_rfc3339(),
        }));

        let (
            system_prompt,
            multimodal_config,
            excluded_tools,
            max_tool_iterations,
            max_history_messages,
        ) = {
            let config_guard = state.config.lock();

            let excluded_tools = if config_guard.autonomy.level == crate::security::policy::AutonomyLevel::Full {
                std::sync::Arc::new(Vec::new())
            } else {
                state.non_cli_excluded_tools.clone()
            };

            let mut tool_descs_owned: Vec<(String, String)> = state
                .tools_registry_runtime
                .iter()
                .filter(|tool| {
                    !excluded_tools
                        .iter()
                        .any(|ex| ex == tool.name())
                })
                .map(|tool| (tool.name().to_string(), tool.description().to_string()))
                .collect();
            tool_descs_owned.sort_by(|a, b| a.0.cmp(&b.0));
            let tool_descs: Vec<(&str, &str)> = tool_descs_owned
                .iter()
                .map(|(name, desc)| (name.as_str(), desc.as_str()))
                .collect();
            let native_tools = state.provider.supports_native_tools() && !tool_descs.is_empty();
            let mut prompt = crate::channels::build_system_prompt_with_mode(
                &config_guard.workspace_dir,
                &state.model,
                &tool_descs,
                &state.skills,
                Some(&config_guard.identity),
                None,
                native_tools,
                config_guard.skills.prompt_injection_mode,
            );
            if !native_tools {
                prompt.push_str(&crate::agent::loop_::build_tool_instructions(
                    state.tools_registry_runtime.as_ref(),
                ));
            }
            (
                prompt,
                config_guard.multimodal.clone(),
                excluded_tools,
                config_guard.agent.max_tool_iterations,
                config_guard.agent.max_history_messages,
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
        let mut hooks = HookRunner::new();
        hooks.register(Box::new(WsHookHandler { tx: hook_tx }));
        let hooks = Arc::new(hooks);
        let (result_tx, mut result_rx) =
            oneshot::channel::<(anyhow::Result<String>, Vec<crate::providers::ChatMessage>)>();
        let provider = Arc::clone(&state.provider);
        let tools_registry = Arc::clone(&state.tools_registry_runtime);
        let observer = Arc::clone(&state.observer);
        let model = state.model.clone();
        let model_for_loop = model.clone();
        let temperature = state.temperature;
        let excluded_tools = excluded_tools.as_ref().clone();
        let provider_label_for_loop = provider_label.clone();
        let hooks_for_loop = Arc::clone(&hooks);
        let cancellation_token = CancellationToken::new();
        let run_token = cancellation_token.clone();
        state
            .cancellation_tokens
            .lock()
            .insert(sender_key.clone(), cancellation_token.clone());
        let mut stop_ack_sent = false;
        let mut receiver_closed = false;
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
                None,
                "gateway",
                &multimodal_config,
                max_tool_iterations,
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
                        continue;
                    }
                    let chunk = serde_json::json!({
                        "type": "chunk",
                        "content": delta,
                    });
                    if sender.send(Message::Text(chunk.to_string().into())).await.is_err() {
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
                            let done = serde_json::json!({
                                "type": "done",
                                "full_response": response,
                            });
                            let _ = sender.send(Message::Text(done.to_string().into())).await;
                            let mut history_to_store = history;
                            if !history_to_store.is_empty() {
                                history_to_store.remove(0);
                            }
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
                        WsHookEvent::ToolCall { name, args } => {
                            let payload = serde_json::json!({
                                "type": "tool_call",
                                "name": name,
                                "args": args,
                            });
                            if sender.send(Message::Text(payload.to_string().into())).await.is_err() {
                                break;
                            }
                            let tool_turn = crate::providers::ChatMessage::tool(payload.to_string());
                            if let Err(err) = super::store_conversation_turn(
                                state.mem.clone(),
                                &sender_key,
                                &tool_turn,
                            )
                            .await
                            {
                                warn!("Failed to store tool call: {err:#}");
                            }
                        }
                        WsHookEvent::ToolResult { name, output, error } => {
                            let payload = serde_json::json!({
                                "type": "tool_result",
                                "name": name,
                                "output": output,
                                "error": error,
                            });
                            if sender.send(Message::Text(payload.to_string().into())).await.is_err() {
                                break;
                            }
                            let tool_turn = crate::providers::ChatMessage::tool(payload.to_string());
                            if let Err(err) = super::store_conversation_turn(
                                state.mem.clone(),
                                &sender_key,
                                &tool_turn,
                            )
                            .await
                            {
                                warn!("Failed to store tool result: {err:#}");
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
                            if parsed["type"].as_str() == Some("stop") {
                                cancellation_token.cancel();
                                if !stop_ack_sent {
                                    let stopped = serde_json::json!({ "type": "stopped" });
                                    let _ = sender.send(Message::Text(stopped.to_string().into())).await;
                                    stop_ack_sent = true;
                                }
                            }
                        }
                        Ok(Message::Close(_)) => {
                            cancellation_token.cancel();
                            receiver_closed = true;
                            break;
                        }
                        Err(_) => {
                            cancellation_token.cancel();
                            receiver_closed = true;
                            break;
                        }
                        _ => {}
                    }
                }
            }
        }
        if receiver_closed {
            break;
        }
    }
}
