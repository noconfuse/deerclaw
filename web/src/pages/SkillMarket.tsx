import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Download,
  Search,
  ShieldAlert,
  Store,
  ShieldCheck,
  Trash2,
  Package,
  ExternalLink,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { SkillMarketItem, SkillSpec, SkillAuditResult } from '@/types/api';
import {
  getSkillMarket,
  getSkills,
  installSkillFromMarket,
  installSkill,
  auditSkill,
  removeSkill,
} from '@/lib/api';
import { useNotify } from '@/hooks/useNotify';

export default function SkillMarket() {
  const { t } = useTranslation();
  const notify = useNotify();
  const PAGE_SIZE = 12;
  const [items, setItems] = useState<SkillMarketItem[]>([]);
  const [skills, setSkills] = useState<SkillSpec[]>([]);
  const [installedNames, setInstalledNames] = useState<Set<string>>(new Set());
  const [activeTab, setActiveTab] = useState<'market' | 'installed'>('market');
  const [search, setSearch] = useState('');
  const [marketPage, setMarketPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [installingId, setInstallingId] = useState<string | null>(null);
  const [riskOpen, setRiskOpen] = useState(false);
  const [acknowledgeRisk, setAcknowledgeRisk] = useState(false);
  const [selectedItem, setSelectedItem] = useState<SkillMarketItem | null>(null);
  const [skillSource, setSkillSource] = useState('');
  const [auditSource, setAuditSource] = useState('');
  const [auditResult, setAuditResult] = useState<SkillAuditResult | null>(null);
  const [installingSource, setInstallingSource] = useState(false);
  const [auditing, setAuditing] = useState(false);
  const [removingSkill, setRemovingSkill] = useState<string | null>(null);
  const getMarketName = (item: SkillMarketItem) =>
    t(`skill_market.items.${item.id}.name`, { defaultValue: item.name });
  const getMarketDescription = (item: SkillMarketItem) =>
    t(`skill_market.items.${item.id}.description`, { defaultValue: item.description });

  useEffect(() => {
    Promise.all([getSkillMarket(), getSkills()])
      .then(([market, skills]) => {
        setItems(market);
        setSkills(skills);
        setInstalledNames(new Set(skills.map((s) => s.name)));
      })
      .catch((err) => {
        const message = err instanceof Error ? err.message : t('skill_market.load_failed');
        setError(message);
        notify.error(message, { key: 'skill-market:load' });
      })
      .finally(() => setLoading(false));
  }, [t]);

  const refreshSkills = async () => {
    const refreshed = await getSkills();
    setSkills(refreshed);
    setInstalledNames(new Set(refreshed.map((s) => s.name)));
  };

  const filteredItems = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) {
      return items;
    }
    return items.filter(
      (item) =>
        getMarketName(item).toLowerCase().includes(q) ||
        getMarketDescription(item).toLowerCase().includes(q) ||
        item.publisher.toLowerCase().includes(q) ||
        item.tags.some((tag) => tag.toLowerCase().includes(q)),
    );
  }, [items, search, t]);

  const filteredSkills = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) {
      return skills;
    }
    return skills.filter(
      (skill) =>
        skill.name.toLowerCase().includes(q) ||
        skill.description.toLowerCase().includes(q) ||
        skill.tools.some((tool) => tool.name.toLowerCase().includes(q)),
    );
  }, [skills, search]);

  const totalMarketPages = Math.max(1, Math.ceil(filteredItems.length / PAGE_SIZE));
  const clampedMarketPage = Math.min(marketPage, totalMarketPages);
  const pagedItems = useMemo(() => {
    const start = (clampedMarketPage - 1) * PAGE_SIZE;
    return filteredItems.slice(start, start + PAGE_SIZE);
  }, [clampedMarketPage, filteredItems, PAGE_SIZE]);

  useEffect(() => {
    setMarketPage(1);
  }, [search, items, activeTab]);

  const getClawHubDetailUrl = (item: SkillMarketItem) => {
    if (!item.source.startsWith('clawhub://')) {
      return null;
    }
    const slug = item.source.replace('clawhub://', '').split(/[?#]/)[0]?.trim();
    if (!slug) {
      return null;
    }
    return `https://clawhub.ai/skills/${encodeURIComponent(slug)}`;
  };

  const openExternalUrl = (url: string) => {
    const opened = window.open(url, '_blank', 'noopener,noreferrer');
    if (!opened) {
      window.location.assign(url);
    }
  };

  const openInstallRisk = (item: SkillMarketItem) => {
    setSelectedItem(item);
    setAcknowledgeRisk(false);
    setRiskOpen(true);
  };

  const closeInstallRisk = () => {
    setRiskOpen(false);
    setAcknowledgeRisk(false);
    setSelectedItem(null);
  };

  const handleInstall = async () => {
    if (!selectedItem) {
      return;
    }
    setInstallingId(selectedItem.id);
    try {
      const result = await installSkillFromMarket(selectedItem.id, acknowledgeRisk);
      await refreshSkills();
      notify.success(
        t('skill_market.install_success', {
          name: getMarketName(selectedItem),
          dir: result.installed_dir,
          files: result.files_scanned,
        }),
        { key: 'skill-market:install:success' },
      );
      closeInstallRisk();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : t('skill_market.install_failed');
      notify.error(message, { key: 'skill-market:install:error' });
    } finally {
      setInstallingId(null);
    }
  };

  const handleInstallSource = async () => {
    const source = skillSource.trim();
    if (!source) {
      const message = t('tools.skills.source_required');
      notify.error(message, { key: 'skill-market:source:required' });
      return;
    }
    setInstallingSource(true);
    try {
      const result = await installSkill(source);
      await refreshSkills();
      setSkillSource('');
      notify.success(
        t('tools.skills.install_success', {
          dir: result.installed_dir,
          files: result.files_scanned,
        }),
        { key: 'skill-market:source-install:success' },
      );
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : t('tools.skills.install_failed');
      notify.error(message, { key: 'skill-market:source-install:error' });
    } finally {
      setInstallingSource(false);
    }
  };

  const handleAuditSkill = async (source: string) => {
    const target = source.trim();
    if (!target) {
      const message = t('tools.skills.source_required');
      notify.error(message, { key: 'skill-market:audit:required' });
      return;
    }
    setAuditing(true);
    setAuditResult(null);
    try {
      const result = await auditSkill(target);
      setAuditResult(result);
      notify.success(
        result.clean
          ? t('tools.skills.audit_clean', { files: result.files_scanned })
          : t('tools.skills.audit_risk', { count: result.findings.length }),
        { key: 'skill-market:audit:success' },
      );
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : t('tools.skills.audit_failed');
      notify.error(message, { key: 'skill-market:audit:error' });
    } finally {
      setAuditing(false);
    }
  };

  const handleRemoveSkill = async (name: string) => {
    if (!window.confirm(t('tools.skills.remove_confirm', { name }))) {
      return;
    }
    setRemovingSkill(name);
    try {
      await removeSkill(name);
      await refreshSkills();
      const message = t('tools.skills.remove_success', { name });
      notify.success(message, { key: 'skill-market:remove:success' });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : t('tools.skills.remove_failed');
      notify.error(message, { key: 'skill-market:remove:error' });
    } finally {
      setRemovingSkill(null);
    }
  };

  if (error) {
    return (
      <div className="p-6">
        <div className="rounded-lg bg-red-900/30 border border-red-700 p-4 text-red-300">
          {error}
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
      <div className="rounded-xl border border-yellow-700/40 bg-yellow-900/20 p-4">
        <div className="flex items-start gap-3">
          <ShieldAlert className="h-5 w-5 text-yellow-300 mt-0.5" />
          <div>
            <p className="text-sm font-semibold text-yellow-200">
              {t('skill_market.risk_title')}
            </p>
            <p className="text-sm text-yellow-100/80 mt-1">
              {t('skill_market.risk_desc')}
            </p>
          </div>
        </div>
      </div>

      <div className="flex items-center gap-2 border-b border-gray-800">
        <button
          onClick={() => setActiveTab('market')}
          className={`px-3 py-2 text-sm font-medium border-b-2 ${
            activeTab === 'market'
              ? 'text-blue-300 border-blue-500'
              : 'text-gray-400 border-transparent hover:text-gray-200'
          }`}
        >
          {t('skill_market.tab_market')} ({items.length})
        </button>
        <button
          onClick={() => setActiveTab('installed')}
          className={`px-3 py-2 text-sm font-medium border-b-2 ${
            activeTab === 'installed'
              ? 'text-blue-300 border-blue-500'
              : 'text-gray-400 border-transparent hover:text-gray-200'
          }`}
        >
          {t('skill_market.tab_installed')} ({skills.length})
        </button>
      </div>

      <div className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-500" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={
            activeTab === 'market' ? t('skill_market.search') : t('skill_market.search_installed')
          }
          className="w-full bg-gray-900 border border-gray-700 rounded-lg pl-10 pr-4 py-2.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
        />
      </div>

      {activeTab === 'market' ? (
        <>
          {filteredItems.length === 0 ? (
            <div className="bg-gray-900 rounded-xl border border-gray-800 p-8 text-center text-gray-400">
              {t('skill_market.empty')}
            </div>
          ) : (
            <>
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                {pagedItems.map((item) => {
                  const detailUrl = getClawHubDetailUrl(item);
                  return (
                    <div
                      key={item.id}
                      className="bg-gray-900 rounded-xl border border-gray-800 p-4 space-y-3"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <Store className="h-4 w-4 text-blue-400" />
                            <h3 className="text-sm font-semibold text-white truncate">
                              {getMarketName(item)}
                            </h3>
                          </div>
                          <p className="text-xs text-gray-500 mt-1">{item.publisher}</p>
                        </div>
                        <span
                          className={`text-xs px-2 py-0.5 rounded-full ${
                            item.risk_level === 'high'
                              ? 'bg-red-900/40 text-red-300'
                              : 'bg-yellow-900/40 text-yellow-300'
                          }`}
                        >
                          {t(`skill_market.risk_${item.risk_level}`)}
                        </span>
                      </div>
                      <p className="text-sm text-gray-400 line-clamp-3">{getMarketDescription(item)}</p>
                      <div className="flex flex-wrap gap-1">
                        {item.tags.map((tag) => (
                          <span
                            key={`${item.id}-${tag}`}
                            className="text-xs px-2 py-0.5 rounded-full bg-gray-800 text-gray-300"
                          >
                            {tag}
                          </span>
                        ))}
                      </div>
                      <div className="pt-2 flex items-center justify-between gap-2">
                        {detailUrl ? (
                          <a
                            href={detailUrl}
                            onClick={(event) => {
                              event.preventDefault();
                              openExternalUrl(detailUrl);
                            }}
                            className="inline-flex items-center gap-1 text-xs text-blue-300 hover:text-blue-200"
                          >
                            <ExternalLink className="h-3.5 w-3.5" />
                            {t('skill_market.view_detail')}
                          </a>
                        ) : (
                          <span className="text-xs text-gray-500 truncate">{item.source}</span>
                        )}
                        <button
                          onClick={() => openInstallRisk(item)}
                          disabled={installingId === item.id}
                          className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-xs text-white font-medium disabled:opacity-60"
                        >
                          <Download className="h-3.5 w-3.5" />
                          {installedNames.has(item.name)
                            ? t('skill_market.reinstall')
                            : t('skill_market.install')}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="flex items-center justify-between bg-gray-900 rounded-xl border border-gray-800 px-4 py-3">
                <button
                  onClick={() => setMarketPage((page) => Math.max(1, page - 1))}
                  disabled={clampedMarketPage <= 1}
                  className="px-3 py-1.5 rounded-lg bg-gray-800 text-sm text-gray-200 hover:bg-gray-700 disabled:opacity-50"
                >
                  {t('skill_market.prev_page')}
                </button>
                <span className="text-sm text-gray-400">
                  {t('skill_market.page_info', {
                    page: clampedMarketPage,
                    total: totalMarketPages,
                  })}
                </span>
                <button
                  onClick={() => setMarketPage((page) => Math.min(totalMarketPages, page + 1))}
                  disabled={clampedMarketPage >= totalMarketPages}
                  className="px-3 py-1.5 rounded-lg bg-gray-800 text-sm text-gray-200 hover:bg-gray-700 disabled:opacity-50"
                >
                  {t('skill_market.next_page')}
                </button>
              </div>
            </>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="bg-gray-900 rounded-xl border border-gray-800 p-4 space-y-3">
              <h3 className="text-sm font-semibold text-white">{t('tools.skills.install_title')}</h3>
              <p className="text-xs text-gray-400">{t('tools.skills.install_hint')}</p>
              <input
                type="text"
                value={skillSource}
                onChange={(e) => setSkillSource(e.target.value)}
                placeholder={t('tools.skills.source_placeholder')}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <button
                onClick={handleInstallSource}
                disabled={installingSource}
                className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-sm text-white font-medium disabled:opacity-60"
              >
                <Download className="h-4 w-4" />
                {installingSource ? t('tools.skills.installing') : t('tools.skills.install')}
              </button>
            </div>

            <div className="bg-gray-900 rounded-xl border border-gray-800 p-4 space-y-3">
              <h3 className="text-sm font-semibold text-white">{t('tools.skills.audit_title')}</h3>
              <p className="text-xs text-gray-400">{t('tools.skills.audit_hint')}</p>
              <input
                type="text"
                value={auditSource}
                onChange={(e) => setAuditSource(e.target.value)}
                placeholder={t('tools.skills.audit_placeholder')}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <button
                onClick={() => handleAuditSkill(auditSource)}
                disabled={auditing}
                className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-purple-600 hover:bg-purple-700 text-sm text-white font-medium disabled:opacity-60"
              >
                <ShieldCheck className="h-4 w-4" />
                {auditing ? t('tools.skills.auditing') : t('tools.skills.audit')}
              </button>
            </div>
          </div>
        </>
      ) : (
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <Package className="h-5 w-5 text-purple-400" />
            <h2 className="text-base font-semibold text-white">
              {t('tools.skills.title')} ({filteredSkills.length})
            </h2>
          </div>
          {filteredSkills.length === 0 ? (
            <div className="bg-gray-900 rounded-xl border border-gray-800 p-8 text-center text-gray-400">
              {t('tools.skills.empty')}
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {filteredSkills.map((skill) => (
                <div
                  key={skill.name}
                  className="bg-gray-900 rounded-xl border border-gray-800 p-4 space-y-3"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <h3 className="text-sm font-semibold text-white truncate">{skill.name}</h3>
                      <p className="text-xs text-gray-500">
                        {t('tools.version')}: {skill.version}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => handleAuditSkill(skill.name)}
                        disabled={auditing}
                        className="text-xs px-2 py-1 rounded bg-purple-600/20 text-purple-300 hover:bg-purple-600/30 disabled:opacity-50"
                      >
                        {t('tools.skills.audit')}
                      </button>
                      <button
                        onClick={() => handleRemoveSkill(skill.name)}
                        disabled={removingSkill === skill.name}
                        className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded bg-red-600/20 text-red-300 hover:bg-red-600/30 disabled:opacity-50"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                        {t('skill_market.uninstall')}
                      </button>
                    </div>
                  </div>
                  <p className="text-sm text-gray-400 line-clamp-2">{skill.description}</p>
                  <div className="text-xs text-gray-500 space-y-1">
                    <p>
                      {t('tools.skills.tools_count')}: {skill.tools.length}
                    </p>
                    <p>
                      {t('tools.skills.prompts_count')}: {skill.prompts.length}
                    </p>
                    {skill.location && (
                      <p className="truncate">
                        {t('tools.skills.location')}: {skill.location}
                      </p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {auditResult && (
        <div className="bg-gray-900 rounded-xl border border-gray-800 p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-white">{t('tools.skills.audit_result')}</h3>
            <span
              className={`text-xs px-2 py-0.5 rounded-full ${
                auditResult.clean
                  ? 'bg-green-900/40 text-green-300'
                  : 'bg-yellow-900/40 text-yellow-300'
              }`}
            >
              {auditResult.clean ? t('tools.skills.clean') : t('tools.skills.risky')}
            </span>
          </div>
          <p className="text-xs text-gray-400 mb-2">
            {t('tools.skills.files_scanned', { files: auditResult.files_scanned })}
          </p>
          {auditResult.findings.length > 0 ? (
            <ul className="space-y-1 text-sm text-yellow-300">
              {auditResult.findings.map((finding, idx) => (
                <li key={`${finding}-${idx}`}>• {finding}</li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-green-300">{t('tools.skills.no_findings')}</p>
          )}
        </div>
      )}

      {riskOpen && selectedItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <button
            type="button"
            onClick={closeInstallRisk}
            className="absolute inset-0 bg-black/60"
          />
          <div className="relative z-10 w-full max-w-lg bg-gray-900 border border-gray-700 rounded-xl p-5 space-y-4">
            <div className="flex items-start gap-3">
              <AlertTriangle className="h-5 w-5 text-yellow-300 mt-0.5" />
              <div>
                <h3 className="text-base font-semibold text-white">
                  {t('skill_market.confirm_title')}
                </h3>
                <p className="text-sm text-gray-300 mt-1">
                  {t('skill_market.confirm_desc', { name: getMarketName(selectedItem) })}
                </p>
              </div>
            </div>
            <label className="flex items-start gap-2 text-sm text-gray-300">
              <input
                type="checkbox"
                checked={acknowledgeRisk}
                onChange={(e) => setAcknowledgeRisk(e.target.checked)}
                className="mt-0.5"
              />
              <span>{t('skill_market.acknowledge')}</span>
            </label>
            <div className="flex items-center justify-end gap-2">
              <button
                onClick={closeInstallRisk}
                className="px-3 py-1.5 rounded-lg bg-gray-800 text-gray-300 hover:bg-gray-700 text-sm"
              >
                {t('common.cancel')}
              </button>
              <button
                onClick={handleInstall}
                disabled={!acknowledgeRisk || installingId === selectedItem.id}
                className="px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm disabled:opacity-60"
              >
                {installingId === selectedItem.id
                  ? t('skill_market.installing')
                  : t('skill_market.install')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
