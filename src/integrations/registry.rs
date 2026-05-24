use super::{IntegrationCategory, IntegrationEntry, IntegrationStatus};
use crate::providers::{
    is_glm_alias, is_minimax_alias, is_moonshot_alias, is_qianfan_alias, is_qwen_alias,
    is_zai_alias,
};
use std::path::Path;

fn composio_ready(config: &crate::config::Config) -> bool {
    config.composio.enabled
        && config
            .composio
            .api_key
            .as_deref()
            .is_some_and(|key| !key.trim().is_empty())
}

fn canvas_active(config: &crate::config::Config) -> bool {
    let state_path = Path::new(&config.workspace_dir).join("canvas/main/.canvas_state.json");
    std::fs::metadata(state_path).is_ok()
}

fn onepassword_native_active() -> bool {
    onepassword_active_from_env(std::env::vars())
}

fn onepassword_active_from_env<I>(vars: I) -> bool
where
    I: IntoIterator<Item = (String, String)>,
{
    let mut has_connect_host = false;
    let mut has_connect_token = false;
    for (key, value) in vars {
        let value = value.trim();
        if value.is_empty() {
            continue;
        }
        if key == "OP_SERVICE_ACCOUNT_TOKEN" {
            return true;
        }
        if key == "OP_CONNECT_HOST" {
            has_connect_host = true;
        } else if key == "OP_CONNECT_TOKEN" {
            has_connect_token = true;
        } else if key.starts_with("OP_SESSION_") {
            return true;
        }
    }
    has_connect_host && has_connect_token
}

