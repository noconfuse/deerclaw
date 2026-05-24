import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  Settings,
  Save,
  AlertTriangle,
  ShieldAlert,
  HelpCircle,
  ChevronDown,
  Plus,
  Trash2,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {
  getConfig,
  getConfigForm,
  putConfig,
  putConfigForm,
} from '@/lib/api';
import { CHANNEL_DEFS, CHANNEL_LABEL_MAP } from '@/lib/channels';
import { useNotify } from '@/hooks/useNotify';

type ConfigForm = Record<string, unknown>;
type ConfigTab =
  | 'general'
  | 'channels'
  | 'agent'
  | 'gateway'
  | 'runtime'
  | 'memory'
  | 'web_search'
  | 'cost';

const CONFIG_TABS = [
  'gateway',
  'runtime',
  'memory',
  'web_search',
  'cost',
] as const;

const PROVIDER_OPTIONS = [
  { id: 'openrouter', label: 'OpenRouter (Recommended)' },
  { id: 'venice', label: 'Venice AI' },
  { id: 'anthropic', label: 'Anthropic' },
  { id: 'openai', label: 'OpenAI' },
  { id: 'openai-codex', label: 'OpenAI Codex' },
  { id: 'deepseek', label: 'DeepSeek' },
  { id: 'mistral', label: 'Mistral' },
  { id: 'xai', label: 'xAI' },
  { id: 'perplexity', label: 'Perplexity' },
  { id: 'gemini', label: 'Google Gemini' },
  { id: 'groq', label: 'Groq' },
  { id: 'fireworks', label: 'Fireworks AI' },
  { id: 'novita', label: 'Novita AI' },
  { id: 'together-ai', label: 'Together AI' },
  { id: 'nvidia', label: 'NVIDIA NIM' },
  { id: 'vercel', label: 'Vercel AI Gateway' },
  { id: 'cloudflare', label: 'Cloudflare AI Gateway' },
  { id: 'astrai', label: 'Astrai' },
  { id: 'bedrock', label: 'Amazon Bedrock' },
  { id: 'kimi-code', label: 'Kimi Code' },
  { id: 'qwen-code', label: 'Qwen Code' },
  { id: 'moonshot', label: 'Moonshot' },
  { id: 'moonshot-intl', label: 'Moonshot Intl' },
  { id: 'glm', label: 'GLM / Zhipu' },
  { id: 'glm-cn', label: 'GLM / Zhipu (CN)' },
  { id: 'minimax', label: 'MiniMax' },
  { id: 'minimax-cn', label: 'MiniMax (CN)' },
  { id: 'qwen', label: 'Qwen' },
  { id: 'qwen-intl', label: 'Qwen Intl' },
  { id: 'qianfan', label: 'Qianfan' },
  { id: 'zai', label: 'Z.AI' },
  { id: 'zai-cn', label: 'Z.AI (CN)' },
  { id: 'synthetic', label: 'Synthetic' },
  { id: 'opencode', label: 'OpenCode Zen' },
  { id: 'cohere', label: 'Cohere' },
  { id: 'ollama', label: 'Ollama' },
  { id: 'llamacpp', label: 'llama.cpp Server' },
  { id: 'vllm', label: 'vLLM' },
  { id: 'sglang', label: 'SGLang' },
  { id: 'custom', label: 'Custom Provider' },
];

const normalizeProviderValue = (provider: string, apiUrl: string) => {
  const trimmedProvider = provider.trim();
  if (trimmedProvider !== 'custom') {
    return trimmedProvider || undefined;
  }

  const normalizedUrl = apiUrl.trim().replace(/\/+$/, '');
  if (!normalizedUrl) {
    throw new Error('Custom Provider requires an API Base URL');
  }

  return `custom:${normalizedUrl}`;
};

const getProviderUiCopy = (isCustomProvider: boolean) => ({
  providerHelpKey: isCustomProvider
    ? 'config.form.provider_help_custom'
    : 'config.form.provider_help_default',
  apiUrlLabelKey: isCustomProvider
    ? 'config.form.api_url_label_custom'
    : 'config.form.api_url_label',
  apiUrlPlaceholderKey: isCustomProvider
    ? 'config.form.api_url_placeholder_custom'
    : 'config.form.api_url_placeholder',
  apiUrlHelpKey: isCustomProvider
    ? 'config.form.api_url_help_custom'
    : 'config.form.api_url_help_default',
});

