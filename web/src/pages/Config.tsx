import { useState, useEffect } from 'react';
import {
  Settings,
  Save,
  CheckCircle,
  AlertTriangle,
  ShieldAlert,
  HelpCircle,
  ChevronDown,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { getConfig, getConfigForm, putConfig, putConfigForm } from '@/lib/api';

type ConfigForm = Record<string, unknown>;

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

export default function Config() {
  const { t } = useTranslation();
  const [viewMode, setViewMode] = useState<'form' | 'toml'>('form');
  const [activeTab, setActiveTab] = useState<
    | 'general'
    | 'agent'
    | 'gateway'
    | 'autonomy'
    | 'browser'
    | 'runtime'
    | 'memory'
    | 'web_search'
    | 'cost'
  >('general');
  const [config, setConfig] = useState<ConfigForm | null>(null);
  const [toml, setToml] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [openHelp, setOpenHelp] = useState<string | null>(null);
  const [allowedCommandsText, setAllowedCommandsText] = useState('');
  const [forbiddenPathsText, setForbiddenPathsText] = useState('');
  const [browserAllowedDomainsText, setBrowserAllowedDomainsText] = useState('');

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
        setError(err instanceof Error ? err.message : t('config.error'));
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    setSuccess(null);
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
        setPathValue(['autonomy', 'forbidden_paths'], parseList(forbiddenPathsText));
        setPathValue(['browser', 'allowed_domains'], parseList(browserAllowedDomainsText));
        await putConfigForm(nextConfig);
        setConfig(nextConfig);
        const refreshed = await getConfig();
        setToml(refreshed);
      }
      setSuccess(t('config.saved'));
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : t('config.error'));
    } finally {
      setSaving(false);
    }
  };

  // Auto-dismiss success after 4 seconds
  useEffect(() => {
    if (!success) return;
    const timer = setTimeout(() => setSuccess(null), 4000);
    return () => clearTimeout(timer);
  }, [success]);

  const formatList = (value: unknown) => (Array.isArray(value) ? value.join('\n') : '');
  const parseList = (raw: string) =>
    raw
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);

  useEffect(() => {
    if (!config) return;
    setAllowedCommandsText(
      formatList((config.autonomy as Record<string, unknown> | undefined)?.allowed_commands),
    );
    setForbiddenPathsText(
      formatList((config.autonomy as Record<string, unknown> | undefined)?.forbidden_paths),
    );
    setBrowserAllowedDomainsText(
      formatList((config.browser as Record<string, unknown> | undefined)?.allowed_domains),
    );
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

  const toggleHelp = (key: string) => {
    setOpenHelp((prev) => (prev === key ? null : key));
  };

  const selectClassName =
    'mt-2 w-full appearance-none rounded-lg bg-gray-950 border border-gray-800 px-3 py-2 pr-9 text-sm text-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500 cursor-pointer';

  const provider = (config.default_provider as string | undefined) ?? '';
  const model = (config.default_model as string | undefined) ?? '';
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
  const browserEnabled =
    ((config.browser as Record<string, unknown> | undefined)?.enabled as boolean | undefined) ??
    false;
  const browserBackend =
    ((config.browser as Record<string, unknown> | undefined)?.backend as string | undefined) ?? '';
  const browserNativeHeadless =
    ((config.browser as Record<string, unknown> | undefined)?.native_headless as
      | boolean
      | undefined) ?? false;
  const browserNativeWebdriverUrl =
    ((config.browser as Record<string, unknown> | undefined)?.native_webdriver_url as
      | string
      | undefined) ?? '';
  const computerUseEnabled =
    (((config.browser as Record<string, unknown> | undefined)?.computer_use as Record<
      string,
      unknown
    > | undefined)?.enabled as boolean | undefined) ?? false;
  const computerUseEndpoint =
    (((config.browser as Record<string, unknown> | undefined)?.computer_use as Record<
      string,
      unknown
    > | undefined)?.endpoint as string | undefined) ?? '';
  const computerUseTimeout =
    (((config.browser as Record<string, unknown> | undefined)?.computer_use as Record<
      string,
      unknown
    > | undefined)?.timeout_ms as number | undefined) ?? 15000;
  const computerUseAllowRemote =
    (((config.browser as Record<string, unknown> | undefined)?.computer_use as Record<
      string,
      unknown
    > | undefined)?.allow_remote_endpoint as boolean | undefined) ?? false;
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
  const autonomyLevel =
    ((config.autonomy as Record<string, unknown> | undefined)?.level as string | undefined) ??
    'supervised';
  const autonomyWorkspaceOnly =
    ((config.autonomy as Record<string, unknown> | undefined)?.workspace_only as
      | boolean
      | undefined) ?? true;
  const autonomyMaxActionsPerHour =
    ((config.autonomy as Record<string, unknown> | undefined)?.max_actions_per_hour as
      | number
      | undefined) ?? 100;
  const autonomyMaxCostPerDay =
    ((config.autonomy as Record<string, unknown> | undefined)?.max_cost_per_day_cents as
      | number
      | undefined) ?? 1000;
  const autonomyRequireApproval =
    ((config.autonomy as Record<string, unknown> | undefined)?.require_approval_for_medium_risk as
      | boolean
      | undefined) ?? true;
  const autonomyBlockHighRisk =
    ((config.autonomy as Record<string, unknown> | undefined)?.block_high_risk_commands as
      | boolean
      | undefined) ?? true;
  const autonomyNonCliExcludedTools = formatList(
    (config.autonomy as Record<string, unknown> | undefined)?.non_cli_excluded_tools,
  );
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
        <ShieldAlert className="h-5 w-5 text-yellow-400 flex-shrink-0 mt-0.5" />
        <div>
          <p className="text-sm text-yellow-300 font-medium">
            {t('config.masked_title')}
          </p>
          <p className="text-sm text-yellow-400/70 mt-0.5">
            {t('config.masked_desc')}
          </p>
        </div>
      </div>

      {success && (
        <div className="flex items-center gap-2 bg-green-900/30 border border-green-700 rounded-lg p-3">
          <CheckCircle className="h-4 w-4 text-green-400 flex-shrink-0" />
          <span className="text-sm text-green-300">{success}</span>
        </div>
      )}

      {error && (
        <div className="flex items-center gap-2 bg-red-900/30 border border-red-700 rounded-lg p-3">
          <AlertTriangle className="h-4 w-4 text-red-400 flex-shrink-0" />
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
              { key: 'general', label: t('config.tabs.general') },
              { key: 'agent', label: t('config.tabs.agent') },
              { key: 'gateway', label: t('config.tabs.gateway') },
              { key: 'autonomy', label: t('config.tabs.autonomy') },
              { key: 'browser', label: t('config.tabs.browser') },
              { key: 'runtime', label: t('config.tabs.runtime') },
              { key: 'memory', label: t('config.tabs.memory') },
              { key: 'web_search', label: t('config.tabs.web_search') },
              { key: 'cost', label: t('config.tabs.cost') },
            ].map((tab) => (
              <button
                key={tab.key}
                type="button"
                onClick={() =>
                  setActiveTab(
                    tab.key as
                      | 'general'
                      | 'agent'
                      | 'gateway'
                      | 'autonomy'
                      | 'browser'
                      | 'runtime'
                      | 'memory'
                      | 'web_search'
                      | 'cost',
                  )
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
              <div className="w-10 h-5 bg-gray-700 rounded-full peer peer-checked:bg-blue-600 transition-colors relative">
                <div className="absolute left-1 top-1 w-3 h-3 bg-white rounded-full transition-transform peer-checked:translate-x-5" />
              </div>
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
              <div className="w-10 h-5 bg-gray-700 rounded-full peer peer-checked:bg-blue-600 transition-colors relative">
                <div className="absolute left-1 top-1 w-3 h-3 bg-white rounded-full transition-transform peer-checked:translate-x-5" />
              </div>
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
              <div className="w-10 h-5 bg-gray-700 rounded-full peer peer-checked:bg-blue-600 transition-colors relative">
                <div className="absolute left-1 top-1 w-3 h-3 bg-white rounded-full transition-transform peer-checked:translate-x-5" />
              </div>
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
              <div className="w-10 h-5 bg-gray-700 rounded-full peer peer-checked:bg-blue-600 transition-colors relative">
                <div className="absolute left-1 top-1 w-3 h-3 bg-white rounded-full transition-transform peer-checked:translate-x-5" />
              </div>
            </label>
          </div>
        </div>
        )}

        {activeTab === 'autonomy' && (
        <div className="bg-gray-900 rounded-xl border border-gray-800 p-5 space-y-4">
          <h3 className="text-sm font-semibold text-gray-200">
            {t('config.form.autonomy_title')}
          </h3>
          <div>
            <div className="flex items-center gap-2">
              <label className="text-xs text-gray-400">
                {t('config.form.autonomy_level_label')}
              </label>
              <button
                type="button"
                onClick={() => toggleHelp('autonomy_level')}
                className="text-gray-500 hover:text-blue-400"
              >
                <HelpCircle className="h-4 w-4" />
              </button>
            </div>
            {openHelp === 'autonomy_level' && (
              <p className="text-xs text-gray-500 mt-2">
                {t('config.form.autonomy_level_help')}
              </p>
            )}
            <div className="relative">
              <select
                value={autonomyLevel}
                onChange={(e) => updateConfig(['autonomy', 'level'], e.target.value)}
                className={selectClassName}
              >
                <option value="read_only">{t('config.form.autonomy_level_read_only')}</option>
                <option value="supervised">{t('config.form.autonomy_level_supervised')}</option>
                <option value="full">{t('config.form.autonomy_level_full')}</option>
              </select>
              <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-500" />
            </div>
          </div>
          <div className="flex items-start justify-between gap-4 border border-gray-800 rounded-lg p-4 bg-gray-950/40">
            <div>
              <div className="flex items-center gap-2">
                <span className="text-sm text-gray-200">
                  {t('config.form.autonomy_workspace_only_label')}
                </span>
                <button
                  type="button"
                  onClick={() => toggleHelp('autonomy_workspace_only')}
                  className="text-gray-500 hover:text-blue-400"
                >
                  <HelpCircle className="h-4 w-4" />
                </button>
              </div>
              {openHelp === 'autonomy_workspace_only' && (
                <p className="text-xs text-gray-500 mt-2">
                  {t('config.form.autonomy_workspace_only_help')}
                </p>
              )}
            </div>
            <label className="inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={autonomyWorkspaceOnly}
                onChange={(e) => updateConfig(['autonomy', 'workspace_only'], e.target.checked)}
                className="sr-only peer"
              />
              <div className="w-10 h-5 bg-gray-700 rounded-full peer peer-checked:bg-blue-600 transition-colors relative">
                <div className="absolute left-1 top-1 w-3 h-3 bg-white rounded-full transition-transform peer-checked:translate-x-5" />
              </div>
            </label>
          </div>
          <div>
            <div className="flex items-center gap-2">
              <label className="text-xs text-gray-400">
                {t('config.form.autonomy_allowed_commands_label')}
              </label>
              <button
                type="button"
                onClick={() => toggleHelp('autonomy_allowed_commands')}
                className="text-gray-500 hover:text-blue-400"
              >
                <HelpCircle className="h-4 w-4" />
              </button>
            </div>
            {openHelp === 'autonomy_allowed_commands' && (
              <p className="text-xs text-gray-500 mt-2">
                {t('config.form.autonomy_allowed_commands_help')}
              </p>
            )}
            <textarea
              value={allowedCommandsText}
              onChange={(e) => setAllowedCommandsText(e.target.value)}
              onBlur={() =>
                updateConfig(['autonomy', 'allowed_commands'], parseList(allowedCommandsText))
              }
              className="mt-2 w-full min-h-[120px] rounded-lg bg-gray-950 border border-gray-800 px-3 py-2 text-sm text-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
              spellCheck={false}
              autoComplete="off"
            />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <label className="text-xs text-gray-400">
                {t('config.form.autonomy_forbidden_paths_label')}
              </label>
              <button
                type="button"
                onClick={() => toggleHelp('autonomy_forbidden_paths')}
                className="text-gray-500 hover:text-blue-400"
              >
                <HelpCircle className="h-4 w-4" />
              </button>
            </div>
            {openHelp === 'autonomy_forbidden_paths' && (
              <p className="text-xs text-gray-500 mt-2">
                {t('config.form.autonomy_forbidden_paths_help')}
              </p>
            )}
            <textarea
              value={forbiddenPathsText}
              onChange={(e) => setForbiddenPathsText(e.target.value)}
              onBlur={() =>
                updateConfig(['autonomy', 'forbidden_paths'], parseList(forbiddenPathsText))
              }
              className="mt-2 w-full min-h-[140px] rounded-lg bg-gray-950 border border-gray-800 px-3 py-2 text-sm text-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
              spellCheck={false}
              autoComplete="off"
            />
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div>
              <label className="text-xs text-gray-400">
                {t('config.form.autonomy_max_actions_label')}
              </label>
              <input
                type="number"
                value={autonomyMaxActionsPerHour}
                onChange={(e) =>
                  updateConfig(['autonomy', 'max_actions_per_hour'], Number(e.target.value))
                }
                className="mt-2 w-full rounded-lg bg-gray-950 border border-gray-800 px-3 py-2 text-sm text-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="text-xs text-gray-400">
                {t('config.form.autonomy_max_cost_label')}
              </label>
              <input
                type="number"
                value={autonomyMaxCostPerDay}
                onChange={(e) =>
                  updateConfig(['autonomy', 'max_cost_per_day_cents'], Number(e.target.value))
                }
                className="mt-2 w-full rounded-lg bg-gray-950 border border-gray-800 px-3 py-2 text-sm text-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="flex items-start justify-between gap-4 border border-gray-800 rounded-lg p-4 bg-gray-950/40">
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-sm text-gray-200">
                    {t('config.form.autonomy_require_approval_label')}
                  </span>
                  <button
                    type="button"
                    onClick={() => toggleHelp('autonomy_require_approval')}
                    className="text-gray-500 hover:text-blue-400"
                  >
                    <HelpCircle className="h-4 w-4" />
                  </button>
                </div>
                {openHelp === 'autonomy_require_approval' && (
                  <p className="text-xs text-gray-500 mt-2">
                    {t('config.form.autonomy_require_approval_help')}
                  </p>
                )}
              </div>
              <label className="inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={autonomyRequireApproval}
                  onChange={(e) =>
                    updateConfig(['autonomy', 'require_approval_for_medium_risk'], e.target.checked)
                  }
                  className="sr-only peer"
                />
                <div className="w-10 h-5 bg-gray-700 rounded-full peer peer-checked:bg-blue-600 transition-colors relative">
                  <div className="absolute left-1 top-1 w-3 h-3 bg-white rounded-full transition-transform peer-checked:translate-x-5" />
                </div>
              </label>
            </div>
            <div className="flex items-start justify-between gap-4 border border-gray-800 rounded-lg p-4 bg-gray-950/40">
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-sm text-gray-200">
                    {t('config.form.autonomy_block_high_risk_label')}
                  </span>
                  <button
                    type="button"
                    onClick={() => toggleHelp('autonomy_block_high_risk')}
                    className="text-gray-500 hover:text-blue-400"
                  >
                    <HelpCircle className="h-4 w-4" />
                  </button>
                </div>
                {openHelp === 'autonomy_block_high_risk' && (
                  <p className="text-xs text-gray-500 mt-2">
                    {t('config.form.autonomy_block_high_risk_help')}
                  </p>
                )}
              </div>
              <label className="inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={autonomyBlockHighRisk}
                  onChange={(e) =>
                    updateConfig(['autonomy', 'block_high_risk_commands'], e.target.checked)
                  }
                  className="sr-only peer"
                />
                <div className="w-10 h-5 bg-gray-700 rounded-full peer peer-checked:bg-blue-600 transition-colors relative">
                  <div className="absolute left-1 top-1 w-3 h-3 bg-white rounded-full transition-transform peer-checked:translate-x-5" />
                </div>
              </label>
            </div>
          </div>
          <div>
            <div className="flex items-center gap-2">
              <label className="text-xs text-gray-400">
                {t('config.form.autonomy_non_cli_excluded_tools_label')}
              </label>
              <button
                type="button"
                onClick={() => toggleHelp('autonomy_non_cli_excluded_tools')}
                className="text-gray-500 hover:text-blue-400"
              >
                <HelpCircle className="h-4 w-4" />
              </button>
            </div>
            {openHelp === 'autonomy_non_cli_excluded_tools' && (
              <p className="text-xs text-gray-500 mt-2">
                {t('config.form.autonomy_non_cli_excluded_tools_help')}
              </p>
            )}
            <textarea
              value={autonomyNonCliExcludedTools}
              onChange={(e) =>
                updateConfig(['autonomy', 'non_cli_excluded_tools'], parseList(e.target.value))
              }
              className="mt-2 w-full min-h-[100px] rounded-lg bg-gray-950 border border-gray-800 px-3 py-2 text-sm text-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
              spellCheck={false}
            />
          </div>
        </div>
        )}

        {activeTab === 'browser' && (
        <div className="bg-gray-900 rounded-xl border border-gray-800 p-5 space-y-4">
          <h3 className="text-sm font-semibold text-gray-200">
            {t('config.form.browser_title')}
          </h3>
          <div className="flex items-start justify-between gap-4 border border-gray-800 rounded-lg p-4 bg-gray-950/40">
            <div>
              <div className="text-sm text-gray-200">
                {t('config.form.browser_enabled_label')}
              </div>
              <p className="text-xs text-gray-500 mt-1">
                {t('config.form.browser_enabled_help')}
              </p>
            </div>
            <label className="inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={browserEnabled}
                onChange={(e) => updateConfig(['browser', 'enabled'], e.target.checked)}
                className="sr-only peer"
              />
              <div className="w-10 h-5 bg-gray-700 rounded-full peer peer-checked:bg-blue-600 transition-colors relative">
                <div className="absolute left-1 top-1 w-3 h-3 bg-white rounded-full transition-transform peer-checked:translate-x-5" />
              </div>
            </label>
          </div>
          <div>
            <div className="flex items-center gap-2">
              <label className="text-xs text-gray-400">
                {t('config.form.browser_allowed_domains_label')}
              </label>
              <button
                type="button"
                onClick={() => toggleHelp('browser_allowed_domains')}
                className="text-gray-500 hover:text-blue-400"
              >
                <HelpCircle className="h-4 w-4" />
              </button>
            </div>
            {openHelp === 'browser_allowed_domains' && (
              <p className="text-xs text-gray-500 mt-2">
                {t('config.form.browser_allowed_domains_help')}
              </p>
            )}
            <textarea
              value={browserAllowedDomainsText}
              onChange={(e) => setBrowserAllowedDomainsText(e.target.value)}
              onBlur={() =>
                updateConfig(['browser', 'allowed_domains'], parseList(browserAllowedDomainsText))
              }
              className="mt-2 w-full min-h-[120px] rounded-lg bg-gray-950 border border-gray-800 px-3 py-2 text-sm text-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
              spellCheck={false}
              autoComplete="off"
            />
          </div>
          <div>
            <label className="text-xs text-gray-400">{t('config.form.browser_backend_label')}</label>
            <div className="relative">
              <select
                value={browserBackend}
                onChange={(e) => updateConfig(['browser', 'backend'], e.target.value)}
                className={selectClassName}
              >
                <option value="agent_browser">
                  {t('config.form.browser_backend_agent_browser')}
                </option>
                <option value="rust_native">
                  {t('config.form.browser_backend_rust_native')}
                </option>
                <option value="computer_use">
                  {t('config.form.browser_backend_computer_use')}
                </option>
                <option value="auto">{t('config.form.browser_backend_auto')}</option>
              </select>
              <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-500" />
            </div>
          </div>
          {browserBackend === 'rust_native' && (
            <>
              <div>
                <label className="text-xs text-gray-400">
                  {t('config.form.browser_native_webdriver_label')}
                </label>
                <input
                  value={browserNativeWebdriverUrl}
                  onChange={(e) => updateConfig(['browser', 'native_webdriver_url'], e.target.value)}
                  className="mt-2 w-full rounded-lg bg-gray-950 border border-gray-800 px-3 py-2 text-sm text-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div className="flex items-start justify-between gap-4 border border-gray-800 rounded-lg p-4 bg-gray-950/40">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-gray-200">
                      {t('config.form.browser_native_headless_label')}
                    </span>
                    <button
                      type="button"
                      onClick={() => toggleHelp('browser_native_headless')}
                      className="text-gray-500 hover:text-blue-400"
                    >
                      <HelpCircle className="h-4 w-4" />
                    </button>
                  </div>
                  {openHelp === 'browser_native_headless' && (
                    <p className="text-xs text-gray-500 mt-2">
                      {t('config.form.browser_native_headless_help')}
                    </p>
                  )}
                </div>
                <label className="inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    checked={browserNativeHeadless}
                    onChange={(e) => updateConfig(['browser', 'native_headless'], e.target.checked)}
                    className="sr-only peer"
                  />
                  <div className="w-10 h-5 bg-gray-700 rounded-full peer peer-checked:bg-blue-600 transition-colors relative">
                    <div className="absolute left-1 top-1 w-3 h-3 bg-white rounded-full transition-transform peer-checked:translate-x-5" />
                  </div>
                </label>
              </div>
            </>
          )}
          {browserBackend === 'computer_use' && (
            <>
              <div className="flex items-start justify-between gap-4 border border-gray-800 rounded-lg p-4 bg-gray-950/40">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-gray-200">
                      {t('config.form.computer_use_enabled_label')}
                    </span>
                    <button
                      type="button"
                      onClick={() => toggleHelp('computer_use_enabled')}
                      className="text-gray-500 hover:text-blue-400"
                    >
                      <HelpCircle className="h-4 w-4" />
                    </button>
                  </div>
                  {openHelp === 'computer_use_enabled' && (
                    <p className="text-xs text-gray-500 mt-2">
                      {t('config.form.computer_use_enabled_help')}
                    </p>
                  )}
                </div>
                <label className="inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    checked={computerUseEnabled}
                    onChange={(e) =>
                      updateConfig(['browser', 'computer_use', 'enabled'], e.target.checked)
                    }
                    className="sr-only peer"
                  />
                  <div className="w-10 h-5 bg-gray-700 rounded-full peer peer-checked:bg-blue-600 transition-colors relative">
                    <div className="absolute left-1 top-1 w-3 h-3 bg-white rounded-full transition-transform peer-checked:translate-x-5" />
                  </div>
                </label>
              </div>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <div>
                  <label className="text-xs text-gray-400">
                    {t('config.form.computer_use_endpoint_label')}
                  </label>
                  <input
                    value={computerUseEndpoint}
                    onChange={(e) =>
                      updateConfig(['browser', 'computer_use', 'endpoint'], e.target.value)
                    }
                    className="mt-2 w-full rounded-lg bg-gray-950 border border-gray-800 px-3 py-2 text-sm text-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="text-xs text-gray-400">
                    {t('config.form.computer_use_timeout_label')}
                  </label>
                  <input
                    type="number"
                    value={computerUseTimeout}
                    onChange={(e) =>
                      updateConfig(['browser', 'computer_use', 'timeout_ms'], Number(e.target.value))
                    }
                    className="mt-2 w-full rounded-lg bg-gray-950 border border-gray-800 px-3 py-2 text-sm text-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>
              <div className="flex items-start justify-between gap-4 border border-gray-800 rounded-lg p-4 bg-gray-950/40">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-gray-200">
                      {t('config.form.computer_use_allow_remote_label')}
                    </span>
                    <button
                      type="button"
                      onClick={() => toggleHelp('computer_use_allow_remote')}
                      className="text-gray-500 hover:text-blue-400"
                    >
                      <HelpCircle className="h-4 w-4" />
                    </button>
                  </div>
                  {openHelp === 'computer_use_allow_remote' && (
                    <p className="text-xs text-gray-500 mt-2">
                      {t('config.form.computer_use_allow_remote_help')}
                    </p>
                  )}
                </div>
                <label className="inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    checked={computerUseAllowRemote}
                    onChange={(e) =>
                      updateConfig(
                        ['browser', 'computer_use', 'allow_remote_endpoint'],
                        e.target.checked,
                      )
                    }
                    className="sr-only peer"
                  />
                  <div className="w-10 h-5 bg-gray-700 rounded-full peer peer-checked:bg-blue-600 transition-colors relative">
                    <div className="absolute left-1 top-1 w-3 h-3 bg-white rounded-full transition-transform peer-checked:translate-x-5" />
                  </div>
                </label>
              </div>
            </>
          )}
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
                <div className="w-10 h-5 bg-gray-700 rounded-full peer peer-checked:bg-blue-600 transition-colors relative">
                  <div className="absolute left-1 top-1 w-3 h-3 bg-white rounded-full transition-transform peer-checked:translate-x-5" />
                </div>
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
                <div className="w-10 h-5 bg-gray-700 rounded-full peer peer-checked:bg-blue-600 transition-colors relative">
                  <div className="absolute left-1 top-1 w-3 h-3 bg-white rounded-full transition-transform peer-checked:translate-x-5" />
                </div>
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
              <div className="w-10 h-5 bg-gray-700 rounded-full peer peer-checked:bg-blue-600 transition-colors relative">
                <div className="absolute left-1 top-1 w-3 h-3 bg-white rounded-full transition-transform peer-checked:translate-x-5" />
              </div>
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
              <div className="w-10 h-5 bg-gray-700 rounded-full peer peer-checked:bg-blue-600 transition-colors relative">
                <div className="absolute left-1 top-1 w-3 h-3 bg-white rounded-full transition-transform peer-checked:translate-x-5" />
              </div>
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