/// Returns the full catalog of integrations
#[allow(clippy::too_many_lines)]
pub fn all_integrations() -> Vec<IntegrationEntry> {
    vec![
        // ── Chat Providers ──────────────────────────────────────
        IntegrationEntry {
            name: "Telegram",
            description: "Bot API — long-polling",
            category: IntegrationCategory::Chat,
            status_fn: |c| {
                if c.channels_config.telegram.is_some() {
                    IntegrationStatus::Active
                } else {
                    IntegrationStatus::Available
                }
            },
        },
        IntegrationEntry {
            name: "Discord",
            description: "Servers, channels & DMs",
            category: IntegrationCategory::Chat,
            status_fn: |c| {
                if c.channels_config.discord.is_some() {
                    IntegrationStatus::Active
                } else {
                    IntegrationStatus::Available
                }
            },
        },
        IntegrationEntry {
            name: "Slack",
            description: "Workspace apps via Web API",
            category: IntegrationCategory::Chat,
            status_fn: |c| {
                if c.channels_config.slack.is_some() {
                    IntegrationStatus::Active
                } else {
                    IntegrationStatus::Available
                }
            },
        },
        IntegrationEntry {
            name: "Webhooks",
            description: "HTTP endpoint for triggers",
            category: IntegrationCategory::Chat,
            status_fn: |c| {
                if c.channels_config.webhook.is_some() {
                    IntegrationStatus::Active
                } else {
                    IntegrationStatus::Available
                }
            },
        },
        IntegrationEntry {
            name: "WhatsApp",
            description: "Meta Cloud API via webhook",
            category: IntegrationCategory::Chat,
            status_fn: |c| {
                if c.channels_config.whatsapp.is_some() {
                    IntegrationStatus::Active
                } else {
                    IntegrationStatus::Available
                }
            },
        },
        IntegrationEntry {
            name: "Signal",
            description: "Privacy-focused via signal-cli",
            category: IntegrationCategory::Chat,
            status_fn: |c| {
                if c.channels_config.signal.is_some() {
                    IntegrationStatus::Active
                } else {
                    IntegrationStatus::Available
                }
            },
        },
        IntegrationEntry {
            name: "iMessage",
            description: "macOS AppleScript bridge",
            category: IntegrationCategory::Chat,
            status_fn: |c| {
                if c.channels_config.imessage.is_some() {
                    IntegrationStatus::Active
                } else {
                    IntegrationStatus::Available
                }
            },
        },
        IntegrationEntry {
            name: "Microsoft Teams",
            description: "Enterprise chat support",
            category: IntegrationCategory::Chat,
            status_fn: |_| IntegrationStatus::ComingSoon,
        },
        IntegrationEntry {
            name: "Matrix",
            description: "Matrix protocol (Element)",
            category: IntegrationCategory::Chat,
            status_fn: |c| {
                if c.channels_config.matrix.is_some() {
                    IntegrationStatus::Active
                } else {
                    IntegrationStatus::Available
                }
            },
        },
        IntegrationEntry {
            name: "Nostr",
            description: "Decentralized DMs (NIP-04)",
            category: IntegrationCategory::Chat,
            status_fn: |c| {
                if c.channels_config.nostr.is_some() {
                    IntegrationStatus::Active
                } else {
                    IntegrationStatus::Available
                }
            },
        },
        IntegrationEntry {
            name: "WebChat",
            description: "Browser-based chat UI",
            category: IntegrationCategory::Chat,
            status_fn: |_| IntegrationStatus::ComingSoon,
        },
        IntegrationEntry {
            name: "Nextcloud Talk",
            description: "Self-hosted Nextcloud chat",
            category: IntegrationCategory::Chat,
            status_fn: |c| {
                if c.channels_config.nextcloud_talk.is_some() {
                    IntegrationStatus::Active
                } else {
                    IntegrationStatus::Available
                }
            },
        },
        IntegrationEntry {
            name: "Zalo",
            description: "Zalo Bot API",
            category: IntegrationCategory::Chat,
            status_fn: |_| IntegrationStatus::ComingSoon,
        },
        IntegrationEntry {
            name: "DingTalk",
            description: "DingTalk Stream Mode",
            category: IntegrationCategory::Chat,
            status_fn: |c| {
                if c.channels_config.dingtalk.is_some() {
                    IntegrationStatus::Active
                } else {
                    IntegrationStatus::Available
                }
            },
        },
        IntegrationEntry {
            name: "QQ Official",
            description: "Tencent QQ Bot SDK",
            category: IntegrationCategory::Chat,
            status_fn: |c| {
                if c.channels_config.qq.is_some() {
                    IntegrationStatus::Active
                } else {
                    IntegrationStatus::Available
                }
            },
        },
        // ── AI Models ───────────────────────────────────────────
        IntegrationEntry {
            name: "OpenRouter",
            description: "200+ models, 1 API key",
            category: IntegrationCategory::AiModel,
            status_fn: |c| {
                if c.default_provider.as_deref() == Some("openrouter") && c.api_key.is_some() {
                    IntegrationStatus::Active
                } else {
                    IntegrationStatus::Available
                }
            },
        },
        IntegrationEntry {
            name: "Anthropic",
            description: "Claude 3.5/4 Sonnet & Opus",
            category: IntegrationCategory::AiModel,
            status_fn: |c| {
                if c.default_provider.as_deref() == Some("anthropic") {
                    IntegrationStatus::Active
                } else {
                    IntegrationStatus::Available
                }
            },
        },
        IntegrationEntry {
            name: "OpenAI",
            description: "GPT-4o, GPT-5, o1",
            category: IntegrationCategory::AiModel,
            status_fn: |c| {
                if c.default_provider.as_deref() == Some("openai") {
                    IntegrationStatus::Active
                } else {
                    IntegrationStatus::Available
                }
            },
        },
        IntegrationEntry {
            name: "Google",
            description: "Gemini 2.5 Pro/Flash",
            category: IntegrationCategory::AiModel,
            status_fn: |c| {
                if c.default_model
                    .as_deref()
                    .is_some_and(|m| m.starts_with("google/"))
                {
                    IntegrationStatus::Active
                } else {
                    IntegrationStatus::Available
                }
            },
        },
        IntegrationEntry {
            name: "DeepSeek",
            description: "DeepSeek V3 & R1",
            category: IntegrationCategory::AiModel,
            status_fn: |c| {
                if c.default_model
                    .as_deref()
                    .is_some_and(|m| m.starts_with("deepseek/"))
                {
                    IntegrationStatus::Active
                } else {
                    IntegrationStatus::Available
                }
            },
        },
        IntegrationEntry {
            name: "xAI",
            description: "Grok 3 & 4",
            category: IntegrationCategory::AiModel,
            status_fn: |c| {
                if c.default_model
                    .as_deref()
                    .is_some_and(|m| m.starts_with("x-ai/"))
                {
                    IntegrationStatus::Active
                } else {
                    IntegrationStatus::Available
                }
            },
        },
        IntegrationEntry {
            name: "Mistral",
            description: "Mistral Large & Codestral",
            category: IntegrationCategory::AiModel,
            status_fn: |c| {
                if c.default_model
                    .as_deref()
                    .is_some_and(|m| m.starts_with("mistral"))
                {
                    IntegrationStatus::Active
                } else {
                    IntegrationStatus::Available
                }
            },
        },
        IntegrationEntry {
            name: "Ollama",
            description: "Local models (Llama, etc.)",
            category: IntegrationCategory::AiModel,
            status_fn: |c| {
                if c.default_provider.as_deref() == Some("ollama") {
                    IntegrationStatus::Active
                } else {
                    IntegrationStatus::Available
                }
            },
        },
        IntegrationEntry {
            name: "Perplexity",
            description: "Search-augmented AI",
            category: IntegrationCategory::AiModel,
            status_fn: |c| {
                if c.default_provider.as_deref() == Some("perplexity") {
                    IntegrationStatus::Active
                } else {
                    IntegrationStatus::Available
                }
            },
        },
        IntegrationEntry {
            name: "Hugging Face",
            description: "Open-source models",
            category: IntegrationCategory::AiModel,
            status_fn: |_| IntegrationStatus::ComingSoon,
        },
        IntegrationEntry {
            name: "LM Studio",
            description: "Local model server",
            category: IntegrationCategory::AiModel,
            status_fn: |_| IntegrationStatus::ComingSoon,
        },
        IntegrationEntry {
            name: "Venice",
            description: "Privacy-first inference (Llama, Opus)",
            category: IntegrationCategory::AiModel,
            status_fn: |c| {
                if c.default_provider.as_deref() == Some("venice") {
                    IntegrationStatus::Active
                } else {
                    IntegrationStatus::Available
                }
            },
        },
        IntegrationEntry {
            name: "Vercel AI",
            description: "Vercel AI Gateway",
            category: IntegrationCategory::AiModel,
            status_fn: |c| {
                if c.default_provider.as_deref() == Some("vercel") {
                    IntegrationStatus::Active
                } else {
                    IntegrationStatus::Available
                }
            },
        },
        IntegrationEntry {
            name: "Cloudflare AI",
            description: "Cloudflare AI Gateway",
            category: IntegrationCategory::AiModel,
            status_fn: |c| {
                if c.default_provider.as_deref() == Some("cloudflare") {
                    IntegrationStatus::Active
                } else {
                    IntegrationStatus::Available
                }
            },
        },
        IntegrationEntry {
            name: "Moonshot",
            description: "Kimi & Kimi Coding",
            category: IntegrationCategory::AiModel,
            status_fn: |c| {
                if c.default_provider.as_deref().is_some_and(is_moonshot_alias) {
                    IntegrationStatus::Active
                } else {
                    IntegrationStatus::Available
                }
            },
        },
        IntegrationEntry {
            name: "Synthetic",
            description: "Synthetic AI models",
            category: IntegrationCategory::AiModel,
            status_fn: |c| {
                if c.default_provider.as_deref() == Some("synthetic") {
                    IntegrationStatus::Active
                } else {
                    IntegrationStatus::Available
                }
            },
        },
        IntegrationEntry {
            name: "OpenCode Zen",
            description: "Code-focused AI models",
            category: IntegrationCategory::AiModel,
            status_fn: |c| {
                if c.default_provider.as_deref() == Some("opencode") {
                    IntegrationStatus::Active
                } else {
                    IntegrationStatus::Available
                }
            },
        },
        IntegrationEntry {
            name: "Z.AI",
            description: "Z.AI inference",
            category: IntegrationCategory::AiModel,
            status_fn: |c| {
                if c.default_provider.as_deref().is_some_and(is_zai_alias) {
                    IntegrationStatus::Active
                } else {
                    IntegrationStatus::Available
                }
            },
        },
        IntegrationEntry {
            name: "GLM",
            description: "ChatGLM / Zhipu models",
            category: IntegrationCategory::AiModel,
            status_fn: |c| {
                if c.default_provider.as_deref().is_some_and(is_glm_alias) {
                    IntegrationStatus::Active
                } else {
                    IntegrationStatus::Available
                }
            },
        },
        IntegrationEntry {
            name: "MiniMax",
            description: "MiniMax AI models",
            category: IntegrationCategory::AiModel,
            status_fn: |c| {
                if c.default_provider.as_deref().is_some_and(is_minimax_alias) {
                    IntegrationStatus::Active
                } else {
                    IntegrationStatus::Available
                }
            },
        },
        IntegrationEntry {
            name: "Qwen",
            description: "Alibaba DashScope Qwen models",
            category: IntegrationCategory::AiModel,
            status_fn: |c| {
                if c.default_provider.as_deref().is_some_and(is_qwen_alias) {
                    IntegrationStatus::Active
                } else {
                    IntegrationStatus::Available
                }
            },
        },
        IntegrationEntry {
            name: "Amazon Bedrock",
            description: "AWS managed model access",
            category: IntegrationCategory::AiModel,
            status_fn: |c| {
                if c.default_provider.as_deref() == Some("bedrock") {
                    IntegrationStatus::Active
                } else {
                    IntegrationStatus::Available
                }
            },
        },
        IntegrationEntry {
            name: "Qianfan",
            description: "Baidu AI models",
            category: IntegrationCategory::AiModel,
            status_fn: |c| {
                if c.default_provider.as_deref().is_some_and(is_qianfan_alias) {
                    IntegrationStatus::Active
                } else {
                    IntegrationStatus::Available
                }
            },
        },
        IntegrationEntry {
            name: "Groq",
            description: "Ultra-fast LPU inference",
            category: IntegrationCategory::AiModel,
            status_fn: |c| {
                if c.default_provider.as_deref() == Some("groq") {
                    IntegrationStatus::Active
                } else {
                    IntegrationStatus::Available
                }
            },
        },
        IntegrationEntry {
            name: "Together AI",
            description: "Open-source model hosting",
            category: IntegrationCategory::AiModel,
            status_fn: |c| {
                if c.default_provider.as_deref() == Some("together") {
                    IntegrationStatus::Active
                } else {
                    IntegrationStatus::Available
                }
            },
        },
        IntegrationEntry {
            name: "Fireworks AI",
            description: "Fast open-source inference",
            category: IntegrationCategory::AiModel,
            status_fn: |c| {
                if c.default_provider.as_deref() == Some("fireworks") {
                    IntegrationStatus::Active
                } else {
                    IntegrationStatus::Available
                }
            },
        },
        IntegrationEntry {
            name: "Novita AI",
            description: "Affordable open-source inference",
            category: IntegrationCategory::AiModel,
            status_fn: |c| {
                if c.default_provider.as_deref() == Some("novita") {
                    IntegrationStatus::Active
                } else {
                    IntegrationStatus::Available
                }
            },
        },
        IntegrationEntry {
            name: "Cohere",
            description: "Command R+ & embeddings",
            category: IntegrationCategory::AiModel,
            status_fn: |c| {
                if c.default_provider.as_deref() == Some("cohere") {
                    IntegrationStatus::Active
                } else {
                    IntegrationStatus::Available
                }
            },
        },
        // ── Productivity ────────────────────────────────────────
        IntegrationEntry {
            name: "GitHub",
            description: "Code, issues, PRs",
            category: IntegrationCategory::Productivity,
            status_fn: |c| {
                if composio_ready(c) {
                    IntegrationStatus::Available
                } else {
                    IntegrationStatus::ComingSoon
                }
            },
        },
        IntegrationEntry {
            name: "Notion",
            description: "Workspace & databases",
            category: IntegrationCategory::Productivity,
            status_fn: |c| {
                if composio_ready(c) {
                    IntegrationStatus::Available
                } else {
                    IntegrationStatus::ComingSoon
                }
            },
        },
        IntegrationEntry {
            name: "Apple Notes",
            description: "Native macOS/iOS notes",
            category: IntegrationCategory::Productivity,
            status_fn: |_| IntegrationStatus::ComingSoon,
        },
        IntegrationEntry {
            name: "Apple Reminders",
            description: "Task management",
            category: IntegrationCategory::Productivity,
            status_fn: |_| IntegrationStatus::ComingSoon,
        },
        IntegrationEntry {
            name: "Obsidian",
            description: "Knowledge graph notes",
            category: IntegrationCategory::Productivity,
            status_fn: |_| IntegrationStatus::ComingSoon,
        },
        IntegrationEntry {
            name: "Things 3",
            description: "GTD task manager",
            category: IntegrationCategory::Productivity,
            status_fn: |_| IntegrationStatus::ComingSoon,
        },
        IntegrationEntry {
            name: "Bear Notes",
            description: "Markdown notes",
            category: IntegrationCategory::Productivity,
            status_fn: |_| IntegrationStatus::ComingSoon,
        },
        IntegrationEntry {
            name: "Trello",
            description: "Kanban boards",
            category: IntegrationCategory::Productivity,
            status_fn: |_| IntegrationStatus::ComingSoon,
        },
        IntegrationEntry {
            name: "Linear",
            description: "Issue tracking",
            category: IntegrationCategory::Productivity,
            status_fn: |_| IntegrationStatus::ComingSoon,
        },
        // ── Music & Audio ───────────────────────────────────────
        IntegrationEntry {
            name: "Spotify",
            description: "Music playback control",
            category: IntegrationCategory::MusicAudio,
            status_fn: |_| IntegrationStatus::ComingSoon,
        },
        IntegrationEntry {
            name: "Sonos",
            description: "Multi-room audio",
            category: IntegrationCategory::MusicAudio,
            status_fn: |_| IntegrationStatus::ComingSoon,
        },
        IntegrationEntry {
            name: "Shazam",
            description: "Song recognition",
            category: IntegrationCategory::MusicAudio,
            status_fn: |_| IntegrationStatus::ComingSoon,
        },
        // ── Smart Home ──────────────────────────────────────────
        IntegrationEntry {
            name: "Home Assistant",
            description: "Home automation hub",
            category: IntegrationCategory::SmartHome,
            status_fn: |_| IntegrationStatus::ComingSoon,
        },
        IntegrationEntry {
            name: "Philips Hue",
            description: "Smart lighting",
            category: IntegrationCategory::SmartHome,
            status_fn: |_| IntegrationStatus::ComingSoon,
        },
        IntegrationEntry {
            name: "8Sleep",
            description: "Smart mattress",
            category: IntegrationCategory::SmartHome,
            status_fn: |_| IntegrationStatus::ComingSoon,
        },
        // ── Tools & Automation ──────────────────────────────────
        IntegrationEntry {
            name: "Browser",
            description: "Chrome/Chromium control",
            category: IntegrationCategory::ToolsAutomation,
            status_fn: |_| IntegrationStatus::Available,
        },
        IntegrationEntry {
            name: "Shell",
            description: "Terminal command execution",
            category: IntegrationCategory::ToolsAutomation,
            status_fn: |_| IntegrationStatus::Active,
        },
        IntegrationEntry {
            name: "File System",
            description: "Read/write files",
            category: IntegrationCategory::ToolsAutomation,
            status_fn: |_| IntegrationStatus::Active,
        },
        IntegrationEntry {
            name: "Cron",
            description: "Scheduled tasks",
            category: IntegrationCategory::ToolsAutomation,
            status_fn: |_| IntegrationStatus::Available,
        },
        IntegrationEntry {
            name: "Voice",
            description: "Voice wake + talk mode",
            category: IntegrationCategory::ToolsAutomation,
            status_fn: |_| IntegrationStatus::ComingSoon,
        },
        IntegrationEntry {
            name: "Gmail",
            description: "Email triggers & send",
            category: IntegrationCategory::ToolsAutomation,
            status_fn: |c| {
                if composio_ready(c) {
                    IntegrationStatus::Available
                } else {
                    IntegrationStatus::ComingSoon
                }
            },
        },
        IntegrationEntry {
            name: "1Password",
            description: "Secure credentials",
            category: IntegrationCategory::ToolsAutomation,
            status_fn: |_| {
                if onepassword_native_active() {
                    IntegrationStatus::Active
                } else {
                    IntegrationStatus::Available
                }
            },
        },
        IntegrationEntry {
            name: "Weather",
            description: "Forecasts & conditions",
            category: IntegrationCategory::ToolsAutomation,
            status_fn: |_| IntegrationStatus::ComingSoon,
        },
        IntegrationEntry {
            name: "Canvas",
            description: "Visual workspace + A2UI",
            category: IntegrationCategory::ToolsAutomation,
            status_fn: |c| {
                if canvas_active(c) {
                    IntegrationStatus::Active
                } else {
                    IntegrationStatus::Available
                }
            },
        },
        // ── Media & Creative ────────────────────────────────────
        IntegrationEntry {
            name: "Image Gen",
            description: "AI image generation",
            category: IntegrationCategory::MediaCreative,
            status_fn: |_| IntegrationStatus::ComingSoon,
        },
        IntegrationEntry {
            name: "GIF Search",
            description: "Find the perfect GIF",
            category: IntegrationCategory::MediaCreative,
            status_fn: |_| IntegrationStatus::ComingSoon,
        },
        IntegrationEntry {
            name: "Screen Capture",
            description: "Screenshot & screen control",
            category: IntegrationCategory::MediaCreative,
            status_fn: |_| IntegrationStatus::Available,
        },
        IntegrationEntry {
            name: "Camera",
            description: "Photo/video capture",
            category: IntegrationCategory::MediaCreative,
            status_fn: |_| IntegrationStatus::ComingSoon,
        },
        // ── Social ──────────────────────────────────────────────
        IntegrationEntry {
            name: "Twitter/X",
            description: "Tweet, reply, search",
            category: IntegrationCategory::Social,
            status_fn: |_| IntegrationStatus::ComingSoon,
        },
        IntegrationEntry {
            name: "Email",
            description: "IMAP/SMTP email channel",
            category: IntegrationCategory::Social,
            status_fn: |c| {
                if c.channels_config.email.is_some() {
                    IntegrationStatus::Active
                } else {
                    IntegrationStatus::Available
                }
            },
        },
        // ── Platforms ───────────────────────────────────────────
        IntegrationEntry {
            name: "macOS",
            description: "Native support + AppleScript",
            category: IntegrationCategory::Platform,
            status_fn: |_| {
                if cfg!(target_os = "macos") {
                    IntegrationStatus::Active
                } else {
                    IntegrationStatus::Available
                }
            },
        },
        IntegrationEntry {
            name: "Linux",
            description: "Native support",
            category: IntegrationCategory::Platform,
            status_fn: |_| {
                if cfg!(target_os = "linux") {
                    IntegrationStatus::Active
                } else {
                    IntegrationStatus::Available
                }
            },
        },
        IntegrationEntry {
            name: "Windows",
            description: "WSL2 recommended",
            category: IntegrationCategory::Platform,
            status_fn: |_| IntegrationStatus::Available,
        },
        IntegrationEntry {
            name: "iOS",
            description: "Chat via Telegram/Discord",
            category: IntegrationCategory::Platform,
            status_fn: |_| IntegrationStatus::Available,
        },
        IntegrationEntry {
            name: "Android",
            description: "Chat via Telegram/Discord",
            category: IntegrationCategory::Platform,
            status_fn: |_| IntegrationStatus::Available,
        },
    ]
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::schema::{
        ComposioConfig, IMessageConfig, MatrixConfig, NextcloudTalkConfig, NostrConfig, StreamMode,
        TelegramConfig,
    };
    use crate::config::Config;
    use tempfile::TempDir;

    #[test]
    fn registry_has_entries() {
        let entries = all_integrations();
        assert!(
            entries.len() >= 50,
            "Expected 50+ integrations, got {}",
            entries.len()
        );
    }

    #[test]
    fn all_categories_represented() {
        let entries = all_integrations();
        for cat in IntegrationCategory::all() {
            let count = entries.iter().filter(|e| e.category == *cat).count();
            assert!(count > 0, "Category {cat:?} has no entries");
        }
    }

    #[test]
    fn status_functions_dont_panic() {
        let config = Config::default();
        let entries = all_integrations();
        for entry in &entries {
            let _ = (entry.status_fn)(&config);
        }
    }

    #[test]
    fn no_duplicate_names() {
        let entries = all_integrations();
        let mut seen = std::collections::HashSet::new();
        for entry in &entries {
            assert!(
                seen.insert(entry.name),
                "Duplicate integration name: {}",
                entry.name
            );
        }
    }

    #[test]
    fn no_empty_names_or_descriptions() {
        let entries = all_integrations();
        for entry in &entries {
            assert!(!entry.name.is_empty(), "Found integration with empty name");
            assert!(
                !entry.description.is_empty(),
                "Integration '{}' has empty description",
                entry.name
            );
        }
    }

    #[test]
    fn telegram_active_when_configured() {
        let mut config = Config::default();
        config.channels_config.telegram = Some(TelegramConfig {
            bot_token: "123:ABC".into(),
            allowed_users: vec!["user".into()],
            stream_mode: StreamMode::default(),
            draft_update_interval_ms: 1000,
            interrupt_on_new_message: false,
            mention_only: false,
        });
        let entries = all_integrations();
        let tg = entries.iter().find(|e| e.name == "Telegram").unwrap();
        assert!(matches!((tg.status_fn)(&config), IntegrationStatus::Active));
    }

    #[test]
    fn telegram_available_when_not_configured() {
        let config = Config::default();
        let entries = all_integrations();
        let tg = entries.iter().find(|e| e.name == "Telegram").unwrap();
        assert!(matches!(
            (tg.status_fn)(&config),
            IntegrationStatus::Available
        ));
    }

    #[test]
    fn imessage_active_when_configured() {
        let mut config = Config::default();
        config.channels_config.imessage = Some(IMessageConfig {
            allowed_contacts: vec!["*".into()],
        });
        let entries = all_integrations();
        let im = entries.iter().find(|e| e.name == "iMessage").unwrap();
        assert!(matches!((im.status_fn)(&config), IntegrationStatus::Active));
    }

    #[test]
    fn imessage_available_when_not_configured() {
        let config = Config::default();
        let entries = all_integrations();
        let im = entries.iter().find(|e| e.name == "iMessage").unwrap();
        assert!(matches!(
            (im.status_fn)(&config),
            IntegrationStatus::Available
        ));
    }

    #[test]
    fn matrix_active_when_configured() {
        let mut config = Config::default();
        config.channels_config.matrix = Some(MatrixConfig {
            homeserver: "https://m.org".into(),
            access_token: "tok".into(),
            user_id: None,
            device_id: None,
            room_id: "!r:m".into(),
            allowed_users: vec![],
        });
        let entries = all_integrations();
        let mx = entries.iter().find(|e| e.name == "Matrix").unwrap();
        assert!(matches!((mx.status_fn)(&config), IntegrationStatus::Active));
    }

    #[test]
    fn matrix_available_when_not_configured() {
        let config = Config::default();
        let entries = all_integrations();
        let mx = entries.iter().find(|e| e.name == "Matrix").unwrap();
        assert!(matches!(
            (mx.status_fn)(&config),
            IntegrationStatus::Available
        ));
    }

    #[test]
    fn nostr_available_when_not_configured() {
        let config = Config::default();
        let entries = all_integrations();
        let nostr = entries.iter().find(|e| e.name == "Nostr").unwrap();
        assert!(matches!(
            (nostr.status_fn)(&config),
            IntegrationStatus::Available
        ));
    }

    #[test]
    fn nostr_active_when_configured() {
        let mut config = Config::default();
        config.channels_config.nostr = Some(NostrConfig {
            private_key: "nsec1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq"
                .to_string(),
            relays: vec!["wss://relay.damus.io".to_string()],
            allowed_pubkeys: vec![],
        });
        let entries = all_integrations();
        let nostr = entries.iter().find(|e| e.name == "Nostr").unwrap();
        assert!(matches!(
            (nostr.status_fn)(&config),
            IntegrationStatus::Active
        ));
    }

    #[test]
    fn nextcloud_talk_available_when_not_configured() {
        let config = Config::default();
        let entries = all_integrations();
        let nc = entries.iter().find(|e| e.name == "Nextcloud Talk").unwrap();
        assert!(matches!(
            (nc.status_fn)(&config),
            IntegrationStatus::Available
        ));
    }

    #[test]
    fn nextcloud_talk_active_when_configured() {
        let mut config = Config::default();
        config.channels_config.nextcloud_talk = Some(NextcloudTalkConfig {
            base_url: "https://cloud.example.com".to_string(),
            app_token: "token".to_string(),
            webhook_secret: None,
            allowed_users: vec!["*".to_string()],
        });
        let entries = all_integrations();
        let nc = entries.iter().find(|e| e.name == "Nextcloud Talk").unwrap();
        assert!(matches!((nc.status_fn)(&config), IntegrationStatus::Active));
    }

    #[test]
    fn composio_backed_integrations_available_when_composio_ready() {
        let mut config = Config::default();
        config.composio = ComposioConfig {
            enabled: true,
            api_key: Some("cmp_live_test".to_string()),
            entity_id: "default".to_string(),
        };
        let entries = all_integrations();
        for name in ["GitHub", "Notion", "Gmail"] {
            let entry = entries.iter().find(|e| e.name == name).unwrap();
            assert!(
                matches!((entry.status_fn)(&config), IntegrationStatus::Available),
                "{name} should be Available when Composio is configured"
            );
        }
    }

    #[test]
    fn onepassword_available_by_default() {
        let config = Config::default();
        let entries = all_integrations();
        let onepassword = entries.iter().find(|e| e.name == "1Password").unwrap();
        assert!(matches!(
            (onepassword.status_fn)(&config),
            IntegrationStatus::Available
        ));
    }

    #[test]
    fn onepassword_env_service_token_is_active() {
        let vars = vec![("OP_SERVICE_ACCOUNT_TOKEN".to_string(), "token".to_string())];
        assert!(onepassword_active_from_env(vars));
    }

    #[test]
    fn onepassword_env_connect_pair_is_active() {
        let vars = vec![
            (
                "OP_CONNECT_HOST".to_string(),
                "http://127.0.0.1:8080".to_string(),
            ),
            ("OP_CONNECT_TOKEN".to_string(), "token".to_string()),
        ];
        assert!(onepassword_active_from_env(vars));
    }

    #[test]
    fn onepassword_env_session_var_is_active() {
        let vars = vec![("OP_SESSION_my".to_string(), "token".to_string())];
        assert!(onepassword_active_from_env(vars));
    }

    #[test]
    fn screen_capture_is_available() {
        let config = Config::default();
        let entries = all_integrations();
        let screen_capture = entries.iter().find(|e| e.name == "Screen Capture").unwrap();
        assert!(matches!(
            (screen_capture.status_fn)(&config),
            IntegrationStatus::Available
        ));
    }

    #[test]
    fn canvas_is_available() {
        let config = Config::default();
        let entries = all_integrations();
        let canvas = entries.iter().find(|e| e.name == "Canvas").unwrap();
        assert!(matches!(
            (canvas.status_fn)(&config),
            IntegrationStatus::Available
        ));
    }

    #[test]
    fn canvas_is_active_when_session_state_exists() {
        let temp_dir = TempDir::new().unwrap();
        let mut config = Config::default();
        config.workspace_dir = temp_dir.path().to_path_buf();

        let state_path = temp_dir.path().join("canvas/main/.canvas_state.json");
        std::fs::create_dir_all(state_path.parent().unwrap()).unwrap();
        std::fs::write(
            &state_path,
            r#"{"current_target":"file:///tmp/canvas/main/index.html"}"#,
        )
        .unwrap();

        let entries = all_integrations();
        let canvas = entries.iter().find(|e| e.name == "Canvas").unwrap();
        assert!(matches!(
            (canvas.status_fn)(&config),
            IntegrationStatus::Active
        ));
    }

    #[test]
    fn coming_soon_integrations_stay_coming_soon() {
        let config = Config::default();
        let entries = all_integrations();
        for name in ["Weather", "Spotify", "Home Assistant"] {
            let entry = entries.iter().find(|e| e.name == name).unwrap();
            assert!(
                matches!((entry.status_fn)(&config), IntegrationStatus::ComingSoon),
                "{name} should be ComingSoon"
            );
        }
    }

    #[test]
    fn whatsapp_available_when_not_configured() {
        let config = Config::default();
        let entries = all_integrations();
        let wa = entries.iter().find(|e| e.name == "WhatsApp").unwrap();
        assert!(matches!(
            (wa.status_fn)(&config),
            IntegrationStatus::Available
        ));
    }

    #[test]
    fn email_available_when_not_configured() {
        let config = Config::default();
        let entries = all_integrations();
        let email = entries.iter().find(|e| e.name == "Email").unwrap();
        assert!(matches!(
            (email.status_fn)(&config),
            IntegrationStatus::Available
        ));
    }

    #[test]
    fn shell_and_filesystem_always_active() {
        let config = Config::default();
        let entries = all_integrations();
        for name in ["Shell", "File System"] {
            let entry = entries.iter().find(|e| e.name == name).unwrap();
            assert!(
                matches!((entry.status_fn)(&config), IntegrationStatus::Active),
                "{name} should always be Active"
            );
        }
    }

    #[test]
    fn macos_active_on_macos() {
        let config = Config::default();
        let entries = all_integrations();
        let macos = entries.iter().find(|e| e.name == "macOS").unwrap();
        let status = (macos.status_fn)(&config);
        if cfg!(target_os = "macos") {
            assert!(matches!(status, IntegrationStatus::Active));
        } else {
            assert!(matches!(status, IntegrationStatus::Available));
        }
    }

    #[test]
    fn category_counts_reasonable() {
        let entries = all_integrations();
        let chat_count = entries
            .iter()
            .filter(|e| e.category == IntegrationCategory::Chat)
            .count();
        let ai_count = entries
            .iter()
            .filter(|e| e.category == IntegrationCategory::AiModel)
            .count();
        assert!(
            chat_count >= 5,
            "Expected 5+ chat integrations, got {chat_count}"
        );
        assert!(
            ai_count >= 5,
            "Expected 5+ AI model integrations, got {ai_count}"
        );
    }

    #[test]
    fn regional_provider_aliases_activate_expected_ai_integrations() {
        let entries = all_integrations();
        let mut config = Config {
            default_provider: Some("minimax-cn".to_string()),
            ..Config::default()
        };

        let minimax = entries.iter().find(|e| e.name == "MiniMax").unwrap();
        assert!(matches!(
            (minimax.status_fn)(&config),
            IntegrationStatus::Active
        ));

        config.default_provider = Some("glm-cn".to_string());
        let glm = entries.iter().find(|e| e.name == "GLM").unwrap();
        assert!(matches!(
            (glm.status_fn)(&config),
            IntegrationStatus::Active
        ));

        config.default_provider = Some("moonshot-intl".to_string());
        let moonshot = entries.iter().find(|e| e.name == "Moonshot").unwrap();
        assert!(matches!(
            (moonshot.status_fn)(&config),
            IntegrationStatus::Active
        ));

        config.default_provider = Some("qwen-intl".to_string());
        let qwen = entries.iter().find(|e| e.name == "Qwen").unwrap();
        assert!(matches!(
            (qwen.status_fn)(&config),
            IntegrationStatus::Active
        ));

        config.default_provider = Some("zai-cn".to_string());
        let zai = entries.iter().find(|e| e.name == "Z.AI").unwrap();
        assert!(matches!(
            (zai.status_fn)(&config),
            IntegrationStatus::Active
        ));

        config.default_provider = Some("baidu".to_string());
        let qianfan = entries.iter().find(|e| e.name == "Qianfan").unwrap();
        assert!(matches!(
            (qianfan.status_fn)(&config),
            IntegrationStatus::Active
        ));
    }
}