export default function Config() {
  const { t } = useTranslation();
  const notify = useNotify();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [viewMode, setViewMode] = useState<'form' | 'toml'>('form');
  const [activeTab, setActiveTab] = useState<ConfigTab>('gateway');
  const [config, setConfig] = useState<ConfigForm | null>(null);
  const [toml, setToml] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [openHelp, setOpenHelp] = useState<string | null>(null);
  const [allowedCommandsText, setAllowedCommandsText] = useState('');
  const [blockedCommandsText, setBlockedCommandsText] = useState('');
  const [proxyNoProxyText, setProxyNoProxyText] = useState('');
  const [proxyServicesText, setProxyServicesText] = useState('');
  const [channelToAdd, setChannelToAdd] = useState(CHANNEL_DEFS[0]?.id ?? '');
  const [channelEditMode, setChannelEditMode] = useState<Record<string, 'form' | 'json'>>({});
  const [channelDrafts, setChannelDrafts] = useState<Record<string, string>>({});

  useEffect(() => {
    const requestedTab = searchParams.get('tab');
    if (requestedTab === 'channels') {
      navigate('/channels', { replace: true });
      return;
    }
    if (requestedTab === 'general' || requestedTab === 'agent') {
      navigate('/deerclaw-settings', { replace: true });
      return;
    }
    if (CONFIG_TABS.includes(requestedTab as (typeof CONFIG_TABS)[number])) {
      setActiveTab(requestedTab as ConfigTab);
    }
  }, [navigate, searchParams]);

  const selectTab = (tab: ConfigTab) => {
    setActiveTab(tab);
    const nextParams = new URLSearchParams(searchParams);
    nextParams.set('tab', tab);
    setSearchParams(nextParams, { replace: true });
  };

  useEffect(() => {
    const load = async () => {
      try {
        const [formData, tomlData] = await Promise.all([
          getConfigForm<ConfigForm>(),
          getConfig(),
        ]);
        setConfig(formData);
        setToml(tomlData);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : t('config.error');
        setError(message);
        notify.error(message, { key: 'config:load' });
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      if (viewMode === 'toml') {
        if (!toml) {
          throw new Error(t('config.error'));
        }
        await putConfig(toml);
        const refreshed = await getConfigForm<ConfigForm>();
        setConfig(refreshed);
      } else {
        if (!config) {
          throw new Error(t('config.error'));
        }
        const nextConfig = structuredClone(config) as ConfigForm;
        const setPathValue = (path: string[], value: unknown) => {
          let cursor: Record<string, unknown> = nextConfig;
          for (let i = 0; i < path.length - 1; i += 1) {
            const key = path[i] as string;
            if (typeof cursor[key] !== 'object' || cursor[key] === null) {
              cursor[key] = {};
            }
            cursor = cursor[key] as Record<string, unknown>;
          }
          const lastKey = path[path.length - 1] as string;
          cursor[lastKey] = value;
        };
        setPathValue(['autonomy', 'allowed_commands'], parseList(allowedCommandsText));
        setPathValue(['autonomy', 'blocked_commands'], parseList(blockedCommandsText));
        setPathValue(['proxy', 'no_proxy'], parseList(proxyNoProxyText));
        setPathValue(['proxy', 'services'], parseList(proxyServicesText));
        const channelsConfig =
          ((nextConfig.channels_config as Record<string, unknown> | undefined) ?? {}) as Record<
            string,
            unknown
          >;
        for (const channelId of Object.keys(channelDrafts)) {
          if (channelsConfig[channelId] === undefined || channelsConfig[channelId] === null) {
            continue;
          }
          try {
            const parsed = JSON.parse(channelDrafts[channelId] || '{}');
            if (parsed === null || Array.isArray(parsed) || typeof parsed !== 'object') {
              throw new Error('invalid json object');
            }
            channelsConfig[channelId] = parsed as Record<string, unknown>;
          } catch {
            throw new Error(
              t('config.channels.invalid_json', {
                channel: CHANNEL_LABEL_MAP[channelId] ?? channelId,
              }),
            );
          }
        }
        nextConfig.channels_config = channelsConfig;
        setPathValue(
          ['default_provider'],
          normalizeProviderValue(
            ((nextConfig.default_provider as string | undefined) ?? ''),
            ((nextConfig.api_url as string | undefined) ?? ''),
          ),
        );
        await putConfigForm(nextConfig);
        setConfig(nextConfig);
        const refreshed = await getConfig();
        setToml(refreshed);
      }
      const message = t('config.saved');
      notify.success(message, { key: 'config:save:success' });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : t('config.error');
      setError(message);
      notify.error(message, { key: 'config:save:error' });
    } finally {
      setSaving(false);
    }
  };

  const formatList = (value: unknown) => (Array.isArray(value) ? value.join('\n') : '');
  const parseList = (raw: string) =>
    raw
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);
  const model = ((config as ConfigForm | null)?.default_model as string | undefined) ?? '';
  const normalizedModelKey = model.trim().toLowerCase();
  const modelContextWindows =
    ((((config as ConfigForm | null)?.agent as Record<string, unknown> | undefined)
      ?.model_context_windows as
      | Record<string, unknown>
      | undefined)) ?? {};
  const defaultModelContextWindowTokens = normalizedModelKey
    ? ((modelContextWindows[normalizedModelKey] as Record<string, unknown> | undefined)
        ?.context_window_tokens as number | undefined) ?? 0
    : 0;
  const modelContextWindowTtlSecs =
    ((((config as ConfigForm | null)?.agent as Record<string, unknown> | undefined)
      ?.model_context_window_ttl_secs as
      | number
      | undefined)) ?? 604800;

  useEffect(() => {
    if (!config) return;
    setAllowedCommandsText(
      formatList((config.autonomy as Record<string, unknown> | undefined)?.allowed_commands),
    );
    setBlockedCommandsText(
      formatList((config.autonomy as Record<string, unknown> | undefined)?.blocked_commands),
    );
    setProxyNoProxyText(
      formatList((config.proxy as Record<string, unknown> | undefined)?.no_proxy),
    );
    setProxyServicesText(
      formatList((config.proxy as Record<string, unknown> | undefined)?.services),
    );
    const channelsConfig =
      ((config.channels_config as Record<string, unknown> | undefined) ?? {}) as Record<
        string,
        unknown
      >;
    setChannelDrafts(
      Object.fromEntries(
        CHANNEL_DEFS.filter((channel) => channelsConfig[channel.id] !== undefined && channelsConfig[channel.id] !== null)
          .map((channel) => [
            channel.id,
            JSON.stringify(channelsConfig[channel.id], null, 2),
          ]),
      ) as Record<string, string>,
    );
    const firstAvailableChannel = CHANNEL_DEFS.find(
      (channel) => channelsConfig[channel.id] === undefined || channelsConfig[channel.id] === null,
    );
    setChannelToAdd(firstAvailableChannel?.id ?? '');
  }, [config]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-2 border-blue-500 border-t-transparent" />
      </div>
    );
  }

  if (!config) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-sm text-gray-400">{t('config.error')}</div>
      </div>
    );
  }

  const updateConfig = (path: string[], value: unknown) => {
    setConfig((prev) => {
      if (!prev) return prev;
      if (path.length === 0) return prev;
      const next = structuredClone(prev) as ConfigForm;
      let cursor: Record<string, unknown> = next;
      for (let i = 0; i < path.length - 1; i += 1) {
        const key = path[i] as string;
        if (typeof cursor[key] !== 'object' || cursor[key] === null) {
          cursor[key] = {};
        }
        cursor = cursor[key] as Record<string, unknown>;
      }
      const lastKey = path[path.length - 1] as string;
      cursor[lastKey] = value;
      return next;
    });
  };

  const channelsConfig =
    ((config.channels_config as Record<string, unknown> | undefined) ?? {}) as Record<
      string,
      unknown
    >;
  const configuredChannelIds = CHANNEL_DEFS
    .map((channel) => channel.id)
    .filter((channelId) => channelsConfig[channelId] !== undefined && channelsConfig[channelId] !== null);
  const availableChannels = CHANNEL_DEFS.filter(
    (channel) => !configuredChannelIds.includes(channel.id),
  );

  const updateChannelsConfig = (updater: (channels: Record<string, unknown>) => void) => {
    setConfig((prev) => {
      if (!prev) return prev;
      const next = structuredClone(prev) as ConfigForm;
      const nextChannels =
        ((next.channels_config as Record<string, unknown> | undefined) ?? {}) as Record<
          string,
          unknown
        >;
      updater(nextChannels);
      next.channels_config = nextChannels;
      return next;
    });
  };

  const parseChannelConfig = (channelId: string): Record<string, unknown> | null => {
    const raw = channelDrafts[channelId] ?? JSON.stringify(channelsConfig[channelId] ?? {}, null, 2);
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
      return null;
    } catch {
      return null;
    }
  };

  const syncChannelDraft = (channelId: string, value: Record<string, unknown>) => {
    setChannelDrafts((prev) => ({
      ...prev,
      [channelId]: JSON.stringify(value, null, 2),
    }));
  };

  const addChannel = () => {
    const channel = availableChannels.find((item) => item.id === channelToAdd) ?? availableChannels[0];
    if (!channel) return;
    const nextValue = structuredClone(channel.template) as Record<string, unknown>;
    updateChannelsConfig((nextChannels) => {
      nextChannels[channel.id] = nextValue;
    });
    syncChannelDraft(channel.id, nextValue);
    setChannelEditMode((prev) => ({ ...prev, [channel.id]: 'form' }));
    const nextAvailable = availableChannels.find((item) => item.id !== channel.id);
    setChannelToAdd(nextAvailable?.id ?? '');
  };

  const removeChannel = (channelId: string) => {
    updateChannelsConfig((nextChannels) => {
      delete nextChannels[channelId];
    });
    setChannelDrafts((prev) => {
      const next = { ...prev };
      delete next[channelId];
      return next;
    });
    setChannelEditMode((prev) => {
      const next = { ...prev };
      delete next[channelId];
      return next;
    });
  };

  const updateChannelField = (
    channelId: string,
    field: string,
    currentValue: unknown,
    rawValue: string | boolean,
  ) => {
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
    updateChannelsConfig((nextChannels) => {
      nextChannels[channelId] = next;
    });
    syncChannelDraft(channelId, next);
  };

  const toggleHelp = (key: string) => {
    setOpenHelp((prev) => (prev === key ? null : key));
  };

  const selectClassName =
    'mt-2 w-full appearance-none rounded-lg bg-gray-950 border border-gray-800 px-3 py-2 pr-9 text-sm text-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500 cursor-pointer';
  const renderSwitch = (checked: boolean) => (
    <span
      className={`relative inline-block h-5 w-10 rounded-full transition-colors ${
        checked ? 'bg-blue-600' : 'bg-gray-700'
      }`}
    >
      <span
        className={`absolute left-1 top-1 h-3 w-3 rounded-full bg-white transition-transform ${
          checked ? 'translate-x-5' : ''
        }`}
      />
    </span>
  );

  const rawProvider = (config.default_provider as string | undefined) ?? '';
  const apiKey = (config.api_key as string | undefined) ?? '';
  const isCustomProvider = rawProvider.startsWith('custom:');
  const provider = isCustomProvider ? 'custom' : rawProvider;
  const apiUrl =
    ((config.api_url as string | undefined) ?? '') ||
    (isCustomProvider ? rawProvider.slice('custom:'.length) : '');
  const temperature = (config.default_temperature as number | undefined) ?? 0;
  const gatewayPort =
    ((config.gateway as Record<string, unknown> | undefined)?.port as number | undefined) ?? 3000;
  const maxToolIterations =
    ((config.agent as Record<string, unknown> | undefined)?.max_tool_iterations as
      | number
      | undefined) ?? 10;
  const maxHistoryMessages =
    ((config.agent as Record<string, unknown> | undefined)?.max_history_messages as
      | number
      | undefined) ?? 50;
  const modelContextWindowTokensInput = defaultModelContextWindowTokens > 0
    ? defaultModelContextWindowTokens
    : '';
  const compactContext =
    ((config.agent as Record<string, unknown> | undefined)?.compact_context as
      | boolean
      | undefined) ?? false;
  const parallelTools =
    ((config.agent as Record<string, unknown> | undefined)?.parallel_tools as
      | boolean
      | undefined) ?? false;
  const toolDispatcher =
    ((config.agent as Record<string, unknown> | undefined)?.tool_dispatcher as
      | string
      | undefined) ?? 'auto';
  const gatewayHost =
    ((config.gateway as Record<string, unknown> | undefined)?.host as string | undefined) ?? '';
  const gatewayRequirePairing =
    ((config.gateway as Record<string, unknown> | undefined)?.require_pairing as
      | boolean
      | undefined) ?? false;
  const gatewayAllowPublicBind =
    ((config.gateway as Record<string, unknown> | undefined)?.allow_public_bind as
      | boolean
      | undefined) ?? false;
  const proxyEnabled =
    ((config.proxy as Record<string, unknown> | undefined)?.enabled as boolean | undefined) ??
    false;
  const proxyScope =
    ((config.proxy as Record<string, unknown> | undefined)?.scope as string | undefined) ??
    'zeroclaw';
  const proxyMode = !proxyEnabled ? 'direct' : 'system';
  const runtimeKind =
    ((config.runtime as Record<string, unknown> | undefined)?.kind as string | undefined) ?? '';
  const memoryBackend =
    ((config.memory as Record<string, unknown> | undefined)?.backend as string | undefined) ?? '';
  const memoryAutoSave =
    ((config.memory as Record<string, unknown> | undefined)?.auto_save as boolean | undefined) ??
    true;
  const memoryHygieneEnabled =
    ((config.memory as Record<string, unknown> | undefined)?.hygiene_enabled as
      | boolean
      | undefined) ?? true;
  const memoryArchiveAfterDays =
    ((config.memory as Record<string, unknown> | undefined)?.archive_after_days as
      | number
      | undefined) ?? 7;
  const memoryPurgeAfterDays =
    ((config.memory as Record<string, unknown> | undefined)?.purge_after_days as
      | number
      | undefined) ?? 30;
  const memoryConversationRetentionDays =
    ((config.memory as Record<string, unknown> | undefined)?.conversation_retention_days as
      | number
      | undefined) ?? 30;
  const webSearchEnabled =
    ((config.web_search as Record<string, unknown> | undefined)?.enabled as
      | boolean
      | undefined) ?? false;
  const webSearchProvider =
    ((config.web_search as Record<string, unknown> | undefined)?.provider as string | undefined) ??
    '';
  const webSearchMaxResults =
    ((config.web_search as Record<string, unknown> | undefined)?.max_results as
      | number
      | undefined) ?? 5;
  const costEnabled =
    ((config.cost as Record<string, unknown> | undefined)?.enabled as boolean | undefined) ??
    false;
  const costDailyLimit =
    ((config.cost as Record<string, unknown> | undefined)?.daily_limit_usd as
      | number
      | undefined) ?? 10;
  const costMonthlyLimit =
    ((config.cost as Record<string, unknown> | undefined)?.monthly_limit_usd as
      | number
      | undefined) ?? 100;
  const costWarnAtPercent =
    ((config.cost as Record<string, unknown> | undefined)?.warn_at_percent as
      | number
      | undefined) ?? 80;
  const hasKnownProvider = PROVIDER_OPTIONS.some((option) => option.id === provider);
  const providerUiCopy = getProviderUiCopy(provider === 'custom');

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Settings className="h-5 w-5 text-blue-400" />
          <h2 className="text-base font-semibold text-white">{t('config.title')}</h2>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center bg-gray-900 border border-gray-800 rounded-lg p-1">
            <button
              type="button"
              onClick={() => setViewMode('form')}
              className={`px-3 py-1 text-xs font-medium rounded-md ${
                viewMode === 'form'
                  ? 'bg-blue-600 text-white'
                  : 'text-gray-400 hover:text-gray-200'
              }`}
            >
              {t('config.view.form')}
            </button>
            <button
              type="button"
              onClick={() => setViewMode('toml')}
              className={`px-3 py-1 text-xs font-medium rounded-md ${
                viewMode === 'toml'
                  ? 'bg-blue-600 text-white'
                  : 'text-gray-400 hover:text-gray-200'
              }`}
            >
              {t('config.view.toml')}
            </button>
          </div>
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50"
          >
            <Save className="h-4 w-4" />
            {saving ? t('config.saving') : t('common.save')}
          </button>
        </div>
      </div>

      <div className="flex items-start gap-3 bg-yellow-900/20 border border-yellow-700/40 rounded-lg p-4">
        <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-yellow-400" />
        <div>
          <p className="text-sm text-yellow-300 font-medium">
            {t('config.masked_title')}
          </p>
          <p className="text-sm text-yellow-400/70 mt-0.5">
            {t('config.masked_desc')}
          </p>
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-2 bg-red-900/30 border border-red-700 rounded-lg p-3">
          <AlertTriangle className="h-4 w-4 shrink-0 text-red-400" />
          <span className="text-sm text-red-300">{error}</span>
        </div>
      )}

      {viewMode === 'form' && (
        <div className="text-xs text-gray-400">{t('config.view.form_hint')}</div>
      )}

      {viewMode === 'toml' ? (
        <div className="bg-gray-900 rounded-xl border border-gray-800 overflow-hidden">
          <div className="flex items-center justify-between px-4 py-2 border-b border-gray-800 bg-gray-800/50">
            <span className="text-xs text-gray-400 font-medium uppercase tracking-wider">
              {t('config.toml_title')}
            </span>
            <span className="text-xs text-gray-500">
              {toml.split('\n').length} {t('config.lines')}
            </span>
          </div>
          <textarea
            value={toml}
            onChange={(e) => setToml(e.target.value)}
            spellCheck={false}
            className="w-full min-h-[500px] bg-gray-950 text-gray-200 font-mono text-sm p-4 resize-y focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-inset"
            style={{ tabSize: 4 }}
          />
        </div>
      ) : (
        <div className="space-y-6">
          <div className="flex flex-wrap items-center gap-2 bg-gray-900 border border-gray-800 rounded-lg p-2">
            {[
              { key: 'gateway', label: t('config.tabs.gateway') },
              { key: 'runtime', label: t('config.tabs.runtime') },
              { key: 'memory', label: t('config.tabs.memory') },
              { key: 'web_search', label: t('config.tabs.web_search') },
              { key: 'cost', label: t('config.tabs.cost') },
            ].map((tab) => (
              <button
                key={tab.key}
                type="button"
                onClick={() =>
                  selectTab(tab.key as ConfigTab)
                }
                className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
                  activeTab === tab.key
                    ? 'bg-blue-600 text-white'
                    : 'text-gray-400 hover:text-gray-200'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

        {activeTab === 'general' && (
        <div className="bg-gray-900 rounded-xl border border-gray-800 p-5 space-y-4">
          <h3 className="text-sm font-semibold text-gray-200">
            {t('config.form.general_title')}
          </h3>
          <div>
            <label className="text-xs text-gray-400">{t('config.form.provider_label')}</label>
            <div className="relative">
              <select
                value={provider}
                onChange={(e) =>
                  updateConfig(
                    ['default_provider'],
                    e.target.value === '' ? undefined : e.target.value,
                  )
                }
                className={selectClassName}
              >
                <option value="">{t('config.form.provider_unset')}</option>
                {!hasKnownProvider && provider && <option value={provider}>{provider}</option>}
                {PROVIDER_OPTIONS.map((option) => (
                  <option key={option.id} value={option.id}>
                    {t(`onboard.provider.${option.id}`, { defaultValue: option.label })}
                  </option>
                ))}
              </select>
              <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-500" />
            </div>
            <p className="mt-2 text-xs text-gray-500">{t(providerUiCopy.providerHelpKey)}</p>
          </div>
          <div>
            <label className="text-xs text-gray-400">{t('config.form.model_label')}</label>
            <input
              value={model}
              onChange={(e) => updateConfig(['default_model'], e.target.value)}
              className="mt-2 w-full rounded-lg bg-gray-950 border border-gray-800 px-3 py-2 text-sm text-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="text-xs text-gray-400">{t('config.form.api_key_label')}</label>
            <input
              type="password"
              value={apiKey}
              onChange={(e) => updateConfig(['api_key'], e.target.value)}
              placeholder={t('config.form.api_key_placeholder')}
              className="mt-2 w-full rounded-lg bg-gray-950 border border-gray-800 px-3 py-2 text-sm text-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="text-xs text-gray-400">
              {t(providerUiCopy.apiUrlLabelKey)}
            </label>
            <input
              value={apiUrl}
              onChange={(e) => updateConfig(['api_url'], e.target.value)}
              placeholder={t(providerUiCopy.apiUrlPlaceholderKey)}
              className="mt-2 w-full rounded-lg bg-gray-950 border border-gray-800 px-3 py-2 text-sm text-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <p className="mt-2 text-xs text-gray-500">{t(providerUiCopy.apiUrlHelpKey)}</p>
          </div>
          <div>
            <label className="text-xs text-gray-400">{t('config.form.temperature_label')}</label>
            <input
              type="number"
              step="0.1"
              value={temperature}
              onChange={(e) => updateConfig(['default_temperature'], Number(e.target.value))}
              className="mt-2 w-full rounded-lg bg-gray-950 border border-gray-800 px-3 py-2 text-sm text-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
        </div>
        )}

        {activeTab === 'channels' && (
        <div className="space-y-6">
          <div className="rounded-xl border border-gray-800 bg-gray-900 p-5">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
              <div>
                <h3 className="text-sm font-semibold text-gray-200">
                  {t('config.channels.title')}
                </h3>
                <p className="mt-1 text-sm text-gray-400">
                  {t('config.channels.description')}
                </p>
              </div>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <div className="relative min-w-[220px]">
                  <select
                    value={channelToAdd}
                    onChange={(e) => setChannelToAdd(e.target.value)}
                    disabled={availableChannels.length === 0}
                    className={selectClassName}
                  >
                    {availableChannels.length === 0 ? (
                      <option value="">{t('config.channels.all_added')}</option>
                    ) : (
                      availableChannels.map((channel) => (
                        <option key={channel.id} value={channel.id}>
                          {channel.label}
                        </option>
                      ))
                    )}
                  </select>
                  <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-500" />
                </div>
                <button
                  type="button"
                  onClick={addChannel}
                  disabled={availableChannels.length === 0}
                  className="inline-flex items-center justify-center gap-2 rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Plus className="h-4 w-4" />
                  {t('config.channels.add')}
                </button>
              </div>
            </div>
          </div>

          {configuredChannelIds.length === 0 ? (
            <div className="rounded-xl border border-dashed border-gray-700 bg-gray-900/50 p-8 text-center">
              <p className="text-sm font-medium text-gray-200">{t('config.channels.empty_title')}</p>
              <p className="mt-2 text-sm text-gray-500">{t('config.channels.empty_desc')}</p>
            </div>
          ) : (
            <div className="space-y-4">
              {configuredChannelIds.map((channelId) => {
                const channel = CHANNEL_DEFS.find((item) => item.id === channelId);
                const parsed = parseChannelConfig(channelId);
                const mode = channelEditMode[channelId] ?? 'form';
                return (
                  <div key={channelId} className="rounded-xl border border-gray-800 bg-gray-900 p-5">
                    <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div>
                        <div className="text-sm font-semibold text-gray-100">
                          {channel?.label ?? channelId}
                        </div>
                        <div className="mt-1 text-xs text-gray-500">
                          {channel?.description ?? t('config.channels.custom_channel')}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="flex items-center rounded-lg border border-gray-800 bg-gray-950 p-1">
                          <button
                            type="button"
                            onClick={() =>
                              setChannelEditMode((prev) => ({ ...prev, [channelId]: 'form' }))
                            }
                            className={`rounded-md px-2 py-1 text-xs font-medium ${
                              mode === 'form'
                                ? 'bg-blue-600 text-white'
                                : 'text-gray-400 hover:text-gray-200'
                            }`}
                          >
                            {t('config.channels.form_mode')}
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              setChannelEditMode((prev) => ({ ...prev, [channelId]: 'json' }))
                            }
                            className={`rounded-md px-2 py-1 text-xs font-medium ${
                              mode === 'json'
                                ? 'bg-blue-600 text-white'
                                : 'text-gray-400 hover:text-gray-200'
                            }`}
                          >
                            {t('config.channels.json_mode')}
                          </button>
                        </div>
                        <button
                          type="button"
                          onClick={() => removeChannel(channelId)}
                          className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-red-900/60 bg-red-950/30 text-red-300 transition-colors hover:bg-red-900/40"
                          title={t('config.channels.remove')}
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </div>

                    {mode !== 'json' && parsed ? (
                      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                        {Object.entries(parsed).map(([field, value]) => (
                          <label key={field} className="text-xs text-gray-400">
                            {field}
                            {typeof value === 'boolean' ? (
                              <div className="mt-2 flex items-center justify-between rounded-lg border border-gray-800 bg-gray-950 px-3 py-2">
                                <span className="text-sm text-gray-300">
                                  {value ? t('common.enabled') : t('common.disabled')}
                                </span>
                                <input
                                  type="checkbox"
                                  checked={value}
                                  onChange={(e) =>
                                    updateChannelField(channelId, field, value, e.target.checked)
                                  }
                                />
                              </div>
                            ) : (
                              <input
                                type={typeof value === 'number' ? 'number' : 'text'}
                                value={Array.isArray(value) ? value.join(', ') : value === null ? '' : String(value)}
                                onChange={(e) =>
                                  updateChannelField(channelId, field, value, e.target.value)
                                }
                                className="mt-2 w-full rounded-lg border border-gray-800 bg-gray-950 px-3 py-2 text-sm text-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
                              />
                            )}
                          </label>
                        ))}
                      </div>
                    ) : (
                      <textarea
                        value={
                          channelDrafts[channelId] ??
                          JSON.stringify(channelsConfig[channelId] ?? {}, null, 2)
                        }
                        onChange={(e) =>
                          setChannelDrafts((prev) => ({ ...prev, [channelId]: e.target.value }))
                        }
                        className="min-h-[260px] w-full rounded-lg border border-gray-800 bg-gray-950 p-3 font-mono text-sm text-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
                        spellCheck={false}
                        autoComplete="off"
                      />
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
        )}

        {activeTab === 'agent' && (
        <div className="bg-gray-900 rounded-xl border border-gray-800 p-5 space-y-4">
          <h3 className="text-sm font-semibold text-gray-200">
            {t('config.form.agent_title')}
          </h3>
          <div>
            <div className="flex items-center gap-2">
              <label className="text-xs text-gray-400">
                {t('config.form.max_tool_iterations_label')}
              </label>
              <button
                type="button"
                onClick={() => toggleHelp('max_tool_iterations')}
                className="text-gray-500 hover:text-blue-400"
              >
                <HelpCircle className="h-4 w-4" />
              </button>
            </div>
            {openHelp === 'max_tool_iterations' && (
              <p className="text-xs text-gray-500 mt-2">
                {t('config.form.max_tool_iterations_help')}
              </p>
            )}
            <input
              type="number"
              value={maxToolIterations}
              onChange={(e) =>
                updateConfig(['agent', 'max_tool_iterations'], Number(e.target.value))
              }
              className="mt-2 w-full rounded-lg bg-gray-950 border border-gray-800 px-3 py-2 text-sm text-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <label className="text-xs text-gray-400">
                {t('config.form.max_history_messages_label')}
              </label>
              <button
                type="button"
                onClick={() => toggleHelp('max_history_messages')}
                className="text-gray-500 hover:text-blue-400"
              >
                <HelpCircle className="h-4 w-4" />
              </button>
            </div>
            {openHelp === 'max_history_messages' && (
              <p className="text-xs text-gray-500 mt-2">
                {t('config.form.max_history_messages_help')}
              </p>
            )}
            <input
              type="number"
              value={maxHistoryMessages}
              onChange={(e) =>
                updateConfig(['agent', 'max_history_messages'], Number(e.target.value))
              }
              className="mt-2 w-full rounded-lg bg-gray-950 border border-gray-800 px-3 py-2 text-sm text-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <label className="text-xs text-gray-400">
                {t('config.form.model_context_window_tokens_label')}
              </label>
              <button
                type="button"
                onClick={() => toggleHelp('model_context_window_tokens')}
                className="text-gray-500 hover:text-blue-400"
              >
                <HelpCircle className="h-4 w-4" />
              </button>
            </div>
            {openHelp === 'model_context_window_tokens' && (
              <p className="text-xs text-gray-500 mt-2">
                {t('config.form.model_context_window_tokens_help')}
              </p>
            )}
            <input
              type="number"
              min={0}
              step={1}
              value={modelContextWindowTokensInput}
              onChange={(e) => {
                const raw = e.target.value.trim();
                const next = structuredClone(config) as ConfigForm;
                const agent = ((next.agent as Record<string, unknown> | undefined) ?? {}) as Record<
                  string,
                  unknown
                >;
                const windows = ((agent.model_context_windows as Record<string, unknown> | undefined) ??
                  {}) as Record<string, unknown>;
                if (normalizedModelKey) {
                  const isPositiveInteger = /^[1-9]\d*$/.test(raw);
                  const tokens = Number.parseInt(raw, 10);
                  if (!isPositiveInteger || !Number.isFinite(tokens) || tokens <= 0) {
                    delete windows[normalizedModelKey];
                  } else {
                    windows[normalizedModelKey] = {
                      context_window_tokens: tokens,
                      updated_at_unix: Math.floor(Date.now() / 1000),
                    };
                  }
                }
                agent.model_context_windows = windows;
                next.agent = agent;
                setConfig(next);
              }}
              placeholder={t('config.form.model_context_window_tokens_placeholder')}
              className="mt-2 w-full rounded-lg bg-gray-950 border border-gray-800 px-3 py-2 text-sm text-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <label className="text-xs text-gray-400">
                {t('config.form.model_context_window_ttl_label')}
              </label>
              <button
                type="button"
                onClick={() => toggleHelp('model_context_window_ttl')}
                className="text-gray-500 hover:text-blue-400"
              >
                <HelpCircle className="h-4 w-4" />
              </button>
            </div>
            {openHelp === 'model_context_window_ttl' && (
              <p className="text-xs text-gray-500 mt-2">
                {t('config.form.model_context_window_ttl_help')}
              </p>
            )}
            <input
              type="number"
              min={1}
              value={modelContextWindowTtlSecs}
              onChange={(e) =>
                updateConfig(
                  ['agent', 'model_context_window_ttl_secs'],
                  Math.max(1, Number(e.target.value) || 1),
                )
              }
              className="mt-2 w-full rounded-lg bg-gray-950 border border-gray-800 px-3 py-2 text-sm text-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <label className="text-xs text-gray-400">
                {t('config.form.tool_dispatcher_label')}
              </label>
              <button
                type="button"
                onClick={() => toggleHelp('tool_dispatcher')}
                className="text-gray-500 hover:text-blue-400"
              >
                <HelpCircle className="h-4 w-4" />
              </button>
            </div>
            {openHelp === 'tool_dispatcher' && (
              <p className="text-xs text-gray-500 mt-2">
                {t('config.form.tool_dispatcher_help')}
              </p>
            )}
            <div className="relative">
              <select
                value={toolDispatcher}
                onChange={(e) => updateConfig(['agent', 'tool_dispatcher'], e.target.value)}
                className={selectClassName}
              >
                <option value="auto">{t('config.form.tool_dispatcher_auto')}</option>
                <option value="native">{t('config.form.tool_dispatcher_native')}</option>
                <option value="xml">{t('config.form.tool_dispatcher_xml')}</option>
              </select>
              <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-500" />
            </div>
          </div>
          <div className="flex items-start justify-between gap-4 border border-gray-800 rounded-lg p-4 bg-gray-950/40">
            <div>
              <div className="flex items-center gap-2">
                <span className="text-sm text-gray-200">
                  {t('config.form.compact_context_label')}
                </span>
                <button
                  type="button"
                  onClick={() => toggleHelp('compact_context')}
                  className="text-gray-500 hover:text-blue-400"
                >
                  <HelpCircle className="h-4 w-4" />
                </button>
              </div>
              {openHelp === 'compact_context' && (
                <p className="text-xs text-gray-500 mt-2">
                  {t('config.form.compact_context_help')}
                </p>
              )}
            </div>
            <label className="inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={compactContext}
                onChange={(e) => updateConfig(['agent', 'compact_context'], e.target.checked)}
                className="sr-only peer"
              />
              {renderSwitch(compactContext)}
            </label>
          </div>
          <div className="flex items-start justify-between gap-4 border border-gray-800 rounded-lg p-4 bg-gray-950/40">
            <div>
              <div className="flex items-center gap-2">
                <span className="text-sm text-gray-200">
                  {t('config.form.parallel_tools_label')}
                </span>
                <button
                  type="button"
                  onClick={() => toggleHelp('parallel_tools')}
                  className="text-gray-500 hover:text-blue-400"
                >
                  <HelpCircle className="h-4 w-4" />
                </button>
              </div>
              {openHelp === 'parallel_tools' && (
                <p className="text-xs text-gray-500 mt-2">
                  {t('config.form.parallel_tools_help')}
                </p>
              )}
            </div>
            <label className="inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={parallelTools}
                onChange={(e) => updateConfig(['agent', 'parallel_tools'], e.target.checked)}
                className="sr-only peer"
              />
              {renderSwitch(parallelTools)}
            </label>
          </div>
        </div>
        )}

        {activeTab === 'gateway' && (
        <div className="bg-gray-900 rounded-xl border border-gray-800 p-5 space-y-4">
          <h3 className="text-sm font-semibold text-gray-200">
            {t('config.form.gateway_title')}
          </h3>
          <div>
            <div className="flex items-center gap-2">
              <label className="text-xs text-gray-400">
                {t('config.form.gateway_port_label')}
              </label>
              <button
                type="button"
                onClick={() => toggleHelp('gateway_port')}
                className="text-gray-500 hover:text-blue-400"
              >
                <HelpCircle className="h-4 w-4" />
              </button>
            </div>
            {openHelp === 'gateway_port' && (
              <p className="text-xs text-gray-500 mt-2">{t('config.form.gateway_port_help')}</p>
            )}
            <input
              type="number"
              value={gatewayPort}
              onChange={(e) => updateConfig(['gateway', 'port'], Number(e.target.value))}
              className="mt-2 w-full rounded-lg bg-gray-950 border border-gray-800 px-3 py-2 text-sm text-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <label className="text-xs text-gray-400">
                {t('config.form.gateway_host_label')}
              </label>
              <button
                type="button"
                onClick={() => toggleHelp('gateway_host')}
                className="text-gray-500 hover:text-blue-400"
              >
                <HelpCircle className="h-4 w-4" />
              </button>
            </div>
            {openHelp === 'gateway_host' && (
              <p className="text-xs text-gray-500 mt-2">{t('config.form.gateway_host_help')}</p>
            )}
            <input
              value={gatewayHost}
              onChange={(e) => updateConfig(['gateway', 'host'], e.target.value)}
              className="mt-2 w-full rounded-lg bg-gray-950 border border-gray-800 px-3 py-2 text-sm text-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div className="flex items-start justify-between gap-4 border border-gray-800 rounded-lg p-4 bg-gray-950/40">
            <div>
              <div className="flex items-center gap-2">
                <span className="text-sm text-gray-200">
                  {t('config.form.gateway_require_pairing_label')}
                </span>
                <button
                  type="button"
                  onClick={() => toggleHelp('gateway_require_pairing')}
                  className="text-gray-500 hover:text-blue-400"
                >
                  <HelpCircle className="h-4 w-4" />
                </button>
              </div>
              {openHelp === 'gateway_require_pairing' && (
                <p className="text-xs text-gray-500 mt-2">
                  {t('config.form.gateway_require_pairing_help')}
                </p>
              )}
            </div>
            <label className="inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={gatewayRequirePairing}
                onChange={(e) => updateConfig(['gateway', 'require_pairing'], e.target.checked)}
                className="sr-only peer"
              />
              {renderSwitch(gatewayRequirePairing)}
            </label>
          </div>
          <div className="flex items-start justify-between gap-4 border border-gray-800 rounded-lg p-4 bg-gray-950/40">
            <div>
              <div className="flex items-center gap-2">
                <span className="text-sm text-gray-200">
                  {t('config.form.gateway_allow_public_bind_label')}
                </span>
                <button
                  type="button"
                  onClick={() => toggleHelp('gateway_allow_public_bind')}
                  className="text-gray-500 hover:text-blue-400"
                >
                  <HelpCircle className="h-4 w-4" />
                </button>
              </div>
              {openHelp === 'gateway_allow_public_bind' && (
                <p className="text-xs text-gray-500 mt-2">
                  {t('config.form.gateway_allow_public_bind_help')}
                </p>
              )}
            </div>
            <label className="inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={gatewayAllowPublicBind}
                onChange={(e) => updateConfig(['gateway', 'allow_public_bind'], e.target.checked)}
                className="sr-only peer"
              />
              {renderSwitch(gatewayAllowPublicBind)}
            </label>
          </div>
          <div className="pt-2 border-t border-gray-800">
            <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-400">
              {t('config.form.proxy_title')}
            </h4>
          </div>
          <div className="flex items-start justify-between gap-4 border border-gray-800 rounded-lg p-4 bg-gray-950/40">
            <div>
              <span className="text-sm text-gray-200">{t('config.form.proxy_enabled_label')}</span>
            </div>
            <label className="inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={proxyEnabled}
                onChange={(e) => updateConfig(['proxy', 'enabled'], e.target.checked)}
                className="sr-only peer"
              />
              {renderSwitch(proxyEnabled)}
            </label>
          </div>
          <div>
            <label className="text-xs text-gray-400">{t('config.form.proxy_mode_label')}</label>
            <div className="relative">
              <select
                value={proxyMode}
                onChange={(e) => {
                  const mode = e.target.value;
                  if (mode === 'direct') {
                    updateConfig(['proxy', 'enabled'], false);
                    return;
                  }
                  updateConfig(['proxy', 'enabled'], true);
                  updateConfig(['proxy', 'scope'], 'environment');
                }}
                className={selectClassName}
              >
                <option value="direct">{t('config.form.proxy_mode_direct')}</option>
                <option value="system">{t('config.form.proxy_mode_system')}</option>
              </select>
              <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-500" />
            </div>
            <p className="mt-2 text-xs text-gray-500">{t('config.form.proxy_mode_help')}</p>
            {proxyEnabled && proxyScope !== 'environment' && (
              <p className="mt-2 text-xs text-amber-400">
                {t('config.form.proxy_mode_migrated_hint')}
              </p>
            )}
          </div>
        </div>
        )}

        {activeTab === 'runtime' && (
        <div className="bg-gray-900 rounded-xl border border-gray-800 p-5 space-y-4">
          <h3 className="text-sm font-semibold text-gray-200">
            {t('config.form.runtime_title')}
          </h3>
          <div>
            <label className="text-xs text-gray-400">{t('config.form.runtime_kind_label')}</label>
            <div className="relative">
              <select
                value={runtimeKind}
                onChange={(e) => updateConfig(['runtime', 'kind'], e.target.value)}
                className={selectClassName}
              >
                <option value="native">{t('config.form.runtime_kind_native')}</option>
                <option value="docker">{t('config.form.runtime_kind_docker')}</option>
              </select>
              <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-500" />
            </div>
          </div>
        </div>
        )}

        {activeTab === 'memory' && (
        <div className="bg-gray-900 rounded-xl border border-gray-800 p-5 space-y-4">
          <h3 className="text-sm font-semibold text-gray-200">
            {t('config.form.memory_title')}
          </h3>
          <div>
            <label className="text-xs text-gray-400">{t('config.form.memory_backend_label')}</label>
            <div className="relative">
              <select
                value={memoryBackend}
                onChange={(e) => updateConfig(['memory', 'backend'], e.target.value)}
                className={selectClassName}
              >
                <option value="sqlite">{t('config.form.memory_backend_sqlite')}</option>
                <option value="lucid">{t('config.form.memory_backend_lucid')}</option>
                <option value="postgres">{t('config.form.memory_backend_postgres')}</option>
                <option value="qdrant">{t('config.form.memory_backend_qdrant')}</option>
                <option value="markdown">{t('config.form.memory_backend_markdown')}</option>
                <option value="none">{t('config.form.memory_backend_none')}</option>
              </select>
              <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-500" />
            </div>
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div>
              <label className="text-xs text-gray-400">
                {t('config.form.memory_archive_after_label')}
              </label>
              <input
                type="number"
                value={memoryArchiveAfterDays}
                onChange={(e) =>
                  updateConfig(['memory', 'archive_after_days'], Number(e.target.value))
                }
                className="mt-2 w-full rounded-lg bg-gray-950 border border-gray-800 px-3 py-2 text-sm text-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="text-xs text-gray-400">
                {t('config.form.memory_purge_after_label')}
              </label>
              <input
                type="number"
                value={memoryPurgeAfterDays}
                onChange={(e) =>
                  updateConfig(['memory', 'purge_after_days'], Number(e.target.value))
                }
                className="mt-2 w-full rounded-lg bg-gray-950 border border-gray-800 px-3 py-2 text-sm text-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>
          <div>
            <label className="text-xs text-gray-400">
              {t('config.form.memory_retention_label')}
            </label>
            <input
              type="number"
              value={memoryConversationRetentionDays}
              onChange={(e) =>
                updateConfig(['memory', 'conversation_retention_days'], Number(e.target.value))
              }
              className="mt-2 w-full rounded-lg bg-gray-950 border border-gray-800 px-3 py-2 text-sm text-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="flex items-start justify-between gap-4 border border-gray-800 rounded-lg p-4 bg-gray-950/40">
              <div>
                <span className="text-sm text-gray-200">{t('config.form.memory_auto_save_label')}</span>
              </div>
              <label className="inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={memoryAutoSave}
                  onChange={(e) => updateConfig(['memory', 'auto_save'], e.target.checked)}
                  className="sr-only peer"
                />
                {renderSwitch(memoryAutoSave)}
              </label>
            </div>
            <div className="flex items-start justify-between gap-4 border border-gray-800 rounded-lg p-4 bg-gray-950/40">
              <div>
                <span className="text-sm text-gray-200">
                  {t('config.form.memory_hygiene_label')}
                </span>
              </div>
              <label className="inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={memoryHygieneEnabled}
                  onChange={(e) => updateConfig(['memory', 'hygiene_enabled'], e.target.checked)}
                  className="sr-only peer"
                />
                {renderSwitch(memoryHygieneEnabled)}
              </label>
            </div>
          </div>
        </div>
        )}

        {activeTab === 'web_search' && (
        <div className="bg-gray-900 rounded-xl border border-gray-800 p-5 space-y-4">
          <h3 className="text-sm font-semibold text-gray-200">
            {t('config.form.web_search_title')}
          </h3>
          <div className="flex items-start justify-between gap-4 border border-gray-800 rounded-lg p-4 bg-gray-950/40">
            <div>
              <span className="text-sm text-gray-200">{t('config.form.web_search_enabled_label')}</span>
            </div>
            <label className="inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={webSearchEnabled}
                onChange={(e) => updateConfig(['web_search', 'enabled'], e.target.checked)}
                className="sr-only peer"
              />
              {renderSwitch(webSearchEnabled)}
            </label>
          </div>
          <div>
            <label className="text-xs text-gray-400">{t('config.form.web_search_provider_label')}</label>
            <div className="relative">
              <select
                value={webSearchProvider}
                onChange={(e) => updateConfig(['web_search', 'provider'], e.target.value)}
                className={selectClassName}
              >
                <option value="duckduckgo">
                  {t('config.form.web_search_provider_duckduckgo')}
                </option>
                <option value="brave">{t('config.form.web_search_provider_brave')}</option>
              </select>
              <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-500" />
            </div>
          </div>
          <div>
            <label className="text-xs text-gray-400">
              {t('config.form.web_search_max_results_label')}
            </label>
            <input
              type="number"
              value={webSearchMaxResults}
              onChange={(e) => updateConfig(['web_search', 'max_results'], Number(e.target.value))}
              className="mt-2 w-full rounded-lg bg-gray-950 border border-gray-800 px-3 py-2 text-sm text-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
        </div>
        )}

        {activeTab === 'cost' && (
        <div className="bg-gray-900 rounded-xl border border-gray-800 p-5 space-y-4">
          <h3 className="text-sm font-semibold text-gray-200">
            {t('config.form.cost_title')}
          </h3>
          <div className="flex items-start justify-between gap-4 border border-gray-800 rounded-lg p-4 bg-gray-950/40">
            <div>
              <span className="text-sm text-gray-200">{t('config.form.cost_enabled_label')}</span>
            </div>
            <label className="inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={costEnabled}
                onChange={(e) => updateConfig(['cost', 'enabled'], e.target.checked)}
                className="sr-only peer"
              />
              {renderSwitch(costEnabled)}
            </label>
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <div>
              <label className="text-xs text-gray-400">
                {t('config.form.cost_daily_limit_label')}
              </label>
              <input
                type="number"
                value={costDailyLimit}
                onChange={(e) => updateConfig(['cost', 'daily_limit_usd'], Number(e.target.value))}
                className="mt-2 w-full rounded-lg bg-gray-950 border border-gray-800 px-3 py-2 text-sm text-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="text-xs text-gray-400">
                {t('config.form.cost_monthly_limit_label')}
              </label>
              <input
                type="number"
                value={costMonthlyLimit}
                onChange={(e) =>
                  updateConfig(['cost', 'monthly_limit_usd'], Number(e.target.value))
                }
                className="mt-2 w-full rounded-lg bg-gray-950 border border-gray-800 px-3 py-2 text-sm text-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="text-xs text-gray-400">
                {t('config.form.cost_warn_percent_label')}
              </label>
              <input
                type="number"
                value={costWarnAtPercent}
                onChange={(e) => updateConfig(['cost', 'warn_at_percent'], Number(e.target.value))}
                className="mt-2 w-full rounded-lg bg-gray-950 border border-gray-800 px-3 py-2 text-sm text-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>
        </div>
        )}
        </div>
      )}
    </div>
  );
}
