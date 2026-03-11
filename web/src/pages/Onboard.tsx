import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Bot, Sparkles, CheckCircle, AlertTriangle, ChevronRight, ChevronDown, Server, Globe, Zap, Box, Code, Cpu } from 'lucide-react';
import { onboardInit } from '@/lib/api';

type ProviderDef = {
  id: string;
  label?: string; // Optional, use translation key
  requiresApiKey: boolean;
  requiresUrl?: boolean;
  defaultUrl?: string;
  urlLabel?: string;
  modelPlaceholder?: string;
  description?: string; // Optional, use translation key
};

type TierDef = {
  id: string;
  label?: string; // Optional, use translation key
  icon: React.ElementType;
  description?: string; // Optional, use translation key
  providers: ProviderDef[];
};

const TIERS: TierDef[] = [
  {
    id: 'recommended',
    icon: Sparkles,
    providers: [
      { id: 'openrouter', requiresApiKey: true, label: 'OpenRouter (Recommended)' },
      { id: 'venice', requiresApiKey: true, label: 'Venice AI' },
      { id: 'anthropic', requiresApiKey: true, label: 'Anthropic' },
      { id: 'openai', requiresApiKey: true, label: 'OpenAI' },
      { id: 'openai-codex', requiresApiKey: false, label: 'OpenAI Codex' },
      { id: 'deepseek', requiresApiKey: true, label: 'DeepSeek' },
      { id: 'mistral', requiresApiKey: true, label: 'Mistral' },
      { id: 'xai', requiresApiKey: true, label: 'xAI' },
      { id: 'perplexity', requiresApiKey: true, label: 'Perplexity' },
      { id: 'gemini', requiresApiKey: true, label: 'Google Gemini' },
    ]
  },
  {
    id: 'fast',
    icon: Zap,
    providers: [
      { id: 'groq', requiresApiKey: true, label: 'Groq' },
      { id: 'fireworks', requiresApiKey: true, label: 'Fireworks AI' },
      { id: 'novita', requiresApiKey: true, label: 'Novita AI' },
      { id: 'together-ai', requiresApiKey: true, label: 'Together AI' },
      { id: 'nvidia', requiresApiKey: true, label: 'NVIDIA NIM' },
    ]
  },
  {
    id: 'gateway',
    icon: Globe,
    providers: [
      { id: 'vercel', requiresApiKey: true, label: 'Vercel AI Gateway' },
      { id: 'cloudflare', requiresApiKey: true, label: 'Cloudflare AI Gateway' },
      { id: 'astrai', requiresApiKey: true, label: 'Astrai' },
      { id: 'bedrock', requiresApiKey: true, label: 'Amazon Bedrock' },
    ]
  },
  {
    id: 'specialized',
    icon: Code,
    providers: [
      { id: 'kimi-code', requiresApiKey: true, label: 'Kimi Code' },
      { id: 'qwen-code', requiresApiKey: false, label: 'Qwen Code' },
      { id: 'moonshot', requiresApiKey: true, label: 'Moonshot' },
      { id: 'moonshot-intl', requiresApiKey: true, label: 'Moonshot Intl' },
      { id: 'glm', requiresApiKey: true, label: 'GLM / Zhipu' },
      { id: 'glm-cn', requiresApiKey: true, label: 'GLM / Zhipu (CN)' },
      { id: 'minimax', requiresApiKey: true, label: 'MiniMax' },
      { id: 'minimax-cn', requiresApiKey: true, label: 'MiniMax (CN)' },
      { id: 'qwen', requiresApiKey: true, label: 'Qwen' },
      { id: 'qwen-intl', requiresApiKey: true, label: 'Qwen Intl' },
      { id: 'qianfan', requiresApiKey: true, label: 'Qianfan' },
      { id: 'zai', requiresApiKey: true, label: 'Z.AI' },
      { id: 'zai-cn', requiresApiKey: true, label: 'Z.AI (CN)' },
      { id: 'synthetic', requiresApiKey: true, label: 'Synthetic' },
      { id: 'opencode', requiresApiKey: true, label: 'OpenCode Zen' },
      { id: 'cohere', requiresApiKey: true, label: 'Cohere' },
    ]
  },
  {
    id: 'local',
    icon: Server,
    providers: [
      {
        id: 'ollama',
        label: 'Ollama',
        requiresApiKey: false,
        requiresUrl: true,
        defaultUrl: 'http://localhost:11434',
        urlLabel: 'Ollama Endpoint',
      },
      {
        id: 'llamacpp',
        label: 'llama.cpp Server',
        requiresApiKey: false,
        requiresUrl: true,
        defaultUrl: 'http://localhost:8080/v1',
        urlLabel: 'Server Endpoint',
      },
      {
        id: 'vllm',
        label: 'vLLM',
        requiresApiKey: false,
        requiresUrl: true,
        defaultUrl: 'http://localhost:8000/v1',
        urlLabel: 'vLLM Endpoint',
      },
      {
        id: 'sglang',
        label: 'SGLang',
        requiresApiKey: false,
        requiresUrl: true,
        defaultUrl: 'http://localhost:30000/v1',
        urlLabel: 'SGLang Endpoint',
      },
    ]
  },
  {
    id: 'custom',
    icon: Box,
    providers: [
      {
        id: 'custom',
        label: 'Custom Provider',
        requiresApiKey: false, // Optional for custom
        requiresUrl: true,
        defaultUrl: '',
        urlLabel: 'API Base URL',
      }
    ]
  }
];

type ChannelDef = {
  id: string;
  label: string;
  description: string;
  template: Record<string, unknown>;
};

const CHANNEL_DEFS: ChannelDef[] = [
  { id: 'telegram', label: 'Telegram', description: 'Telegram bot', template: { bot_token: '', allowed_users: [], stream_mode: 'partial', draft_update_interval_ms: 1000, interrupt_on_new_message: true, mention_only: false } },
  { id: 'discord', label: 'Discord', description: 'Discord bot', template: { bot_token: '', guild_id: '', allowed_users: [], listen_to_bots: false, mention_only: true } },
  { id: 'slack', label: 'Slack', description: 'Slack app bot', template: { bot_token: '', app_token: '', channel_id: '', allowed_users: [] } },
  { id: 'mattermost', label: 'Mattermost', description: 'Mattermost bot', template: { url: 'https://mattermost.example.com', bot_token: '', channel_id: '', allowed_users: [], thread_replies: true, mention_only: false } },
  { id: 'webhook', label: 'Webhook', description: 'HTTP inbound webhook', template: { port: 8787, secret: '' } },
  { id: 'imessage', label: 'iMessage', description: 'macOS iMessage bridge', template: { allowed_contacts: [] } },
  { id: 'matrix', label: 'Matrix', description: 'Matrix bot', template: { homeserver: 'https://matrix.org', access_token: '', user_id: '', device_id: '', room_id: '', allowed_users: [] } },
  { id: 'signal', label: 'Signal', description: 'signal-cli HTTP daemon', template: { http_url: 'http://127.0.0.1:8686', account: '+1234567890', group_id: '', allowed_from: ['*'], ignore_attachments: false, ignore_stories: false } },
  { id: 'whatsapp', label: 'WhatsApp', description: 'Cloud API or Web mode', template: { access_token: '', phone_number_id: '', verify_token: '', app_secret: '', session_path: '', pair_phone: '', pair_code: '', allowed_numbers: ['*'] } },
  { id: 'linq', label: 'Linq', description: 'Linq Partner API', template: { api_token: '', from_phone: '+1234567890', signing_secret: '', allowed_senders: ['*'] } },
  { id: 'wati', label: 'WATI', description: 'WATI Business API', template: { api_token: '', api_url: 'https://live-mt-server.wati.io', tenant_id: '', allowed_numbers: ['*'] } },
  { id: 'nextcloud_talk', label: 'Nextcloud Talk', description: 'Nextcloud Talk bot', template: { base_url: 'https://cloud.example.com', app_token: '', webhook_secret: '', allowed_users: ['*'] } },
  { id: 'email', label: 'Email', description: 'IMAP/SMTP channel', template: { imap_host: 'imap.example.com', imap_port: 993, imap_folder: 'INBOX', smtp_host: 'smtp.example.com', smtp_port: 465, smtp_tls: true, username: '', password: '', from_address: 'bot@example.com', idle_timeout_secs: 1740, allowed_senders: ['*'] } },
  { id: 'irc', label: 'IRC', description: 'IRC bot', template: { server: 'irc.libera.chat', port: 6697, nickname: 'zeroclaw-bot', username: 'zeroclaw', channels: ['#general'], allowed_users: ['*'], server_password: '', nickserv_password: '', sasl_password: '', verify_tls: true } },
  { id: 'lark', label: 'Lark', description: 'Lark international bot', template: { app_id: '', app_secret: '', encrypt_key: '', verification_token: '', allowed_users: ['*'], mention_only: true, use_feishu: false, receive_mode: 'websocket', port: null } },
  { id: 'feishu', label: 'Feishu', description: 'Feishu CN bot', template: { app_id: '', app_secret: '', encrypt_key: '', verification_token: '', allowed_users: ['*'], receive_mode: 'websocket', port: null } },
  { id: 'dingtalk', label: 'DingTalk', description: 'DingTalk stream mode', template: { client_id: '', client_secret: '', allowed_users: ['*'] } },
  { id: 'qq', label: 'QQ Official Bot', description: 'Tencent QQ bot', template: { app_id: '', app_secret: '', allowed_users: ['*'] } },
  { id: 'nostr', label: 'Nostr', description: 'Nostr private messages', template: { private_key: '', relays: ['wss://relay.damus.io'], allowed_pubkeys: ['*'] } },
  { id: 'clawdtalk', label: 'ClawdTalk', description: 'Telnyx SIP voice channel', template: { api_key: '', connection_id: '', from_number: '+1234567890', allowed_destinations: ['*'], webhook_secret: '' } },
];

