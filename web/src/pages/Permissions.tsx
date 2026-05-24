import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Globe,
  Package,
  RotateCcw,
  Save,
  ShieldCheck,
  Terminal,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { getConfigForm, getTools, putConfigForm } from '@/lib/api';
import { useNotify } from '@/hooks/useNotify';
import type { ToolSpec } from '@/types/api';

type ConfigForm = Record<string, unknown>;

const SHELL_APPROVAL_PREFIX = 'shell:';
const BUILTIN_TOOL_APPROVAL_EXCLUDE = new Set(['shell', 'browser', 'browser_open']);
const DEFAULT_SHELL_APPROVAL_COMMANDS = [
  'rm',
  'sudo',
  'su',
  'dd',
  'mkfs',
  'shutdown',
  'reboot',
  'halt',
  'poweroff',
  'curl',
  'wget',
  'ssh',
  'scp',
  'nc',
  'ncat',
  'netcat',
  'ftp',
  'telnet',
  'mount',
  'umount',
  'iptables',
  'ufw',
  'firewall-cmd',
  'useradd',
  'userdel',
  'usermod',
  'passwd',
];
const parseList = (raw: string) =>
  raw
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

const unique = (values: string[]) => Array.from(new Set(values));

const formatShellApprovalCommands = (value: unknown) =>
  Array.isArray(value)
    ? value
        .filter((entry): entry is string => typeof entry === 'string')
        .filter((entry) => entry.startsWith(SHELL_APPROVAL_PREFIX))
        .map((entry) => entry.slice(SHELL_APPROVAL_PREFIX.length))
        .join('\n')
    : '';

const extractBuiltinToolApprovals = (value: unknown) =>
  Array.isArray(value)
    ? value
        .filter((entry): entry is string => typeof entry === 'string')
        .filter(
          (entry) =>
            !entry.startsWith(SHELL_APPROVAL_PREFIX) && !BUILTIN_TOOL_APPROVAL_EXCLUDE.has(entry),
        )
    : [];

