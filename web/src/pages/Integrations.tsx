import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Puzzle,
  Check,
  Zap,
  Clock,
  Search,
  Wrench,
  ChevronDown,
  ChevronRight,
  Terminal,
  Package,
  ShieldAlert,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { CliTool, Integration, ToolSpec } from '@/types/api';
import { getCliTools, getIntegrations, getTools } from '@/lib/api';
import { useNotify } from '@/hooks/useNotify';
type WorkspaceTab = 'integrations' | 'capabilities' | 'commands';

function statusBadge(status: Integration['status'], t: (key: string) => string) {
  switch (status) {
    case 'Active':
      return {
        icon: Check,
        label: t('integrations.active'),
        classes: 'bg-green-900/40 text-green-400 border-green-700/50',
      };
    case 'Available':
      return {
        icon: Zap,
        label: t('integrations.available'),
        classes: 'bg-blue-900/40 text-blue-400 border-blue-700/50',
      };
    case 'ComingSoon':
      return {
        icon: Clock,
        label: t('integrations.coming_soon'),
        classes: 'bg-gray-800 text-gray-400 border-gray-700',
      };
  }
}

function categoryLabel(category: string, t: (key: string) => string) {
  if (category === 'all') {
    return t('integrations.all');
  }

  return t(`integrations.categories.${category}`);
}

