import { useEffect, useState } from 'react';
import {
  Wrench,
  Search,
  ChevronDown,
  ChevronRight,
  Terminal,
  Package,
  ShieldAlert,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { ToolSpec, CliTool } from '@/types/api';
import { getCliTools, getTools } from '@/lib/api';
import { useNotify } from '@/hooks/useNotify';

export default function Tools() {
  const { t } = useTranslation();
  const notify = useNotify();
  const [tools, setTools] = useState<ToolSpec[]>([]);
  const [cliTools, setCliTools] = useState<CliTool[]>([]);
  const [search, setSearch] = useState('');
  const [expandedTool, setExpandedTool] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const getToolDisplayName = (name: string) =>
    t(`tools.meta.${name}.name`, { defaultValue: name });
  const getToolDisplayDescription = (name: string, description: string) =>
    t(`tools.meta.${name}.description`, { defaultValue: description });

  useEffect(() => {
    Promise.all([getTools(), getCliTools()])
      .then(([toolSpecs, discoveredCli]) => {
        setTools(toolSpecs);
        setCliTools(discoveredCli);
      })
      .catch((err) => {
        const message = err instanceof Error ? err.message : t('tools.load_failed');
        setError(message);
        notify.error(message, { key: 'tools:load' });
      })
      .finally(() => setLoading(false));
  }, [notify, t]);

  const filtered = tools.filter(
    (tool) =>
      getToolDisplayName(tool.name).toLowerCase().includes(search.toLowerCase()) ||
      getToolDisplayDescription(tool.name, tool.description)
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

  if (error) {
    return (
      <div className="p-6">
        <div className="rounded-lg bg-red-900/30 border border-red-700 p-4 text-red-300">
          {t('tools.load_failed')}: {error}
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
      <div className="rounded-xl border border-gray-800 bg-gray-900/80 p-5">
        <div className="flex items-center gap-2">
          <Wrench className="h-5 w-5 text-blue-400" />
          <h1 className="text-base font-semibold text-white">{t('tools.title')}</h1>
        </div>
        <p className="mt-2 max-w-3xl text-sm text-gray-400">{t('tools.page_hint')}</p>
      </div>

      <div className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-500" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t('tools.search')}
          className="w-full bg-gray-900 border border-gray-700 rounded-lg pl-10 pr-4 py-2.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
        />
      </div>

      {/* Agent Tools Grid */}
      <div>
        <div className="flex items-center gap-2 mb-4">
          <Wrench className="h-5 w-5 text-blue-400" />
          <h2 className="text-base font-semibold text-white">
            {t('tools.agent_tools')} ({filtered.length})
          </h2>
        </div>
        <p className="mb-4 max-w-3xl text-sm text-gray-400">{t('tools.agent_tools_hint')}</p>

        {filtered.length === 0 ? (
          <p className="text-sm text-gray-500">{t('tools.no_match')}</p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {filtered.map((tool) => {
              const isExpanded = expandedTool === tool.name;
              return (
                <div
                  key={tool.name}
                  className="bg-gray-900 rounded-xl border border-gray-800 overflow-hidden"
                >
                  <button
                    onClick={() =>
                      setExpandedTool(isExpanded ? null : tool.name)
                    }
                    className="w-full text-left p-4 hover:bg-gray-800/50 transition-colors"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <Package className="mt-0.5 h-4 w-4 shrink-0 text-blue-400" />
                        <h3 className="text-sm font-semibold text-white truncate">
                          {getToolDisplayName(tool.name)}
                        </h3>
                      </div>
                      {isExpanded ? (
                        <ChevronDown className="h-4 w-4 shrink-0 text-gray-400" />
                      ) : (
                        <ChevronRight className="h-4 w-4 shrink-0 text-gray-400" />
                      )}
                    </div>
                    <p className="text-sm text-gray-400 mt-2 line-clamp-2">
                      {getToolDisplayDescription(tool.name, tool.description)}
                    </p>
                  </button>

                  {isExpanded && tool.parameters && (
                    <div className="border-t border-gray-800 p-4">
                      <p className="text-xs text-gray-500 mb-2 font-medium uppercase tracking-wider">
                        {t('tools.parameter_schema')}
                      </p>
                      <pre className="text-xs text-gray-300 bg-gray-950 rounded-lg p-3 overflow-x-auto max-h-64 overflow-y-auto">
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

      {/* CLI Tools Section */}
      {filteredCli.length > 0 && (
        <div>
          <div className="flex items-center gap-2 mb-4">
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

          <div className="bg-gray-900 rounded-xl border border-gray-800 overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-800">
                  <th className="text-left px-4 py-3 text-gray-400 font-medium">
                    {t('common.name')}
                  </th>
                  <th className="text-left px-4 py-3 text-gray-400 font-medium">
                    {t('tools.path')}
                  </th>
                  <th className="text-left px-4 py-3 text-gray-400 font-medium">
                    {t('tools.version')}
                  </th>
                  <th className="text-left px-4 py-3 text-gray-400 font-medium">
                    {t('memory.category')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {filteredCli.map((tool) => (
                  <tr
                    key={tool.name}
                    className="border-b border-gray-800/50 hover:bg-gray-800/30 transition-colors"
                  >
                    <td className="px-4 py-3 text-white font-medium">{tool.name}</td>
                    <td className="px-4 py-3 text-gray-400 font-mono text-xs truncate max-w-[200px]">
                      {tool.path}
                    </td>
                    <td className="px-4 py-3 text-gray-400">{tool.version ?? '-'}</td>
                    <td className="px-4 py-3">
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-gray-800 text-gray-300 capitalize">
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
