import { useEffect, useState } from 'react';
import {
  AlertTriangle,
  Bot,
  ChevronDown,
  Cpu,
  HelpCircle,
  Save,
  ShieldAlert,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { getConfigForm, putConfigForm } from '@/lib/api';
import { useNotify } from '@/hooks/useNotify';
import { Logo } from '@/components/ui/Logo';

type ConfigForm = Record<string, unknown>;
type DeerClawSettingsTab = 'model' | 'execution';

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

export default function DeerClawSettings() {
  const { t } = useTranslation();
  const notify = useNotify();
  const [config, setConfig] = useState<ConfigForm | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [openHelp, setOpenHelp] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<DeerClawSettingsTab>('model');

  useEffect(() => {
    const load = async () => {
      try {
        const formData = await getConfigForm<ConfigForm>();
        setConfig(formData);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : t('config.error');
        setError(message);
        notify.error(message, { key: 'deerclaw-settings:load' });
      } finally {
        setLoading(false);
      }
    };
    void load();
  }, [notify, t]);

  const updateConfig = (path: string[], value: unknown) => {
    setConfig((prev) => {
      if (!prev || path.length === 0) return prev;
      const next = structuredClone(prev) as ConfigForm;
      let cursor: Record<string, unknown> = next;
      for (let i = 0; i < path.length - 1; i += 1) {
        const key = path[i] as string;
        if (typeof cursor[key] !== 'object' || cursor[key] === null) {
          cursor[key] = {};
        }
        cursor = cursor[key] as Record<string, unknown>;
      }
      cursor[path[path.length - 1] as string] = value;
      return next;
    });
  };

  const toggleHelp = (key: string) => {
    setOpenHelp((prev) => (prev === key ? null : key));
  };

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

  const selectClassName =
    'mt-2 w-full appearance-none rounded-lg bg-gray-950 border border-gray-800 px-3 py-2 pr-9 text-sm text-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500 cursor-pointer';

  const handleSave = async () => {
    if (!config) {
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const nextConfig = structuredClone(config) as ConfigForm;
      nextConfig.default_provider = normalizeProviderValue(
        ((nextConfig.default_provider as string | undefined) ?? ''),
        ((nextConfig.api_url as string | undefined) ?? ''),
      );
      await putConfigForm(nextConfig);
      setConfig(nextConfig);
      notify.success(t('config.saved'), { key: 'deerclaw-settings:save:success' });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : t('config.error');
      setError(message);
      notify.error(message, { key: 'deerclaw-settings:save:error' });
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-blue-500 border-t-transparent" />
      </div>
    );
  }

  if (!config) {
    return (
      <div className="flex h-64 items-center justify-center">
        <div className="text-sm text-gray-400">{t('config.error')}</div>
      </div>
    );
  }

  const model = (config.default_model as string | undefined) ?? '';
  const normalizedModelKey = model.trim().toLowerCase();
  const modelContextWindows =
    ((((config.agent as Record<string, unknown> | undefined)?.model_context_windows as
      | Record<string, unknown>
      | undefined)) ?? {});
  const defaultModelContextWindowTokens = normalizedModelKey
    ? ((modelContextWindows[normalizedModelKey] as Record<string, unknown> | undefined)
        ?.context_window_tokens as number | undefined) ?? 0
    : 0;
  const modelContextWindowTokensInput =
    defaultModelContextWindowTokens > 0 ? defaultModelContextWindowTokens : '';
  const modelContextWindowTtlSecs =
    ((((config.agent as Record<string, unknown> | undefined)?.model_context_window_ttl_secs as
      | number
      | undefined)) ?? 604800);
  const rawProvider = (config.default_provider as string | undefined) ?? '';
  const apiKey = (config.api_key as string | undefined) ?? '';
  const isCustomProvider = rawProvider.startsWith('custom:');
  const provider = isCustomProvider ? 'custom' : rawProvider;
  const apiUrl =
    ((config.api_url as string | undefined) ?? '') ||
    (isCustomProvider ? rawProvider.slice('custom:'.length) : '');
  const temperature = (config.default_temperature as number | undefined) ?? 0;
  const maxToolIterations =
    ((config.agent as Record<string, unknown> | undefined)?.max_tool_iterations as
      | number
      | undefined) ?? 10;
  const maxHistoryMessages =
    ((config.agent as Record<string, unknown> | undefined)?.max_history_messages as
      | number
      | undefined) ?? 50;
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
  const maxActionsPerHour =
    ((config.autonomy as Record<string, unknown> | undefined)?.max_actions_per_hour as
      | number
      | undefined) ?? 100;
  const hasKnownProvider = PROVIDER_OPTIONS.some((option) => option.id === provider);
  const providerUiCopy = getProviderUiCopy(provider === 'custom');
  const tabs: Array<{ id: DeerClawSettingsTab; label: string }> = [
    { id: 'model', label: t('deerclaw_settings.tab_model') },
    { id: 'execution', label: t('deerclaw_settings.tab_execution') },
  ];

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-gray-900 text-blue-300">
            <Logo className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-base font-semibold text-white">{t('deerclaw_settings.title')}</h2>
            <p className="mt-1 text-sm text-gray-400">{t('deerclaw_settings.description')}</p>
          </div>
        </div>
        <button
          onClick={handleSave}
          disabled={saving}
          className="flex items-center gap-2 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-blue-700 disabled:opacity-50"
        >
          <Save className="h-4 w-4" />
          {saving ? t('config.saving') : t('common.save')}
        </button>
      </div>

      <div className="flex items-start gap-3 rounded-lg border border-yellow-700/40 bg-yellow-900/20 p-4">
        <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-yellow-400" />
        <div>
          <p className="text-sm font-medium text-yellow-300">{t('config.masked_title')}</p>
          <p className="mt-0.5 text-sm text-yellow-400/70">{t('config.masked_desc')}</p>
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded-lg border border-red-700 bg-red-900/30 p-3">
          <AlertTriangle className="h-4 w-4 shrink-0 text-red-400" />
          <span className="text-sm text-red-300">{error}</span>
        </div>
      )}

      <div className="rounded-xl border border-gray-800 bg-gray-900 p-2">
        <div className="flex flex-wrap items-center gap-2">
          {tabs.map((tab) => {
            const selected = tab.id === activeTab;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                  selected
                    ? 'bg-blue-600 text-white'
                    : 'text-gray-400 hover:bg-gray-800 hover:text-gray-200'
                }`}
              >
                {tab.label}
              </button>
            );
          })}
        </div>
      </div>

      {activeTab === 'model' && (
        <div className="rounded-xl border border-gray-800 bg-gray-900 p-5 space-y-4">
          <div className="flex items-center gap-2">
            <Bot className="h-4 w-4 text-blue-300" />
            <h3 className="text-sm font-semibold text-gray-200">
              {t('deerclaw_settings.tab_model')}
            </h3>
          </div>
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
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
                className="mt-2 w-full rounded-lg border border-gray-800 bg-gray-950 px-3 py-2 text-sm text-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div className="xl:col-span-2">
              <label className="text-xs text-gray-400">{t('config.form.api_key_label')}</label>
              <input
                type="password"
                value={apiKey}
                onChange={(e) => updateConfig(['api_key'], e.target.value)}
                placeholder={t('config.form.api_key_placeholder')}
                className="mt-2 w-full rounded-lg border border-gray-800 bg-gray-950 px-3 py-2 text-sm text-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div className="xl:col-span-2">
              <label className="text-xs text-gray-400">{t(providerUiCopy.apiUrlLabelKey)}</label>
              <input
                value={apiUrl}
                onChange={(e) => updateConfig(['api_url'], e.target.value)}
                placeholder={t(providerUiCopy.apiUrlPlaceholderKey)}
                className="mt-2 w-full rounded-lg border border-gray-800 bg-gray-950 px-3 py-2 text-sm text-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
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
                className="mt-2 w-full rounded-lg border border-gray-800 bg-gray-950 px-3 py-2 text-sm text-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
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
                <p className="mt-2 text-xs text-gray-500">
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
                className="mt-2 w-full rounded-lg border border-gray-800 bg-gray-950 px-3 py-2 text-sm text-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
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
                <p className="mt-2 text-xs text-gray-500">
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
                className="mt-2 w-full rounded-lg border border-gray-800 bg-gray-950 px-3 py-2 text-sm text-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>
        </div>
      )}

      {activeTab === 'execution' && (
        <div className="rounded-xl border border-gray-800 bg-gray-900 p-5 space-y-4">
          <div className="flex items-center gap-2">
            <Cpu className="h-4 w-4 text-blue-300" />
            <div>
              <h3 className="text-sm font-semibold text-gray-200">
                {t('deerclaw_settings.tab_execution')}
              </h3>
              <p className="mt-1 text-sm text-gray-500">
                {t('deerclaw_settings.agent_section_hint')}
              </p>
            </div>
          </div>
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
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
                <p className="mt-2 text-xs text-gray-500">
                  {t('config.form.max_tool_iterations_help')}
                </p>
              )}
              <input
                type="number"
                value={maxToolIterations}
                onChange={(e) =>
                  updateConfig(['agent', 'max_tool_iterations'], Number(e.target.value))
                }
                className="mt-2 w-full rounded-lg border border-gray-800 bg-gray-950 px-3 py-2 text-sm text-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
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
                <p className="mt-2 text-xs text-gray-500">
                  {t('config.form.max_history_messages_help')}
                </p>
              )}
              <input
                type="number"
                value={maxHistoryMessages}
                onChange={(e) =>
                  updateConfig(['agent', 'max_history_messages'], Number(e.target.value))
                }
                className="mt-2 w-full rounded-lg border border-gray-800 bg-gray-950 px-3 py-2 text-sm text-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
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
                <p className="mt-2 text-xs text-gray-500">{t('config.form.tool_dispatcher_help')}</p>
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
            <div>
              <div className="flex items-center gap-2">
                <label className="text-xs text-gray-400">
                  {t('deerclaw_settings.max_actions_per_hour_label')}
                </label>
                <button
                  type="button"
                  onClick={() => toggleHelp('max_actions_per_hour')}
                  className="text-gray-500 hover:text-blue-400"
                >
                  <HelpCircle className="h-4 w-4" />
                </button>
              </div>
              {openHelp === 'max_actions_per_hour' && (
                <p className="mt-2 text-xs text-gray-500">
                  {t('deerclaw_settings.max_actions_per_hour_help')}
                </p>
              )}
              <input
                type="number"
                min={1}
                value={maxActionsPerHour}
                onChange={(e) =>
                  updateConfig(
                    ['autonomy', 'max_actions_per_hour'],
                    Math.max(1, Number(e.target.value) || 1),
                  )
                }
                className="mt-2 w-full rounded-lg border border-gray-800 bg-gray-950 px-3 py-2 text-sm text-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div className="flex items-start justify-between gap-4 rounded-lg border border-gray-800 bg-gray-950/40 p-4">
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-sm text-gray-200">{t('config.form.compact_context_label')}</span>
                  <button
                    type="button"
                    onClick={() => toggleHelp('compact_context')}
                    className="text-gray-500 hover:text-blue-400"
                  >
                    <HelpCircle className="h-4 w-4" />
                  </button>
                </div>
                {openHelp === 'compact_context' && (
                  <p className="mt-2 text-xs text-gray-500">
                    {t('config.form.compact_context_help')}
                  </p>
                )}
              </div>
              <label className="inline-flex cursor-pointer items-center">
                <input
                  type="checkbox"
                  checked={compactContext}
                  onChange={(e) => updateConfig(['agent', 'compact_context'], e.target.checked)}
                  className="sr-only peer"
                />
                {renderSwitch(compactContext)}
              </label>
            </div>
            <div className="flex items-start justify-between gap-4 rounded-lg border border-gray-800 bg-gray-950/40 p-4">
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-sm text-gray-200">{t('config.form.parallel_tools_label')}</span>
                  <button
                    type="button"
                    onClick={() => toggleHelp('parallel_tools')}
                    className="text-gray-500 hover:text-blue-400"
                  >
                    <HelpCircle className="h-4 w-4" />
                  </button>
                </div>
                {openHelp === 'parallel_tools' && (
                  <p className="mt-2 text-xs text-gray-500">
                    {t('config.form.parallel_tools_help')}
                  </p>
                )}
              </div>
              <label className="inline-flex cursor-pointer items-center">
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
        </div>
      )}
    </div>
  );
}