export default function Integrations() {
  const { t } = useTranslation();
  const notify = useNotify();
  const [searchParams, setSearchParams] = useSearchParams();
  const [integrations, setIntegrations] = useState<Integration[]>([]);
  const [tools, setTools] = useState<ToolSpec[]>([]);
  const [cliTools, setCliTools] = useState<CliTool[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeCategory, setActiveCategory] = useState<string>('all');
  const [search, setSearch] = useState('');
  const [expandedTool, setExpandedTool] = useState<string | null>(null);

  const activeTab = useMemo<WorkspaceTab>(() => {
    const current = searchParams.get('tab');
    if (current === 'capabilities' || current === 'commands') {
      return current;
    }
    return 'integrations';
  }, [searchParams]);

  useEffect(() => {
    Promise.all([getIntegrations(), getTools(), getCliTools()])
      .then(([integrationSpecs, toolSpecs, discoveredCli]) => {
        setIntegrations(integrationSpecs);
        setTools(toolSpecs);
        setCliTools(discoveredCli);
      })
      .catch((err) => {
        const message = err instanceof Error ? err.message : t('integrations.load_failed');
        setError(message);
        notify.error(message, { key: 'integrations:load' });
      })
      .finally(() => setLoading(false));
  }, []);

  const categories = [
    'all',
    ...Array.from(new Set(integrations.map((i) => i.category))).sort(),
  ];

  const filtered =
    activeCategory === 'all'
      ? integrations
      : integrations.filter((i) => i.category === activeCategory);

  const filteredTools = tools.filter(
    (tool) =>
      t(`tools.meta.${tool.name}.name`, { defaultValue: tool.name })
        .toLowerCase()
        .includes(search.toLowerCase()) ||
      t(`tools.meta.${tool.name}.description`, { defaultValue: tool.description })
        .toLowerCase()
        .includes(search.toLowerCase()) ||
      tool.name.toLowerCase().includes(search.toLowerCase()) ||
      tool.description.toLowerCase().includes(search.toLowerCase()),
  );

  const filteredCli = cliTools.filter(
    (tool) =>
      tool.name.toLowerCase().includes(search.toLowerCase()) ||
      tool.category.toLowerCase().includes(search.toLowerCase()),
  );

  const handleTabChange = (tab: WorkspaceTab) => {
    const next = new URLSearchParams(searchParams);
    if (tab === 'integrations') {
      next.delete('tab');
    } else {
      next.set('tab', tab);
    }
    setSearchParams(next, { replace: true });
  };

  // Group by category for display
  const grouped = filtered.reduce<Record<string, Integration[]>>((acc, item) => {
    const key = item.category;
    if (!acc[key]) acc[key] = [];
    acc[key].push(item);
    return acc;
  }, {});

  if (error) {
    return (
      <div className="p-6">
        <div className="rounded-lg bg-red-900/30 border border-red-700 p-4 text-red-300">
          {t('integrations.load_failed')}: {error}
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-2 border-blue-500 border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div className="inline-flex flex-wrap items-center gap-1 rounded-xl border border-gray-800 bg-gray-900/80 p-1">
        {(['integrations', 'capabilities', 'commands'] as WorkspaceTab[]).map((tab) => (
          <button
            key={tab}
            onClick={() => handleTabChange(tab)}
            className={`rounded-lg px-4 py-2 text-sm font-semibold transition-colors ${
              activeTab === tab
                ? 'bg-blue-600 text-white shadow-sm shadow-blue-950/40'
                : 'text-gray-400 hover:bg-gray-800/80 hover:text-white'
            }`}
          >
            {t(`integrations.tabs.${tab}`)}
          </button>
        ))}
      </div>

      {activeTab !== 'integrations' && (
        <div className="relative max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-500" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={
              activeTab === 'capabilities'
                ? t('tools.search')
                : t('integrations.commands_search')
            }
            className="w-full rounded-lg border border-gray-700 bg-gray-900 py-2.5 pl-10 pr-4 text-sm text-white placeholder-gray-500 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
      )}

      {activeTab === 'integrations' &&
        (Object.keys(grouped).length === 0 ? (
          <div className="bg-gray-900 rounded-xl border border-gray-800 p-8 text-center">
            <Puzzle className="mx-auto mb-3 h-10 w-10 text-gray-600" />
            <p className="text-gray-400">{t('integrations.empty')}</p>
          </div>
        ) : (
          <>
            <div className="flex flex-wrap gap-2">
              {categories.map((cat) => (
                <button
                  key={cat}
                  onClick={() => setActiveCategory(cat)}
                  className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                    activeCategory === cat
                      ? 'border-blue-500/60 bg-blue-500/15 text-blue-200'
                      : 'border-gray-700 bg-gray-900 text-gray-400 hover:border-gray-600 hover:text-white'
                  }`}
                >
                  {categoryLabel(cat, t)}
                </button>
              ))}
            </div>

            {Object.entries(grouped)
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([category, items]) => (
                <div key={category}>
                  <h3 className="mb-3 text-sm font-semibold uppercase tracking-wider text-gray-400">
                    {categoryLabel(category, t)}
                  </h3>
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
                    {items.map((integration) => {
                      const badge = statusBadge(integration.status, t);
                      const BadgeIcon = badge.icon;
                      return (
                        <div
                          key={integration.name}
                          className="rounded-xl border border-gray-800 bg-gray-900 p-5 transition-colors hover:border-gray-700"
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <h4 className="truncate text-sm font-semibold text-white">
                                {integration.name}
                              </h4>
                              <p className="mt-1 line-clamp-2 text-sm text-gray-400">
                                {integration.description}
                              </p>
                            </div>
                            <span
                              className={`inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-1 text-xs font-medium ${badge.classes}`}
                            >
                              <BadgeIcon className="h-3 w-3" />
                              {badge.label}
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
          </>
        ))}

      {activeTab === 'capabilities' && (
        <div className="space-y-6">
          <div>
            <div className="mb-4 flex items-center gap-2">
              <Wrench className="h-5 w-5 text-blue-400" />
              <h2 className="text-base font-semibold text-white">
                {t('tools.agent_tools')} ({filteredTools.length})
              </h2>
            </div>
            <p className="mb-4 max-w-3xl text-sm text-gray-400">{t('tools.agent_tools_hint')}</p>

            {filteredTools.length === 0 ? (
              <p className="text-sm text-gray-500">{t('tools.no_match')}</p>
            ) : (
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
                {filteredTools.map((tool) => {
                  const isExpanded = expandedTool === tool.name;
                  return (
                    <div
                      key={tool.name}
                      className="overflow-hidden rounded-xl border border-gray-800 bg-gray-900"
                    >
                      <button
                        onClick={() => setExpandedTool(isExpanded ? null : tool.name)}
                        className="w-full p-4 text-left transition-colors hover:bg-gray-800/50"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex min-w-0 items-center gap-2">
                            <Package className="mt-0.5 h-4 w-4 shrink-0 text-blue-400" />
                            <h3 className="truncate text-sm font-semibold text-white">
                              {t(`tools.meta.${tool.name}.name`, { defaultValue: tool.name })}
                            </h3>
                          </div>
                          {isExpanded ? (
                            <ChevronDown className="h-4 w-4 shrink-0 text-gray-400" />
                          ) : (
                            <ChevronRight className="h-4 w-4 shrink-0 text-gray-400" />
                          )}
                        </div>
                        <p className="mt-2 line-clamp-2 text-sm text-gray-400">
                          {t(`tools.meta.${tool.name}.description`, {
                            defaultValue: tool.description,
                          })}
                        </p>
                      </button>

                      {isExpanded && tool.parameters && (
                        <div className="border-t border-gray-800 p-4">
                          <p className="mb-2 text-xs font-medium uppercase tracking-wider text-gray-500">
                            {t('tools.parameter_schema')}
                          </p>
                          <pre className="max-h-64 overflow-x-auto overflow-y-auto rounded-lg bg-gray-950 p-3 text-xs text-gray-300">
                            {JSON.stringify(tool.parameters, null, 2)}
                          </pre>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {activeTab === 'commands' && (
        <div>
          <div className="mb-4 flex items-center gap-2">
            <Terminal className="h-5 w-5 text-green-400" />
            <h2 className="text-base font-semibold text-white">
              {t('tools.cli_tools')} ({filteredCli.length})
            </h2>
          </div>
          <div className="mb-4 flex items-start gap-3 rounded-xl border border-yellow-800/50 bg-yellow-950/20 p-4">
            <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-yellow-400" />
            <div className="min-w-0">
              <p className="text-sm font-medium text-yellow-200">{t('tools.cli_policy_hint')}</p>
            </div>
          </div>

          <div className="overflow-hidden rounded-xl border border-gray-800 bg-gray-900">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-800">
                  <th className="px-4 py-3 text-left font-medium text-gray-400">
                    {t('common.name')}
                  </th>
                  <th className="px-4 py-3 text-left font-medium text-gray-400">
                    {t('tools.path')}
                  </th>
                  <th className="px-4 py-3 text-left font-medium text-gray-400">
                    {t('tools.version')}
                  </th>
                  <th className="px-4 py-3 text-left font-medium text-gray-400">
                    {t('memory.category')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {filteredCli.map((tool) => (
                  <tr
                    key={tool.name}
                    className="border-b border-gray-800/50 transition-colors hover:bg-gray-800/30"
                  >
                    <td className="px-4 py-3 font-medium text-white">{tool.name}</td>
                    <td className="max-w-[200px] truncate px-4 py-3 font-mono text-xs text-gray-400">
                      {tool.path}
                    </td>
                    <td className="px-4 py-3 text-gray-400">{tool.version ?? '-'}</td>
                    <td className="px-4 py-3">
                      <span className="inline-flex items-center rounded-full bg-gray-800 px-2 py-0.5 text-xs font-medium capitalize text-gray-300">
                        {tool.category}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