const CHANNEL_LABEL_MAP = Object.fromEntries(CHANNEL_DEFS.map((channel) => [channel.id, channel.label])) as Record<string, string>;

const MEMORY_BACKENDS = [
  { id: 'sqlite' },
  { id: 'qdrant' },
  { id: 'postgres' },
  { id: 'none' },
];

const TIMEZONE_OPTIONS = [
  "US/Eastern (EST/EDT)",
  "US/Central (CST/CDT)",
  "US/Mountain (MST/MDT)",
  "US/Pacific (PST/PDT)",
  "Europe/London (GMT/BST)",
  "Europe/Berlin (CET/CEST)",
  "Asia/Tokyo (JST)",
  "UTC",
  "__manual__",
];

const COMM_STYLE_OPTIONS = [
  { id: 'direct', value: "Be direct and concise. Skip pleasantries. Get to the point." },
  { id: 'friendly', value: "Be friendly, human, and conversational. Show warmth and empathy while staying efficient. Use natural contractions." },
  { id: 'professional', value: "Be professional and polished. Stay calm, structured, and respectful. Use occasional tone-setting emojis only when appropriate." },
  { id: 'playful', value: "Be expressive and playful when appropriate. Use relevant emojis naturally (0-2 max), and keep serious topics emoji-light." },
  { id: 'technical', value: "Be technical and detailed. Thorough explanations, code-first." },
  { id: 'balanced', value: "Adapt to the situation. Default to warm and clear communication; be concise when needed, thorough when it matters." },
  { id: 'custom', value: "__custom__" },
];