export default function Permissions() {
  const { t } = useTranslation();
  const notify = useNotify();
  const [config, setConfig] = useState<ConfigForm | null>(null);
  const [tools, setTools] = useState<ToolSpec[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [shellApprovalCommandsText, setShellApprovalCommandsText] = useState('');
  const [builtinToolApprovals, setBuiltinToolApprovals] = useState<string[]>([]);
  const [activeSupervisedTab, setActiveSupervisedTab] = useState<'tools' | 'shell'>('tools');

  const getToolDisplayName = (name: string) =>
    t(`tools.meta.${name}.name`, { defaultValue: name });
  const getToolDisplayDescription = (name: string, description: string) =>
    t(`tools.meta.${name}.description`, { defaultValue: description });

  useEffect(() => {
    const load = async () => {
      try {
        const [formData, toolSpecs] = await Promise.all([getConfigForm<ConfigForm>(), getTools()]);
        setConfig(formData);
        setTools(toolSpecs);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : t('config.error');
        setError(message);
        notify.error(message, { key: 'permissions:load' });
      } finally {
        setLoading(false);
      }
    };

    void load();
  }, [notify, t]);

  useEffect(() => {
    if (!config) return;
    const autonomyConfig = (config.autonomy as Record<string, unknown> | undefined) ?? {};
    setShellApprovalCommandsText(formatShellApprovalCommands(autonomyConfig.always_ask));
    setBuiltinToolApprovals(extractBuiltinToolApprovals(autonomyConfig.always_ask));
  }, [config]);

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
      const lastKey = path[path.length - 1] as string;
      cursor[lastKey] = value;
      return next;
    });
  };

  const handleSave = async () => {
    if (!config) return;
    setSaving(true);
    setError(null);
    try {
      const nextConfig = structuredClone(config) as ConfigForm;
      const autonomyConfig =
        ((nextConfig.autonomy as Record<string, unknown> | undefined) ?? {}) as Record<
          string,
          unknown
        >;
      const existingAlwaysAsk = Array.isArray(autonomyConfig.always_ask)
        ? autonomyConfig.always_ask.filter((entry): entry is string => typeof entry === 'string')
        : [];
      const selectableToolNames = new Set(
        tools
          .map((tool) => tool.name)
          .filter((name) => !BUILTIN_TOOL_APPROVAL_EXCLUDE.has(name)),
      );
      const nonShellAlwaysAsk = existingAlwaysAsk.filter(
        (entry) => !entry.startsWith(SHELL_APPROVAL_PREFIX),
      );
      const preservedHiddenToolApprovals = nonShellAlwaysAsk.filter(
        (entry) => !selectableToolNames.has(entry) && !BUILTIN_TOOL_APPROVAL_EXCLUDE.has(entry),
      );
      const shellAlwaysAsk = parseList(shellApprovalCommandsText).map(
        (entry) => `${SHELL_APPROVAL_PREFIX}${entry}`,
      );
      autonomyConfig.always_ask = unique([
        ...preservedHiddenToolApprovals,
        ...builtinToolApprovals.filter((entry) => selectableToolNames.has(entry)),
        ...shellAlwaysAsk,
      ]);
      nextConfig.autonomy = autonomyConfig;
      await putConfigForm(nextConfig);
      setConfig(nextConfig);
      notify.success(t('config.saved'), { key: 'permissions:save:success' });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : t('config.error');
      setError(message);
      notify.error(message, { key: 'permissions:save:error' });
    } finally {
      setSaving(false);
    }
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

  const browserConfig = (config?.browser as Record<string, unknown> | undefined) ?? {};
  const browserEnabled = browserConfig.enabled !== false;
  const builtinApprovalTools = useMemo(
    () =>
      [...tools]
        .filter((tool) => !BUILTIN_TOOL_APPROVAL_EXCLUDE.has(tool.name))
        .sort((a, b) => getToolDisplayName(a.name).localeCompare(getToolDisplayName(b.name))),
    [tools, t],
  );
  const supervisedTabs = [
    {
      key: 'tools' as const,
      label: t('permissions.supervised_tab_tools'),
      icon: Package,
    },
    {
      key: 'shell' as const,
      label: t('permissions.supervised_tab_shell'),
      icon: Terminal,
    },
  ];

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
  const renderToolCards = (items: ToolSpec[]) => {
    if (items.length === 0) {
      return (
        <div className="rounded-lg border border-gray-800 bg-gray-950/40 px-4 py-3 text-sm text-gray-400">
          {t('permissions.tool_group_empty')}
        </div>
      );
    }

    return (
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
        {items.map((tool) => {
          const selected = builtinToolApprovals.includes(tool.name);
          return (
            <button
              key={tool.name}
              type="button"
              onClick={() => toggleBuiltinToolApproval(tool.name)}
              className={`rounded-xl border p-4 text-left transition-colors ${
                selected
                  ? 'border-amber-500/40 bg-amber-500/10'
                  : 'border-emerald-500/30 bg-emerald-500/5 hover:border-emerald-500/40 hover:bg-emerald-500/10'
              }`}
            >
              <div className="min-w-0">
                <div className="text-sm font-semibold text-white">
                  {getToolDisplayName(tool.name)}
                </div>
                <div className="mt-2 text-sm leading-6 text-gray-400">
                  {getToolDisplayDescription(tool.name, tool.description)}
                </div>
              </div>
              <div className="mt-4 flex items-center justify-between gap-3">
                <span className="font-mono text-xs text-gray-500">{tool.name}</span>
                <span
                  className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
                    selected
                      ? 'bg-amber-500/10 text-amber-200'
                      : 'bg-emerald-500/10 text-emerald-200'
                  }`}
                >
                  {selected
                    ? t('permissions.tool_card_requires_approval')
                    : t('permissions.tool_card_allowed_by_default')}
                </span>
              </div>
            </button>
          );
        })}
      </div>
    );
  };
  const toggleBuiltinToolApproval = (toolName: string) => {
    setBuiltinToolApprovals((prev) =>
      prev.includes(toolName) ? prev.filter((entry) => entry !== toolName) : [...prev, toolName],
    );
  };

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-emerald-500/20 bg-emerald-500/10 text-emerald-300">
            <ShieldCheck className="h-5 w-5" />
          </div>
          <h2 className="text-base font-semibold text-white">{t('permissions.title')}</h2>
        </div>
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-blue-700 disabled:opacity-50"
        >
          <Save className="h-4 w-4" />
          {saving ? t('config.saving') : t('common.save')}
        </button>
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded-lg border border-red-700 bg-red-900/30 p-3">
          <AlertTriangle className="h-4 w-4 shrink-0 text-red-400" />
          <span className="text-sm text-red-300">{error}</span>
        </div>
      )}

      <div className="space-y-6">
        <div className="space-y-4 rounded-xl border border-gray-800 bg-gray-900 p-5">
          <div className="flex items-start justify-between gap-4">
            <h3 className="text-sm font-semibold text-gray-200">{t('permissions.browser_title')}</h3>
            <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-blue-500/20 bg-blue-500/10 text-blue-300">
              <Globe className="h-5 w-5" />
            </div>
          </div>

          <label className="flex cursor-pointer items-center justify-between gap-4 rounded-xl border border-gray-800 bg-gray-950/40 px-4 py-3">
            <div className="text-sm font-medium text-gray-200">{t('permissions.browser_enabled_label')}</div>
            <span className="relative inline-flex items-center">
              <input
                type="checkbox"
                checked={browserEnabled}
                onChange={(e) => updateConfig(['browser', 'enabled'], e.target.checked)}
                className="peer sr-only"
              />
              {renderSwitch(browserEnabled)}
            </span>
          </label>
        </div>

        <div className="space-y-4 rounded-xl border border-gray-800 bg-gray-900 p-5">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-sm font-semibold text-gray-200">
              {t('permissions.supervised_title')}
            </h3>
          </div>

          <div className="inline-flex rounded-lg border border-gray-800 bg-gray-950/60 p-1">
            {supervisedTabs.map((tab) => {
              const Icon = tab.icon;
              const active = activeSupervisedTab === tab.key;
              return (
                <button
                  key={tab.key}
                  type="button"
                  onClick={() => setActiveSupervisedTab(tab.key)}
                  className={`inline-flex items-center gap-2 rounded-md px-3 py-2 text-xs transition-colors ${
                    active
                      ? 'bg-blue-600 text-white'
                      : 'text-gray-300 hover:bg-gray-900 hover:text-white'
                  }`}
                >
                  <Icon className="h-3.5 w-3.5" />
                  {tab.label}
                </button>
              );
            })}
          </div>

          {activeSupervisedTab === 'tools' ? (
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-3">
                <h4 className="text-xs font-semibold uppercase tracking-wider text-gray-400">
                  {t('permissions.supervised_tab_tools')}
                </h4>
                <span className="rounded-full bg-gray-800 px-2 py-0.5 text-[11px] text-gray-300">
                  {builtinApprovalTools.length}
                </span>
              </div>
              {renderToolCards(builtinApprovalTools)}
            </div>
          ) : (
            <div className="space-y-4 rounded-xl border border-gray-800 bg-gray-950/30 p-4">
              <div className="flex items-center justify-between gap-3">
                <h4 className="text-sm font-semibold text-gray-200">
                  {t('permissions.shell_approval_title')}
                </h4>
                <button
                  type="button"
                  onClick={() => setShellApprovalCommandsText(DEFAULT_SHELL_APPROVAL_COMMANDS.join('\n'))}
                  className="inline-flex items-center gap-2 rounded-lg border border-gray-800 bg-gray-950/60 px-3 py-1.5 text-xs text-gray-300 transition-colors hover:border-gray-700 hover:bg-gray-900 hover:text-white"
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                  {t('config.reset')}
                </button>
              </div>

              <div>
                <label className="text-xs text-gray-400">
                  {t('permissions.shell_approval_label')}
                </label>
                <textarea
                  value={shellApprovalCommandsText}
                  onChange={(e) => setShellApprovalCommandsText(e.target.value)}
                  className="mt-2 min-h-[180px] w-full rounded-lg border border-gray-800 bg-gray-950 px-3 py-2 text-sm text-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  spellCheck={false}
                  autoComplete="off"
                  placeholder={t('permissions.shell_approval_placeholder')}
                />
              </div>
            </div>
          )}
        </div>

      </div>
    </div>
  );
}