const RECOMMENDED_MODELS: Record<string, { id: string; label: string }[]> = {
  openrouter: [
    { id: 'anthropic/claude-sonnet-4.6', label: 'Claude Sonnet 4.6 (balanced, recommended)' },
    { id: 'openai/gpt-5.2', label: 'GPT-5.2 (latest flagship)' },
    { id: 'openai/gpt-5-mini', label: 'GPT-5 mini (fast, cost-efficient)' },
    { id: 'google/gemini-3-pro-preview', label: 'Gemini 3 Pro Preview (frontier reasoning)' },
    { id: 'x-ai/grok-4.1-fast', label: 'Grok 4.1 Fast (reasoning + speed)' },
    { id: 'deepseek/deepseek-v3.2', label: 'DeepSeek V3.2 (agentic + affordable)' },
    { id: 'meta-llama/llama-4-maverick', label: 'Llama 4 Maverick (open model)' },
  ],
  anthropic: [
    { id: 'claude-sonnet-4-5-20250929', label: 'Claude Sonnet 4.5 (balanced, recommended)' },
    { id: 'claude-opus-4-6', label: 'Claude Opus 4.6 (best quality)' },
    { id: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5 (fastest, cheapest)' },
  ],
  openai: [
    { id: 'gpt-5.2', label: 'GPT-5.2 (latest coding/agentic flagship)' },
    { id: 'gpt-5-mini', label: 'GPT-5 mini (faster, cheaper)' },
    { id: 'gpt-5-nano', label: 'GPT-5 nano (lowest latency/cost)' },
    { id: 'gpt-5.2-codex', label: 'GPT-5.2 Codex (agentic coding)' },
  ],
  'openai-codex': [
    { id: 'gpt-5-codex', label: 'GPT-5 Codex (recommended)' },
    { id: 'gpt-5.2-codex', label: 'GPT-5.2 Codex (agentic coding)' },
    { id: 'o4-mini', label: 'o4-mini (fallback)' },
  ],
  venice: [
    { id: 'zai-org-glm-5', label: 'GLM-5 via Venice (agentic flagship)' },
    { id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6 via Venice (best quality)' },
    { id: 'deepseek-v3.2', label: 'DeepSeek V3.2 via Venice (strong value)' },
    { id: 'grok-41-fast', label: 'Grok 4.1 Fast via Venice (low latency)' },
  ],
  groq: [
    { id: 'llama-3.3-70b-versatile', label: 'Llama 3.3 70B (fast, recommended)' },
    { id: 'openai/gpt-oss-120b', label: 'GPT-OSS 120B (strong open-weight)' },
    { id: 'openai/gpt-oss-20b', label: 'GPT-OSS 20B (cost-efficient open-weight)' },
  ],
  mistral: [
    { id: 'mistral-large-latest', label: 'Mistral Large (latest flagship)' },
    { id: 'mistral-medium-latest', label: 'Mistral Medium (balanced)' },
    { id: 'codestral-latest', label: 'Codestral (code-focused)' },
    { id: 'devstral-latest', label: 'Devstral (software engineering specialist)' },
  ],
  deepseek: [
    { id: 'deepseek-chat', label: 'DeepSeek Chat (mapped to V3.2 non-thinking)' },
    { id: 'deepseek-reasoner', label: 'DeepSeek Reasoner (mapped to V3.2 thinking)' },
  ],
  xai: [
    { id: 'grok-4-1-fast-reasoning', label: 'Grok 4.1 Fast Reasoning (recommended)' },
    { id: 'grok-4-1-fast-non-reasoning', label: 'Grok 4.1 Fast Non-Reasoning (low latency)' },
    { id: 'grok-code-fast-1', label: 'Grok Code Fast 1 (coding specialist)' },
    { id: 'grok-4', label: 'Grok 4 (max quality)' },
  ],
  perplexity: [
    { id: 'sonar-pro', label: 'Sonar Pro (flagship web-grounded model)' },
    { id: 'sonar', label: 'Sonar (balanced)' },
  ],
  gemini: [
    { id: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro (recommended)' },
    { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash (fastest)' },
    { id: 'gemini-ultra-2', label: 'Gemini Ultra 2 (best reasoning)' },
  ],
  fireworks: [
    { id: 'accounts/fireworks/models/llama-v3p3-70b-instruct', label: 'Llama 3.3 70B (fast)' },
    { id: 'accounts/fireworks/models/mixtral-8x22b-instruct', label: 'Mixtral 8x22B (balanced)' },
    { id: 'accounts/fireworks/models/qwen2p5-72b-instruct', label: 'Qwen 2.5 72B (strong coding)' },
  ],
  novita: [
    { id: 'minimax/minimax-m2.5', label: 'MiniMax M2.5' },
    { id: 'meta-llama/llama-3.3-70b-instruct', label: 'Llama 3.3 70B' },
    { id: 'mistralai/mistral-large-2411', label: 'Mistral Large' },
  ],
  'together-ai': [
    { id: 'meta-llama/Llama-3.3-70B-Instruct-Turbo', label: 'Llama 3.3 70B Turbo' },
    { id: 'Qwen/Qwen2.5-Coder-32B-Instruct', label: 'Qwen 2.5 Coder 32B' },
    { id: 'deepseek-ai/DeepSeek-V3', label: 'DeepSeek V3' },
  ],
  cohere: [
    { id: 'command-r-plus-08-2024', label: 'Command R+ (best RAG)' },
    { id: 'command-r-08-2024', label: 'Command R (balanced)' },
    { id: 'command-a-03-2025', label: 'Command A (agentic)' },
  ],
  moonshot: [
    { id: 'kimi-k2.5', label: 'Kimi k2.5 (recommended)' },
    { id: 'moonshot-v1-8k', label: 'Moonshot V1 8k' },
    { id: 'moonshot-v1-32k', label: 'Moonshot V1 32k' },
    { id: 'moonshot-v1-128k', label: 'Moonshot V1 128k' },
  ],
  glm: [
    { id: 'glm-5', label: 'GLM-5 (latest flagship)' },
    { id: 'glm-4-plus', label: 'GLM-4 Plus' },
    { id: 'glm-4-air', label: 'GLM-4 Air (fast)' },
    { id: 'glm-4-flash', label: 'GLM-4 Flash (free-tier speed)' },
  ],
  minimax: [
    { id: 'MiniMax-M2.5', label: 'MiniMax M2.5 (latest, recommended)' },
    { id: 'MiniMax-M2.5-highspeed', label: 'MiniMax M2.5 High-Speed (faster)' },
    { id: 'MiniMax-M2.1', label: 'MiniMax M2.1 (stable)' },
  ],
  qwen: [
    { id: 'qwen-plus', label: 'Qwen Plus (balanced)' },
    { id: 'qwen-max', label: 'Qwen Max (best quality)' },
    { id: 'qwen-turbo', label: 'Qwen Turbo (fastest)' },
    { id: 'qwen-long', label: 'Qwen Long (long context)' },
  ],
  'qwen-code': [
    { id: 'qwen3-coder-plus', label: 'Qwen 3 Coder Plus (flagship)' },
    { id: 'qwen2.5-coder-32b-instruct', label: 'Qwen 2.5 Coder 32B' },
  ],
  ollama: [
    { id: 'llama3.2', label: 'Llama 3.2' },
    { id: 'mistral', label: 'Mistral 7B' },
    { id: 'qwen2.5-coder', label: 'Qwen 2.5 Coder' },
    { id: 'deepseek-r1', label: 'DeepSeek R1' },
  ],
  llamacpp: [
    { id: 'ggml-org/gpt-oss-20b-GGUF', label: 'GPT-OSS 20B' },
  ],
  bedrock: [
    { id: 'anthropic.claude-sonnet-4-5-20250929-v1:0', label: 'Claude Sonnet 4.5' },
    { id: 'us.amazon.nova-pro-v1:0', label: 'Nova Pro' },
    { id: 'meta.llama3-3-70b-instruct-v1:0', label: 'Llama 3.3 70B' },
  ],
  nvidia: [
    { id: 'meta/llama-3.3-70b-instruct', label: 'Llama 3.3 70B' },
    { id: 'deepseek-ai/deepseek-r1', label: 'DeepSeek R1' },
    { id: 'nvidia/llama-3.1-nemotron-70b-instruct', label: 'Llama 3.1 Nemotron 70B' },
  ],
};

const STEPS = [
  { id: 'tier', label: 'onboard.step.tier' },
  { id: 'provider', label: 'onboard.step.provider' },
  { id: 'provider_config', label: 'onboard.step.provider_config' },
  { id: 'identity', label: 'onboard.step.identity' },
  { id: 'memory', label: 'onboard.step.memory' },
  { id: 'features', label: 'onboard.step.features' },
  { id: 'hardware', label: 'onboard.step.hardware' },
  { id: 'channels', label: 'onboard.step.channels' },
  { id: 'config', label: 'onboard.step.config' },
];

function Stepper({ currentStep, onStepClick }: { currentStep: string; onStepClick: (step: string) => void }) {
  const { t } = useTranslation();
  const currentIdx = STEPS.findIndex(s => s.id === currentStep);

  return (
    <div className="w-full mb-12 relative px-4">
      {/* Progress Bar Background */}
      <div className="absolute top-4 left-0 w-full h-0.5 bg-gray-800 -z-10" />

      {/* Progress Bar Fill */}
      <div
        className="absolute top-4 left-0 h-0.5 bg-blue-500 -z-10 transition-all duration-500 ease-out"
        style={{ width: `${(currentIdx / (STEPS.length - 1)) * 100}%` }}
      />

      <div className="flex justify-between relative">
        {STEPS.map((step, idx) => {
          const isCompleted = idx < currentIdx;
          const isCurrent = idx === currentIdx;
          const isClickable = isCompleted;

          return (
            <button
              key={step.id}
              onClick={() => isClickable && onStepClick(step.id)}
              disabled={!isClickable}
              className={`flex flex-col items-center group relative outline-none ${isClickable ? 'cursor-pointer' : 'cursor-default'}`}
            >
              <div
                className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium border-2 transition-all duration-300 z-10 ${
                  isCompleted
                    ? 'bg-blue-500 border-blue-500 text-white shadow-[0_0_10px_rgba(59,130,246,0.5)] group-hover:scale-110'
                    : isCurrent
                      ? 'bg-gray-900 border-blue-500 text-blue-400 shadow-[0_0_15px_rgba(59,130,246,0.3)] scale-110'
                      : 'bg-gray-900 border-gray-700 text-gray-500'
                }`}
              >
                {isCompleted ? <CheckCircle className="w-4 h-4" /> : idx + 1}
              </div>

              {/* Label */}
              <div className={`absolute top-10 text-xs whitespace-nowrap transition-all duration-300 font-medium ${
                isCurrent
                  ? 'text-blue-400 opacity-100 translate-y-0'
                  : 'text-gray-500 opacity-0 -translate-y-2 group-hover:opacity-100 group-hover:translate-y-0'
              }`}>
                {t(step.label)}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

export default function Onboard() {
  const { t } = useTranslation();
  const [step, setStep] = useState<'tier' | 'provider' | 'provider_config' | 'identity' | 'memory' | 'features' | 'hardware' | 'channels' | 'config'>('tier');
  const [selectedTier, setSelectedTier] = useState<TierDef>(TIERS[0] as TierDef);
  const [selectedProvider, setSelectedProvider] = useState<ProviderDef>(TIERS[0]?.providers[0] as ProviderDef);

  const [apiKey, setApiKey] = useState('');
  const [apiUrl, setApiUrl] = useState('');
  const [model, setModel] = useState('');

  // Identity state
  const [agentName, setAgentName] = useState('DeerClaw');
  const [userName, setUserName] = useState('User');
  const [timezone, setTimezone] = useState(Intl.DateTimeFormat().resolvedOptions().timeZone);
  const [commStyle, setCommStyle] = useState(COMM_STYLE_OPTIONS.find(o => o.id === 'friendly')?.value || ''); // Default to 'friendly'
  const [memoryBackend, setMemoryBackend] = useState('sqlite');
  const [memoryAutoSave, setMemoryAutoSave] = useState(true);
  const [memoryPostgresUrl, setMemoryPostgresUrl] = useState('');
  const [memoryQdrantUrl, setMemoryQdrantUrl] = useState('');
  const [memoryQdrantApiKey, setMemoryQdrantApiKey] = useState('');

  // Hardware state
  const [hardwareEnabled, setHardwareEnabled] = useState(false);
  const [hardwareTransport, setHardwareTransport] = useState<'native' | 'serial' | 'probe'>('native');
  const [serialPort, setSerialPort] = useState('/dev/tty.usbmodem123456');
  const [baudRate, setBaudRate] = useState(115200);
  const [probeTarget, setProbeTarget] = useState('STM32F401RE');
  const [workspaceDatasheets, setWorkspaceDatasheets] = useState(false);

  const [selectedChannels, setSelectedChannels] = useState<string[]>([]);
  const [channelConfigs, setChannelConfigs] = useState<Record<string, string>>(
    Object.fromEntries(CHANNEL_DEFS.map((channel) => [channel.id, JSON.stringify(channel.template, null, 2)])) as Record<string, string>
  );
  const [channelEditMode, setChannelEditMode] = useState<Record<string, 'form' | 'json'>>({});

  // Features state
  const [toolMode, setToolMode] = useState<'sovereign' | 'composio'>('sovereign');
  const [composioApiKey, setComposioApiKey] = useState('');
  const [encryptSecrets, setEncryptSecrets] = useState(false);
  const [autonomyLevel, setAutonomyLevel] = useState<'read_only' | 'supervised' | 'full'>('read_only');
  const [enableTunnel, setEnableTunnel] = useState(false);
  const [tunnelProvider, setTunnelProvider] = useState<'cloudflare' | 'ngrok' | 'tailscale' | 'custom'>('cloudflare');
  const [tunnelToken, setTunnelToken] = useState('');
  const [tunnelNgrokAuthToken, setTunnelNgrokAuthToken] = useState('');
  const [tunnelNgrokDomain, setTunnelNgrokDomain] = useState('');
  const [tunnelTailscaleFunnel, setTunnelTailscaleFunnel] = useState(false);
  const [tunnelCustomCommand, setTunnelCustomCommand] = useState('');

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const parseChannelConfig = (channelId: string): Record<string, unknown> | null => {
    try {
      const parsed = JSON.parse(channelConfigs[channelId] || '{}');
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
      return null;
    } catch {
      return null;
    }
  };

  const updateChannelField = (channelId: string, field: string, currentValue: unknown, rawValue: string | boolean) => {
    const parsed = parseChannelConfig(channelId);
    if (!parsed) return;
    let nextValue: unknown = rawValue;
    if (typeof currentValue === 'number') {
      const n = Number(rawValue);
      nextValue = Number.isNaN(n) ? 0 : n;
    } else if (typeof currentValue === 'boolean') {
      nextValue = Boolean(rawValue);
    } else if (Array.isArray(currentValue)) {
      nextValue = String(rawValue).split(',').map((v) => v.trim()).filter(Boolean);
    } else if (currentValue === null && typeof rawValue === 'string' && rawValue.trim() === '') {
      nextValue = null;
    }
    const next = { ...parsed, [field]: nextValue };
    setChannelConfigs((prev) => ({ ...prev, [channelId]: JSON.stringify(next, null, 2) }));
  };

  const handleTierSelect = (tier: TierDef) => {
    setSelectedTier(tier);
    if (tier.id === 'custom') {
      const customProvider = tier.providers[0] as ProviderDef;
      setSelectedProvider(customProvider);
      setApiUrl(customProvider.defaultUrl || '');
      setStep('provider_config');
      return;
    }
    setStep('provider');
  };

  const handleProviderSelect = (provider: ProviderDef) => {
    setSelectedProvider(provider);
    if (provider.defaultUrl) {
      setApiUrl(provider.defaultUrl);
    } else {
      setApiUrl('');
    }
    setStep('provider_config');
  };

  const handleProviderConfigSubmit = (e: FormEvent) => {
    e.preventDefault();
    setStep('identity');
  };

  const handleIdentitySubmit = (e: FormEvent) => {
    e.preventDefault();
    setStep('memory');
  };

  const handleMemorySubmit = (e: FormEvent) => {
    e.preventDefault();
    setStep('features');
  };

  const handleFeaturesSubmit = (e: FormEvent) => {
    e.preventDefault();
    setStep('hardware');
  };

  const handleHardwareSubmit = (e: FormEvent) => {
    e.preventDefault();
    setStep('channels');
  };

  const handleChannelsSubmit = (e: FormEvent) => {
    e.preventDefault();
    for (const channelId of selectedChannels) {
      const rawConfig = channelConfigs[channelId] || '{}';
      try {
        const parsed = JSON.parse(rawConfig);
        if (parsed === null || Array.isArray(parsed) || typeof parsed !== 'object') {
          throw new Error('invalid json object');
        }
      } catch {
        setError(t('onboard.channels.invalid_json', { channel: CHANNEL_LABEL_MAP[channelId] }));
        return;
      }
    }
    setError(null);
    setStep('config');
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      // For custom provider, the ID is "custom:{url}"
      let providerId = selectedProvider.id;
      if (selectedTier.id === 'custom') {
        if (!apiUrl) throw new Error('API Base URL is required for custom provider');
        providerId = `custom:${apiUrl.replace(/\/+$/, '')}`;
      }

      await onboardInit({
        tier: selectedTier.id,
        provider: providerId,
        api_key: apiKey || undefined,
        model: model || undefined,
        api_url: (selectedProvider.requiresUrl) ? apiUrl : undefined,
        agent_name: agentName,
        user_name: userName,
        timezone: timezone,
        communication_style: commStyle,
        memory_backend: memoryBackend,
        memory_auto_save: memoryAutoSave,
        // Memory details
        memory_postgres_url: memoryPostgresUrl || undefined,
        memory_qdrant_url: memoryQdrantUrl || undefined,
        memory_qdrant_api_key: memoryQdrantApiKey || undefined,
        // New fields
        tool_mode: toolMode,
        composio_api_key: composioApiKey || undefined,
        secrets_encrypt: encryptSecrets,
        autonomy_level: autonomyLevel,
        enable_tunnel: enableTunnel,
        tunnel_provider: tunnelProvider,
        tunnel_cloudflare_token: tunnelToken || undefined,
        tunnel_ngrok_auth_token: tunnelNgrokAuthToken || undefined,
        tunnel_ngrok_domain: tunnelNgrokDomain || undefined,
        tunnel_tailscale_funnel: tunnelTailscaleFunnel,
        tunnel_custom_command: tunnelCustomCommand || undefined,
        // Hardware
        hardware_enabled: hardwareEnabled,
        hardware_transport: hardwareTransport,
        serial_port: serialPort,
        baud_rate: baudRate,
        probe_target: probeTarget,
        workspace_datasheets: workspaceDatasheets,
        channels_config: selectedChannels.length > 0
          ? {
            cli: true,
            message_timeout_secs: 300,
            ...Object.fromEntries(
              selectedChannels.map((channelId) => [channelId, JSON.parse(channelConfigs[channelId] || '{}') as Record<string, unknown>])
            )
          }
          : undefined,
      });

      // Force reload to pick up new config/auth state
      window.location.href = '/';
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to initialize configuration';
      if (/Cannot reach local API|Failed to fetch|Load failed/i.test(message)) {
        setError(t('onboard.error.api_unreachable'));
      } else {
        setError(message);
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-black text-white font-sans selection:bg-blue-500/30">
      <div className="fixed inset-0 bg-[radial-gradient(ellipse_at_top,var(--tw-gradient-stops))] from-blue-900/20 via-gray-900/0 to-gray-900/0 pointer-events-none" />

      <div className="relative z-10 max-w-5xl mx-auto px-6 py-12 min-h-screen flex flex-col">
        {/* Header */}
        <div className="flex flex-col items-center mb-8 animate-in fade-in slide-in-from-top-4 duration-700">
          <div className="w-16 h-16 bg-blue-600/20 rounded-2xl flex items-center justify-center mb-6 backdrop-blur-sm border border-blue-500/20 shadow-[0_0_30px_-10px_rgba(37,99,235,0.3)]">
            <Bot className="h-8 w-8 text-blue-400" />
          </div>
          <h1 className="text-4xl font-bold text-transparent bg-clip-text bg-linear-to-b from-white to-gray-400 mb-3 tracking-tight">
            {t('onboard.welcome')}
          </h1>
          <p className="text-gray-400 text-lg max-w-md text-center leading-relaxed">
            {t('onboard.welcome.subtitle')}
          </p>
        </div>

        {/* Stepper */}
        <div className="max-w-3xl mx-auto w-full mb-8">
          <Stepper currentStep={step} onStepClick={(s) => setStep(s as any)} />
        </div>

        {/* Content Area */}
        <div className="w-full max-w-4xl mx-auto">
          {error && (
            <div className="mb-8 animate-in fade-in slide-in-from-top-2 duration-500">
              <div className="flex items-center gap-3 bg-red-500/10 border border-red-500/20 rounded-xl p-4 text-red-200">
                <AlertTriangle className="h-5 w-5 flex-shrink-0" />
                <span className="text-sm font-medium">{error}</span>
              </div>
            </div>
          )}

          <div key={step} className="animate-in fade-in slide-in-from-bottom-8 duration-500 fill-mode-backwards">
            {step === 'tier' && (
              <div className="space-y-8">
                <div className="text-center mb-10">
                  <h2 className="text-2xl font-semibold text-white mb-2">{t('onboard.step.tier')}</h2>
                  <p className="text-gray-400">{t('onboard.tier.subtitle')}</p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                  {TIERS.map((tier) => (
                    <button
                      key={tier.id}
                      onClick={() => handleTierSelect(tier)}
                      className="group relative flex flex-col items-start p-6 bg-gray-900/40 border border-gray-800/60 hover:border-blue-500/50 hover:bg-gray-800/60 rounded-2xl transition-all duration-300 text-left hover:shadow-[0_0_30px_-10px_rgba(37,99,235,0.15)] overflow-hidden"
                    >
                      <div className="absolute inset-0 bg-linear-to-br from-blue-500/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500" />

                      <div className="relative z-10 flex items-center gap-4 mb-3 w-full">
                        <div className="p-2.5 bg-gray-800/50 rounded-xl group-hover:bg-blue-500/20 group-hover:text-blue-300 transition-colors duration-300 border border-gray-700/50 group-hover:border-blue-500/20">
                          <tier.icon className="h-6 w-6 text-gray-400 group-hover:text-blue-300 transition-colors" />
                        </div>
                        <span className="font-semibold text-xl text-gray-200 group-hover:text-white transition-colors">
                          {t(`onboard.tier.${tier.id}`)}
                        </span>
                        <ChevronRight className="ml-auto h-5 w-5 text-gray-600 group-hover:text-blue-400 group-hover:translate-x-1 transition-all duration-300 opacity-0 group-hover:opacity-100" />
                      </div>

                      <p className="relative z-10 text-sm text-gray-500 group-hover:text-gray-400 transition-colors leading-relaxed pl-[3.25rem]">
                        {t(`onboard.tier.${tier.id}.desc`)}
                      </p>
                    </button>
                  ))}
                </div>
              </div>
            )}

        {step === 'provider' && (
          <div className="space-y-8">
            <div className="text-center mb-10">
              <h2 className="text-2xl font-semibold text-white mb-2">{t('onboard.step.provider')}</h2>
              <p className="text-gray-400">{t('onboard.provider.select', { tier: t('onboard.tier.' + selectedTier.id) })}</p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {selectedTier.providers.map((provider) => (
                <button
                  key={provider.id}
                  onClick={() => handleProviderSelect(provider)}
                  className="group relative flex flex-col justify-between p-5 bg-gray-900/40 border border-gray-800/60 hover:border-blue-500/50 hover:bg-gray-800/60 rounded-xl transition-all duration-300 text-left hover:shadow-[0_0_20px_-5px_rgba(37,99,235,0.15)] overflow-hidden h-full"
                >
                  <div className="absolute inset-0 bg-gradient-to-br from-blue-500/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500" />

                  <div className="relative z-10 w-full">
                    <div className="flex items-center justify-between mb-2">
                      <span className="font-semibold text-lg text-gray-200 group-hover:text-white transition-colors">
                        {t(`onboard.provider.${provider.id}`)}
                      </span>
                      <ChevronRight className="h-5 w-5 text-gray-600 group-hover:text-blue-400 opacity-0 group-hover:opacity-100 transition-all -translate-x-2 group-hover:translate-x-0" />
                    </div>
                    {provider.description && (
                      <p className="text-sm text-gray-500 mt-1 group-hover:text-gray-400 transition-colors line-clamp-2">
                        {provider.description}
                      </p>
                    )}
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}

        {step === 'provider_config' && (
          <form onSubmit={handleProviderConfigSubmit} className="space-y-8 animate-in fade-in slide-in-from-bottom-8 duration-500 fill-mode-backwards">
            <div className="space-y-6">
              <div className="text-center mb-8">
                 <h2 className="text-2xl font-semibold text-white mb-2">{t(`onboard.provider.${selectedProvider.id}`)}</h2>
                 <p className="text-gray-400">{t('onboard.provider_config.subtitle')}</p>
              </div>

              {/* URL Input (for Local, Custom, or remote Ollama) */}
              {(selectedProvider.requiresUrl || selectedTier.id === 'custom') && (
                <div className="animate-in fade-in slide-in-from-top-2">
                  <label className="block text-sm font-medium text-gray-400 mb-2">
                    {t(`onboard.endpoint.${selectedProvider.id}`, { defaultValue: t('onboard.config.endpoint') })}
                  </label>
                  <input
                    type="text"
                    value={apiUrl}
                    onChange={(e) => setApiUrl(e.target.value)}
                    placeholder={selectedProvider.defaultUrl || "https://api.example.com/v1"}
                    className="w-full bg-gray-900/40 border border-gray-800/60 rounded-xl p-3.5 text-white placeholder-gray-600 focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500/50 transition-all outline-none"
                    required
                  />
                  <p className="text-xs text-gray-500 mt-2">
                    {t('onboard.config.endpoint.help')}
                  </p>
                </div>
              )}

              {/* API Key Input */}
              {(selectedProvider.requiresApiKey || selectedTier.id === 'custom') && (
                <div className="animate-in fade-in slide-in-from-top-2">
                  <label className="block text-sm font-medium text-gray-400 mb-2">
                    {t('onboard.config.apikey')} {selectedTier.id === 'custom' && <span className="text-gray-500">({t('onboard.config.optional')})</span>}
                  </label>
                  <input
                    type="password"
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    placeholder={selectedProvider.requiresApiKey ? t('onboard.config.apikey.placeholder', { provider: t(`onboard.provider.${selectedProvider.id}`) }) : t('onboard.config.apikey.optional_placeholder')}
                    className="w-full bg-gray-900/40 border border-gray-800/60 rounded-xl p-3.5 text-white placeholder-gray-600 focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500/50 transition-all outline-none"
                    required={selectedProvider.requiresApiKey}
                  />
                </div>
              )}

              {/* Model Input */}
              <div className="animate-in fade-in slide-in-from-top-2">
                <label className="block text-sm font-medium text-gray-400 mb-2">
                  {t('onboard.config.model')}
                </label>
                <input
                  type="text"
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  placeholder={selectedProvider.modelPlaceholder || "e.g. gpt-4-turbo"}
                  className="w-full bg-gray-900/40 border border-gray-800/60 rounded-xl p-3.5 text-white placeholder-gray-600 focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500/50 transition-all outline-none"
                  required
                />

                {/* Quick Select Chips */}
                {selectedProvider && RECOMMENDED_MODELS[selectedProvider.id] && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {RECOMMENDED_MODELS[selectedProvider.id]?.map((m) => (
                      <button
                        key={m.id}
                        type="button"
                        onClick={() => setModel(m.id)}
                        className={`text-xs px-3 py-1.5 rounded-full border transition-all ${
                          model === m.id
                            ? 'bg-blue-900/30 border-blue-500/50 text-blue-300'
                            : 'bg-white/5 border-white/10 text-gray-400 hover:border-white/20 hover:text-gray-300'
                        }`}
                      >
                        {t(`onboard.model.${m.id}`, { defaultValue: m.label })}
                      </button>
                    ))}
                  </div>
                )}

                <p className="text-xs text-gray-500 mt-2">
                  {t('onboard.config.model.help')}
                </p>
              </div>
            </div>

            <button
              type="submit"
              className="w-full bg-blue-600 hover:bg-blue-500 text-white font-semibold py-4 rounded-xl transition-all transform hover:scale-[1.01] active:scale-[0.99] shadow-lg shadow-blue-500/20 flex items-center justify-center gap-2 group"
            >
              <span className="text-lg">{t('onboard.continue')}</span>
              <ChevronRight className="h-5 w-5 group-hover:translate-x-1 transition-transform" />
            </button>
          </form>
        )}

        {step === 'identity' && (
          <form onSubmit={handleIdentitySubmit} className="space-y-8 animate-in fade-in slide-in-from-bottom-8 duration-500 fill-mode-backwards">
            <div className="text-center mb-10">
              <h2 className="text-2xl font-semibold text-white mb-2">{t('onboard.identity.title')}</h2>
              <p className="text-gray-400">{t('onboard.identity.desc')}</p>
            </div>

            <div className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-2">
                  <label className="block text-sm font-medium text-gray-400">{t('onboard.identity.agent_name')}</label>
                  <input
                    type="text"
                    value={agentName}
                    onChange={(e) => setAgentName(e.target.value)}
                    className="w-full bg-gray-900/40 border border-gray-800/60 rounded-xl p-3.5 text-white focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500/50 transition-all outline-none"
                    placeholder={t('onboard.identity.agent_name.placeholder')}
                  />
                </div>

                <div className="space-y-2">
                  <label className="block text-sm font-medium text-gray-400">{t('onboard.identity.user_name')}</label>
                  <input
                    type="text"
                    value={userName}
                    onChange={(e) => setUserName(e.target.value)}
                    className="w-full bg-gray-900/40 border border-gray-800/60 rounded-xl p-3.5 text-white focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500/50 transition-all outline-none"
                    placeholder={t('onboard.identity.user_name.placeholder')}
                  />
                </div>
              </div>

              <div className="space-y-2">
                <label className="block text-sm font-medium text-gray-400">{t('onboard.identity.timezone')}</label>
                <div className="relative group">
                  <select
                    value={TIMEZONE_OPTIONS.includes(timezone) ? timezone : '__manual__'}
                    onChange={(e) => {
                      const val = e.target.value;
                      if (val === '__manual__') {
                        setTimezone('');
                      } else {
                        const extracted = val.split('(')[0]?.trim() || '';
                        setTimezone(extracted);
                      }
                    }}
                    className="w-full bg-gray-900/40 border border-gray-800/60 rounded-xl p-3.5 text-white focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500/50 transition-all appearance-none pr-10 outline-none cursor-pointer"
                    style={{ colorScheme: 'dark' }}
                  >
                    {TIMEZONE_OPTIONS.map((opt) => (
                      <option key={opt} value={opt} className="bg-gray-900 text-gray-300">
                        {opt === '__manual__' ? t('onboard.timezone.manual') : opt}
                      </option>
                    ))}
                  </select>
                  <div className="absolute right-3.5 top-1/2 -translate-y-1/2 pointer-events-none text-gray-500 group-hover:text-blue-400 transition-colors">
                    <ChevronDown className="h-5 w-5" />
                  </div>
                </div>
                {(!TIMEZONE_OPTIONS.some(opt => opt.startsWith(timezone)) || timezone === '') && (
                  <input
                    type="text"
                    value={timezone}
                    onChange={(e) => setTimezone(e.target.value)}
                    className="mt-2 w-full bg-gray-900/40 border border-gray-800/60 rounded-xl p-3.5 text-white focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500/50 transition-all outline-none animate-in fade-in slide-in-from-top-1"
                    placeholder={t('onboard.identity.timezone.placeholder')}
                  />
                )}
              </div>
              <div className="space-y-2">
                <label className="block text-sm font-medium text-gray-400">{t('onboard.identity.comm_style')}</label>
                <div className="relative group">
                  <select
                    value={COMM_STYLE_OPTIONS.some(opt => opt.value === commStyle) ? commStyle : '__custom__'}
                    onChange={(e) => {
                      const val = e.target.value;
                      if (val === '__custom__') {
                        setCommStyle('');
                      } else {
                        setCommStyle(val);
                      }
                    }}
                    className="w-full bg-gray-900/40 border border-gray-800/60 rounded-xl p-3.5 text-white focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500/50 transition-all appearance-none pr-10 outline-none cursor-pointer"
                    style={{ colorScheme: 'dark' }}
                  >
                    {COMM_STYLE_OPTIONS.map((opt) => (
                      <option key={opt.id} value={opt.value} className="bg-gray-900 text-gray-300">
                        {t(`onboard.identity.style.${opt.id}`)}
                      </option>
                    ))}
                  </select>
                  <div className="absolute right-3.5 top-1/2 -translate-y-1/2 pointer-events-none text-gray-500 group-hover:text-blue-400 transition-colors">
                    <ChevronDown className="h-5 w-5" />
                  </div>
                </div>
                {(commStyle === '' || !COMM_STYLE_OPTIONS.some(opt => opt.value === commStyle)) && (
                  <textarea
                    value={commStyle}
                    onChange={(e) => setCommStyle(e.target.value)}
                    className="mt-2 w-full bg-gray-900/40 border border-gray-800/60 rounded-xl p-3.5 text-white focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500/50 transition-all h-24 outline-none animate-in fade-in slide-in-from-top-1"
                    placeholder={t('onboard.identity.style.custom_placeholder')}
                  />
                )}
                <p className="text-xs text-gray-500">{t('onboard.identity.comm_style.desc')}</p>
              </div>
            </div>

            <button
              type="submit"
              className="w-full bg-blue-600 hover:bg-blue-500 text-white font-semibold py-4 rounded-xl transition-all transform hover:scale-[1.01] active:scale-[0.99] shadow-lg shadow-blue-500/20 flex items-center justify-center gap-2 group"
            >
              <span className="text-lg">{t('onboard.continue')}</span>
              <ChevronRight className="h-5 w-5 group-hover:translate-x-1 transition-transform" />
            </button>
          </form>
        )}

        {step === 'memory' && (
          <form onSubmit={handleMemorySubmit} className="space-y-8 animate-in fade-in slide-in-from-bottom-8 duration-500 fill-mode-backwards">
            <div className="text-center mb-10">
              <h2 className="text-2xl font-semibold text-white mb-2">{t('onboard.memory.title')}</h2>
              <p className="text-gray-400">{t('onboard.memory.subtitle', { defaultValue: 'Configure agent memory storage' })}</p>
            </div>

            <div className="space-y-6">
              <div>
                <label className="block text-sm font-medium text-gray-400 mb-3">{t('onboard.memory.backend')}</label>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {MEMORY_BACKENDS.map((backend) => (
                    <button
                      key={backend.id}
                      type="button"
                      onClick={() => setMemoryBackend(backend.id)}
                      className={`group relative flex flex-col items-start p-5 rounded-xl transition-all text-left border ${
                        memoryBackend === backend.id
                          ? 'bg-blue-900/20 border-blue-500/50 ring-1 ring-blue-500/50'
                          : 'bg-gray-900/40 border-gray-800/60 hover:border-gray-600 hover:bg-gray-800/60'
                      }`}
                    >
                      <div className="flex items-center justify-between w-full mb-2">
                        <span className={`font-semibold text-lg ${memoryBackend === backend.id ? 'text-blue-400' : 'text-gray-200'}`}>
                          {t(`onboard.memory.${backend.id}`)}
                        </span>
                        {memoryBackend === backend.id && (
                          <CheckCircle className="h-5 w-5 text-blue-400" />
                        )}
                      </div>
                      <p className="text-sm text-gray-500 group-hover:text-gray-400 transition-colors">
                        {t(`onboard.memory.${backend.id}.desc`)}
                      </p>
                    </button>
                  ))}
                </div>
              </div>

              {/* Dynamic Memory Config Fields */}
              {memoryBackend === 'postgres' && (
                <div className="space-y-3 animate-in fade-in slide-in-from-top-2 duration-200 p-6 bg-gray-900/40 border border-gray-800/60 rounded-xl">
                  <label className="block text-sm font-medium text-gray-300">{t('onboard.memory.postgres_url')}</label>
                  <input
                    type="text"
                    value={memoryPostgresUrl}
                    onChange={(e) => setMemoryPostgresUrl(e.target.value)}
                    placeholder="postgresql://user:password@localhost:5432/zeroclaw"
                    className="w-full bg-black/50 border border-gray-800 rounded-xl p-3.5 text-white focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500/50 transition-all outline-none"
                    required
                  />
                </div>
              )}

              {memoryBackend === 'qdrant' && (
                <div className="space-y-4 animate-in fade-in slide-in-from-top-2 duration-200 p-6 bg-gray-900/40 border border-gray-800/60 rounded-xl">
                  <div>
                    <label className="block text-sm font-medium text-gray-300 mb-1">{t('onboard.memory.qdrant_url')}</label>
                    <input
                      type="text"
                      value={memoryQdrantUrl}
                      onChange={(e) => setMemoryQdrantUrl(e.target.value)}
                      placeholder="http://localhost:6333"
                      className="w-full bg-black/50 border border-gray-800 rounded-xl p-3.5 text-white focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500/50 transition-all outline-none"
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-300 mb-1">{t('onboard.memory.qdrant_key')}</label>
                    <input
                      type="password"
                      value={memoryQdrantApiKey}
                      onChange={(e) => setMemoryQdrantApiKey(e.target.value)}
                      placeholder="Enter Qdrant API Key if required"
                      className="w-full bg-black/50 border border-gray-800 rounded-xl p-3.5 text-white focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500/50 transition-all outline-none"
                    />
                  </div>
                </div>
              )}

              <div className="group">
                <label className="flex items-center justify-between cursor-pointer">
                  <div>
                    <div className="font-medium text-white group-hover:text-blue-400 transition-colors">{t('onboard.memory.auto_save')}</div>
                    <div className="text-sm text-gray-500 mt-1">
                      {t('onboard.memory.auto_save.desc')}
                    </div>
                  </div>
                  <div className="relative">
                    <input
                      type="checkbox"
                      checked={memoryAutoSave}
                      onChange={(e) => setMemoryAutoSave(e.target.checked)}
                      className="sr-only peer"
                    />
                    <div className="w-11 h-6 bg-gray-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
                  </div>
                </label>
              </div>
            </div>

            <button
              type="submit"
              className="w-full bg-blue-600 hover:bg-blue-500 text-white font-semibold py-4 rounded-xl transition-all transform hover:scale-[1.01] active:scale-[0.99] shadow-lg shadow-blue-500/20 flex items-center justify-center gap-2 group"
            >
              <span className="text-lg">{t('onboard.continue')}</span>
              <ChevronRight className="h-5 w-5 group-hover:translate-x-1 transition-transform" />
            </button>
          </form>
        )}

        {step === 'features' && (
          <form onSubmit={handleFeaturesSubmit} className="space-y-8 animate-in fade-in slide-in-from-bottom-8 duration-500 fill-mode-backwards">
            <div className="text-center mb-10">
              <h2 className="text-2xl font-semibold text-white mb-2">{t('onboard.features.title')}</h2>
              <p className="text-gray-400">{t('onboard.features.subtitle', { defaultValue: 'Configure agent capabilities' })}</p>
            </div>

            <div className="space-y-8">
              {/* Tool Mode */}
              <div>
                <label className="block text-sm font-medium text-gray-400 mb-3">{t('onboard.features.tool_mode')}</label>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <button
                    type="button"
                    onClick={() => setToolMode('sovereign')}
                    className={`p-5 rounded-xl text-left transition-all border relative overflow-hidden group ${
                      toolMode === 'sovereign'
                        ? 'bg-blue-900/20 border-blue-500/50 ring-1 ring-blue-500/50'
                        : 'bg-gray-900/40 border-gray-800/60 hover:border-gray-600 hover:bg-gray-800/60'
                    }`}
                  >
                    <div className="relative z-10">
                      <div className="font-semibold text-lg text-white mb-2 group-hover:text-blue-400 transition-colors">{t('onboard.features.sovereign')}</div>
                      <div className="text-sm text-gray-500 group-hover:text-gray-400 transition-colors">{t('onboard.features.sovereign.desc')}</div>
                    </div>
                  </button>
                  <button
                    type="button"
                    onClick={() => setToolMode('composio')}
                    className={`p-5 rounded-xl text-left transition-all border relative overflow-hidden group ${
                      toolMode === 'composio'
                        ? 'bg-blue-900/20 border-blue-500/50 ring-1 ring-blue-500/50'
                        : 'bg-gray-900/40 border-gray-800/60 hover:border-gray-600 hover:bg-gray-800/60'
                    }`}
                  >
                     <div className="relative z-10">
                      <div className="font-semibold text-lg text-white mb-2 group-hover:text-blue-400 transition-colors">{t('onboard.features.composio')}</div>
                      <div className="text-sm text-gray-500 group-hover:text-gray-400 transition-colors">{t('onboard.features.composio.desc')}</div>
                    </div>
                  </button>
                </div>
                {toolMode === 'composio' && (
                  <div className="mt-4 animate-in fade-in slide-in-from-top-2">
                    <input
                      type="password"
                      value={composioApiKey}
                      onChange={(e) => setComposioApiKey(e.target.value)}
                      placeholder={t('onboard.provider.api_key')}
                      className="w-full bg-black/50 border border-gray-800 rounded-xl p-3.5 text-white focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500/50 transition-all outline-none"
                      required
                    />
                  </div>
                )}
              </div>

              {/* Autonomy Level */}
              <div>
                <label className="block text-sm font-medium text-gray-400 mb-3">{t('onboard.features.autonomy')}</label>
                <div className="grid grid-cols-1 gap-3">
                  {[
                    { id: 'read_only', label: t('onboard.features.read_only'), desc: t('onboard.features.read_only.desc') },
                    { id: 'supervised', label: t('onboard.features.supervised'), desc: t('onboard.features.supervised.desc') },
                    { id: 'full', label: t('onboard.features.full'), desc: t('onboard.features.full.desc') },
                  ].map((level) => (
                    <button
                      key={level.id}
                      type="button"
                      onClick={() => setAutonomyLevel(level.id as any)}
                      className={`flex items-center justify-between p-4 border rounded-xl transition-all text-left group ${
                        autonomyLevel === level.id
                          ? 'bg-blue-900/20 border-blue-500/50 ring-1 ring-blue-500/50'
                          : 'bg-gray-900/40 border-gray-800/60 hover:border-gray-600 hover:bg-gray-800/60'
                      }`}
                    >
                      <div>
                        <span className={`block font-medium text-lg mb-1 transition-colors ${autonomyLevel === level.id ? 'text-blue-400' : 'text-gray-200 group-hover:text-white'}`}>
                          {level.label}
                        </span>
                        <span className="text-sm text-gray-500 group-hover:text-gray-400 transition-colors">{level.desc}</span>
                      </div>
                      {autonomyLevel === level.id && (
                        <CheckCircle className="h-5 w-5 text-blue-400" />
                      )}
                    </button>
                  ))}
                </div>
              </div>

              {/* Security & Network */}
              <div className="space-y-4">
                <label className="block text-sm font-medium text-gray-400">{t('onboard.features.security')}</label>

                <div className="p-5 bg-gray-900/40 border border-gray-800/60 rounded-xl hover:border-gray-700 transition-colors">
                  <label className="flex items-center justify-between cursor-pointer group">
                    <div>
                      <div className="font-medium text-white group-hover:text-blue-400 transition-colors">{t('onboard.features.encrypt')}</div>
                      <div className="text-sm text-gray-500 mt-1">{t('onboard.features.encrypt.desc')}</div>
                    </div>
                    <div className="relative">
                      <input
                        type="checkbox"
                        checked={encryptSecrets}
                        onChange={(e) => setEncryptSecrets(e.target.checked)}
                        className="sr-only peer"
                      />
                      <div className="w-11 h-6 bg-gray-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
                    </div>
                  </label>
                </div>

                <div className="p-5 bg-gray-900/40 border border-gray-800/60 rounded-xl hover:border-gray-700 transition-colors">
                  <label className="flex items-center justify-between cursor-pointer group">
                    <div>
                      <div className="font-medium text-white group-hover:text-blue-400 transition-colors">{t('onboard.features.tunnel')}</div>
                      <div className="text-sm text-gray-500 mt-1">{t('onboard.features.tunnel.desc')}</div>
                    </div>
                    <div className="relative">
                      <input
                        type="checkbox"
                        checked={enableTunnel}
                        onChange={(e) => setEnableTunnel(e.target.checked)}
                        className="sr-only peer"
                      />
                      <div className="w-11 h-6 bg-gray-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
                    </div>
                  </label>
                </div>

                {enableTunnel && (
                  <div className="mt-4 space-y-4 p-6 bg-gray-900/40 rounded-xl border border-gray-800/60 animate-in fade-in slide-in-from-top-2">
                    <div>
                      <label className="block text-sm font-medium text-gray-400 mb-3">{t('onboard.features.tunnel_provider')}</label>
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                        {[
                          { id: 'cloudflare', label: 'Cloudflare' },
                          { id: 'ngrok', label: 'Ngrok' },
                          { id: 'tailscale', label: 'Tailscale' },
                          { id: 'custom', label: 'Custom' },
                        ].map((p) => (
                          <button
                            key={p.id}
                            type="button"
                            onClick={() => setTunnelProvider(p.id as any)}
                            className={`p-3 text-sm rounded-lg border transition-all font-medium ${
                              tunnelProvider === p.id
                                ? 'bg-blue-600 border-blue-500 text-white shadow-lg shadow-blue-900/20'
                                : 'bg-black/30 border-gray-800 text-gray-400 hover:text-gray-200 hover:bg-gray-800'
                            }`}
                          >
                            {p.label}
                          </button>
                        ))}
                      </div>
                    </div>

                    {tunnelProvider === 'cloudflare' && (
                      <div className="animate-in fade-in slide-in-from-top-2">
                        <input
                          type="password"
                          value={tunnelToken}
                          onChange={(e) => setTunnelToken(e.target.value)}
                          placeholder={t('onboard.features.tunnel_token')}
                          className="w-full bg-black/50 border border-gray-800 rounded-xl p-3.5 text-white focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500/50 transition-all outline-none"
                        />
                      </div>
                    )}

                    {tunnelProvider === 'ngrok' && (
                      <div className="space-y-4 animate-in fade-in slide-in-from-top-2">
                        <input
                          type="password"
                          value={tunnelNgrokAuthToken}
                          onChange={(e) => setTunnelNgrokAuthToken(e.target.value)}
                          placeholder={t('onboard.features.ngrok_token')}
                          className="w-full bg-black/50 border border-gray-800 rounded-xl p-3.5 text-white focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500/50 transition-all outline-none"
                        />
                        <input
                          type="text"
                          value={tunnelNgrokDomain}
                          onChange={(e) => setTunnelNgrokDomain(e.target.value)}
                          placeholder={t('onboard.features.ngrok_domain')}
                          className="w-full bg-black/50 border border-gray-800 rounded-xl p-3.5 text-white focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500/50 transition-all outline-none"
                        />
                      </div>
                    )}

                    {tunnelProvider === 'tailscale' && (
                      <div className="p-4 bg-black/30 rounded-lg border border-gray-800 animate-in fade-in slide-in-from-top-2">
                        <label className="flex items-center gap-3 cursor-pointer group">
                          <div className="relative">
                            <input
                              type="checkbox"
                              checked={tunnelTailscaleFunnel}
                              onChange={(e) => setTunnelTailscaleFunnel(e.target.checked)}
                              className="sr-only peer"
                            />
                            <div className="w-9 h-5 bg-gray-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-blue-600"></div>
                          </div>
                          <span className="text-sm text-gray-300 group-hover:text-white transition-colors">{t('onboard.features.tailscale_funnel')}</span>
                        </label>
                      </div>
                    )}

                    {tunnelProvider === 'custom' && (
                      <div className="animate-in fade-in slide-in-from-top-2">
                        <input
                          type="text"
                          value={tunnelCustomCommand}
                          onChange={(e) => setTunnelCustomCommand(e.target.value)}
                          placeholder={t('onboard.features.custom_command')}
                          className="w-full bg-black/50 border border-gray-800 rounded-xl p-3.5 text-white focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500/50 transition-all outline-none font-mono text-sm"
                        />
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>

            <button
              type="submit"
              className="w-full bg-blue-600 hover:bg-blue-500 text-white font-semibold py-4 rounded-xl transition-all transform hover:scale-[1.01] active:scale-[0.99] shadow-lg shadow-blue-500/20 flex items-center justify-center gap-2 group"
            >
              <span className="text-lg">{t('onboard.continue')}</span>
              <ChevronRight className="h-5 w-5 group-hover:translate-x-1 transition-transform" />
            </button>
          </form>
        )}

        {step === 'hardware' && (
          <form onSubmit={handleHardwareSubmit} className="space-y-8 animate-in fade-in slide-in-from-bottom-8 duration-500 fill-mode-backwards">
            <div className="text-center mb-10">
              <h2 className="text-2xl font-semibold text-white mb-2">{t('onboard.hardware.title')}</h2>
              <p className="text-gray-400">{t('onboard.hardware.subtitle', { defaultValue: 'Configure hardware interface' })}</p>
            </div>

            <div className="space-y-12">
              <div className="group">
                <label className="flex items-center justify-between cursor-pointer">
                  <div className="space-y-1">
                    <div className="font-medium text-white flex items-center gap-3 text-lg">
                      <div className="p-2 rounded-lg bg-blue-500/10 text-blue-400 group-hover:bg-blue-500/20 transition-colors border border-blue-500/20">
                        <Cpu className="h-6 w-6" />
                      </div>
                      {t('onboard.hardware.enable')}
                    </div>
                    <div className="text-sm text-gray-400 pl-[3.25rem]">
                      {t('onboard.hardware.enable.desc')}
                    </div>
                  </div>
                  <div className="relative">
                    <input
                      type="checkbox"
                      checked={hardwareEnabled}
                      onChange={(e) => setHardwareEnabled(e.target.checked)}
                      className="sr-only peer"
                    />
                    <div className="w-14 h-7 bg-gray-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-0.5 after:left-[4px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-6 after:w-6 after:transition-all peer-checked:bg-blue-600"></div>
                  </div>
                </label>
              </div>

              {hardwareEnabled && (
                <div className="space-y-12 animate-in fade-in slide-in-from-top-4 duration-500 pl-0 md:pl-[3.25rem]">
                  <div className="space-y-6">
                    <label className="block text-sm font-medium text-gray-400 uppercase tracking-wider border-l-2 border-blue-500/50 pl-3">{t('onboard.hardware.transport')}</label>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      {[
                        { id: 'native', label: t('onboard.hardware.native'), desc: t('onboard.hardware.native.desc') },
                        { id: 'serial', label: t('onboard.hardware.serial'), desc: t('onboard.hardware.serial.desc') },
                        { id: 'probe', label: t('onboard.hardware.probe'), desc: t('onboard.hardware.probe.desc') },
                      ].map((mode) => (
                        <button
                          key={mode.id}
                          type="button"
                          onClick={() => setHardwareTransport(mode.id as any)}
                          className={`group relative p-4 rounded-xl text-left transition-all duration-300 overflow-hidden ${
                            hardwareTransport === mode.id
                              ? 'bg-blue-600/20 ring-2 ring-blue-500 shadow-lg shadow-blue-500/20'
                              : 'bg-white/5 hover:bg-white/10 border border-white/10 hover:border-white/20'
                          }`}
                        >
                          {hardwareTransport === mode.id && (
                            <div className="absolute inset-0 bg-linear-to-br from-blue-600/10 to-transparent pointer-events-none" />
                          )}
                          <div className={`font-medium text-lg mb-1 relative z-10 ${hardwareTransport === mode.id ? 'text-blue-400' : 'text-gray-200 group-hover:text-white'}`}>
                            {mode.label}
                          </div>
                          <div className="text-sm text-gray-500 group-hover:text-gray-400 relative z-10">{mode.desc}</div>
                        </button>
                      ))}
                    </div>
                  </div>

                  {hardwareTransport === 'serial' && (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6 animate-in fade-in slide-in-from-top-2">
                      <div className="space-y-2">
                        <label className="block text-sm font-medium text-gray-400">{t('onboard.hardware.port')}</label>
                        <input
                          type="text"
                          value={serialPort}
                          onChange={(e) => setSerialPort(e.target.value)}
                          className="w-full bg-black/50 border border-white/10 rounded-xl p-4 text-white focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500/50 transition-all outline-none placeholder-gray-700"
                          placeholder="/dev/ttyUSB0"
                        />
                      </div>
                      <div className="space-y-2">
                        <label className="block text-sm font-medium text-gray-400">{t('onboard.hardware.baud')}</label>
                        <input
                          type="number"
                          value={baudRate}
                          onChange={(e) => setBaudRate(parseInt(e.target.value))}
                          className="w-full bg-black/50 border border-white/10 rounded-xl p-4 text-white focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500/50 transition-all outline-none placeholder-gray-700"
                          placeholder="115200"
                        />
                      </div>
                    </div>
                  )}

                  {hardwareTransport === 'probe' && (
                    <div className="space-y-2 animate-in fade-in slide-in-from-top-2">
                      <label className="block text-sm font-medium text-gray-400">{t('onboard.hardware.target')}</label>
                      <input
                        type="text"
                        value={probeTarget}
                        onChange={(e) => setProbeTarget(e.target.value)}
                        className="w-full bg-black/50 border border-white/10 rounded-xl p-4 text-white focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500/50 transition-all outline-none placeholder-gray-700"
                        placeholder="e.g. STM32F401RE"
                      />
                    </div>
                  )}

                  <label className="flex items-center gap-4 cursor-pointer group">
                    <div className="relative">
                      <input
                        type="checkbox"
                        checked={workspaceDatasheets}
                        onChange={(e) => setWorkspaceDatasheets(e.target.checked)}
                        className="sr-only peer"
                      />
                      <div className="w-11 h-6 bg-gray-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
                    </div>
                    <div>
                      <div className="font-medium text-gray-200 group-hover:text-white transition-colors">{t('onboard.hardware.datasheets')}</div>
                      <div className="text-sm text-gray-500 group-hover:text-gray-400 transition-colors">
                        {t('onboard.hardware.datasheets.desc')}
                      </div>
                    </div>
                  </label>
                </div>
              )}
            </div>

            <button
              type="submit"
              className="w-full bg-gradient-to-r from-blue-600 to-blue-500 hover:from-blue-500 hover:to-blue-400 text-white font-semibold py-4 rounded-xl transition-all transform hover:scale-[1.01] active:scale-[0.99] shadow-lg shadow-blue-500/20 flex items-center justify-center gap-2 group mt-8"
            >
              <span className="text-lg">{t('onboard.continue')}</span>
              <ChevronRight className="h-5 w-5 group-hover:translate-x-1 transition-transform" />
            </button>
          </form>
        )}

        {step === 'channels' && (
          <form onSubmit={handleChannelsSubmit} className="space-y-8 animate-in fade-in slide-in-from-bottom-8 duration-500 fill-mode-backwards">
            <div className="text-center mb-10">
              <h2 className="text-2xl font-semibold text-white mb-2">{t('onboard.channels.title')}</h2>
              <p className="text-gray-400">{t('onboard.channels.subtitle')}</p>
              <p className="text-gray-500 text-sm mt-2">{t('onboard.channels.more_all')}</p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {CHANNEL_DEFS.map((channel) => {
                const checked = selectedChannels.includes(channel.id);
                return (
                  <button
                    key={channel.id}
                    type="button"
                    onClick={() => {
                      setSelectedChannels((prev) => prev.includes(channel.id) ? prev.filter((id) => id !== channel.id) : [...prev, channel.id]);
                    }}
                    className={`text-left rounded-xl border p-4 transition-all ${checked ? 'bg-blue-600/15 border-blue-500/50 shadow-lg shadow-blue-500/10' : 'bg-gray-900/40 border-gray-800/60 hover:border-gray-700'}`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <h3 className="font-medium text-white">{channel.label}</h3>
                        <p className="text-xs text-gray-400 mt-1">{channel.description}</p>
                      </div>
                      <div className={`mt-1 w-5 h-5 rounded-full border ${checked ? 'bg-blue-500 border-blue-400' : 'border-gray-600'}`} />
                    </div>
                  </button>
                );
              })}
            </div>

            {selectedChannels.length > 0 && (
              <div className="space-y-5">
                {selectedChannels.map((channelId) => (
                  <div key={channelId} className="bg-gray-900/40 border border-gray-800/60 rounded-2xl p-5">
                    <div className="mb-3 flex items-center justify-between gap-3">
                      <h3 className="text-white font-medium">{CHANNEL_LABEL_MAP[channelId]}</h3>
                      <div className="inline-flex rounded-lg border border-gray-700/70 p-1 bg-black/30">
                        <button
                          type="button"
                          onClick={() => setChannelEditMode((prev) => ({ ...prev, [channelId]: 'form' }))}
                          className={`px-3 py-1 text-xs rounded-md transition-colors ${channelEditMode[channelId] !== 'json' ? 'bg-blue-600 text-white' : 'text-gray-300 hover:text-white'}`}
                        >
                          {t('onboard.channels.form_mode')}
                        </button>
                        <button
                          type="button"
                          onClick={() => setChannelEditMode((prev) => ({ ...prev, [channelId]: 'json' }))}
                          className={`px-3 py-1 text-xs rounded-md transition-colors ${channelEditMode[channelId] === 'json' ? 'bg-blue-600 text-white' : 'text-gray-300 hover:text-white'}`}
                        >
                          {t('onboard.channels.config_json')}
                        </button>
                      </div>
                    </div>
                    {channelEditMode[channelId] !== 'json' && parseChannelConfig(channelId) ? (
                      <div className="space-y-3">
                        {Object.entries(parseChannelConfig(channelId) as Record<string, unknown>).map(([field, value]) => (
                          <div key={field} className="grid grid-cols-1 md:grid-cols-3 gap-3 items-center">
                            <label className="text-sm text-gray-300">{field}</label>
                            {typeof value === 'boolean' ? (
                              <label className="md:col-span-2 inline-flex items-center gap-3 cursor-pointer">
                                <input
                                  type="checkbox"
                                  checked={value}
                                  onChange={(e) => updateChannelField(channelId, field, value, e.target.checked)}
                                  className="h-4 w-4 rounded border-gray-600 bg-black/40"
                                />
                                <span className="text-sm text-gray-400">{value ? 'true' : 'false'}</span>
                              </label>
                            ) : (
                              <input
                                type={typeof value === 'number' ? 'number' : 'text'}
                                value={Array.isArray(value) ? value.join(', ') : (value ?? '').toString()}
                                onChange={(e) => updateChannelField(channelId, field, value, e.target.value)}
                                className="md:col-span-2 w-full bg-black/50 border border-white/10 rounded-xl p-3 text-sm text-gray-100 focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500/50 transition-all outline-none"
                              />
                            )}
                          </div>
                        ))}
                      </div>
                    ) : (
                      <textarea
                        value={channelConfigs[channelId] || '{}'}
                        onChange={(e) => setChannelConfigs((prev) => ({ ...prev, [channelId]: e.target.value }))}
                        className="w-full min-h-44 bg-black/50 border border-white/10 rounded-xl p-4 text-sm text-gray-100 font-mono focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500/50 transition-all outline-none"
                      />
                    )}
                  </div>
                ))}
              </div>
            )}

            {selectedChannels.length === 0 && (
              <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
                {t('onboard.channels.none_selected')}
              </div>
            )}

            <button
              type="submit"
              className="w-full bg-gradient-to-r from-blue-600 to-blue-500 hover:from-blue-500 hover:to-blue-400 text-white font-semibold py-4 rounded-xl transition-all transform hover:scale-[1.01] active:scale-[0.99] shadow-lg shadow-blue-500/20 flex items-center justify-center gap-2 group mt-8"
            >
              <span className="text-lg">{t('onboard.continue')}</span>
              <ChevronRight className="h-5 w-5 group-hover:translate-x-1 transition-transform" />
            </button>
          </form>
        )}

        {step === 'config' && (
          <form onSubmit={handleSubmit} className="space-y-8 animate-in fade-in slide-in-from-bottom-8 duration-500 fill-mode-backwards">
            <div className="text-center mb-10">
              <h2 className="text-2xl font-semibold text-white mb-2">{t('onboard.config.title', { provider: t(`onboard.provider.${selectedProvider.id}`) })}</h2>
              <p className="text-gray-400">{t('onboard.config.subtitle', { defaultValue: 'Review your configuration' })}</p>
            </div>

            {/* Summary Review */}
            <div className="mb-12">
              <h3 className="text-sm font-semibold text-gray-400 mb-6 uppercase tracking-wider border-l-2 border-blue-500/50 pl-3">{t('onboard.config.summary')}</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-x-12 gap-y-8 pl-3">
                <div className="space-y-1">
                  <span className="block text-gray-500 text-xs uppercase tracking-wider">{t('onboard.config.identity')}</span>
                  <div className="flex items-center gap-2">
                    <span className="text-white font-medium text-lg truncate" title={`${agentName} (${userName})`}>{agentName}</span>
                    <span className="text-gray-500 text-sm">({userName})</span>
                  </div>
                  <span className="text-blue-400 text-sm truncate block">{timezone}</span>
                </div>
                <div className="space-y-1">
                  <span className="block text-gray-500 text-xs uppercase tracking-wider">{t('onboard.config.memory')}</span>
                  <div className="flex items-center gap-2">
                    <span className="text-white font-medium text-lg">{t(`onboard.memory.${memoryBackend}`)}</span>
                    <span className={`text-xs px-2 py-0.5 rounded-full ${memoryAutoSave ? 'bg-green-500/10 text-green-400 border border-green-500/20' : 'bg-yellow-500/10 text-yellow-400 border border-yellow-500/20'}`}>
                      {memoryAutoSave ? t('onboard.config.autosave') : t('onboard.config.manual')}
                    </span>
                  </div>
                  {memoryBackend === 'postgres' && <span className="block text-gray-400 text-sm truncate font-mono" title={memoryPostgresUrl}>{memoryPostgresUrl}</span>}
                  {memoryBackend === 'qdrant' && <span className="block text-gray-400 text-sm truncate font-mono" title={memoryQdrantUrl}>{memoryQdrantUrl}</span>}
                </div>
                <div className="space-y-1">
                  <span className="block text-gray-500 text-xs uppercase tracking-wider">{t('onboard.config.features')}</span>
                  <div className="text-white font-medium text-lg">{toolMode === 'composio' ? t('onboard.config.composio') : t('onboard.config.sovereign')}</div>
                  <span className="text-gray-400 text-sm">{t(`onboard.features.${autonomyLevel}`)}</span>
                </div>
                <div className="space-y-1">
                  <span className="block text-gray-500 text-xs uppercase tracking-wider">{t('onboard.config.channels')}</span>
                  <div className="text-white font-medium text-lg">
                    {selectedChannels.map((channelId) => CHANNEL_LABEL_MAP[channelId]).join(', ') || t('onboard.config.none')}
                  </div>
                </div>
              </div>
            </div>

            <div className="space-y-6">
              {/* Configuration Summary Only */}
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-gradient-to-r from-blue-600 to-blue-500 hover:from-blue-500 hover:to-blue-400 text-white font-semibold py-4 rounded-xl transition-all transform hover:scale-[1.01] active:scale-[0.99] shadow-lg shadow-blue-500/20 flex items-center justify-center gap-2 group mt-8 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? (
                <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              ) : (
                <>
                  <span className="text-lg">{t('onboard.config.submit')}</span>
                  <CheckCircle className="h-5 w-5 group-hover:scale-110 transition-transform" />
                </>
              )}
            </button>
          </form>
        )}
      </div>
    </div>
  </div>
</div>
  );
}
