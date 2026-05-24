import { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard,
  PlusSquare,
  MessageSquare,
  Clock,
  Store,
  Puzzle,
  Brain,
  DollarSign,
  Activity,
  Stethoscope,
  Settings,
  Bot,
  Radio,
  ShieldCheck,
  ChevronUp,
  Globe,
  LogOut,
  Loader2,
  Trash2,
  X,
} from 'lucide-react';
import { t } from '@/lib/i18n';
import { formatChatSessionTitle } from '@/lib/chatSessions';
import { Logo } from '@/components/ui/Logo';
import { useLocaleContext } from '@/App';
import { useAuth } from '@/hooks/useAuth';
import {
  CHAT_SESSIONS_UPDATED_EVENT,
  createChatSession,
  deleteChatSession,
  emitChatSessionsUpdated,
  getChatSessions,
} from '@/lib/api';
import type { ChatSessionItem } from '@/types/api';

type PrimaryNavItem =
  | { kind: 'new-task'; icon: typeof PlusSquare; labelKey: string }
  | { to: string; icon: typeof Clock; labelKey: string };

const primaryNavItems: PrimaryNavItem[] = [
  { kind: 'new-task', icon: PlusSquare, labelKey: 'nav.new_task' },
  { to: '/cron', icon: Clock, labelKey: 'nav.cron' },
  { to: '/skill-market', icon: Store, labelKey: 'nav.skill_market' },
];

type WorkspaceNavItem = {
  to: string;
  icon: typeof Settings;
  labelKey: string;
  hintKey?: string;
};

const workspaceNavGroups: { labelKey: string; items: WorkspaceNavItem[] }[] = [
  {
    labelKey: 'sidebar.workspace_group_common',
    items: [
      { to: '/deerclaw-settings', icon: Bot, labelKey: 'nav.deerclaw_settings', hintKey: 'nav.deerclaw_settings_hint' },
      { to: '/channels', icon: Radio, labelKey: 'nav.channel_settings', hintKey: 'nav.channel_settings_hint' },
      { to: '/permissions', icon: ShieldCheck, labelKey: 'nav.permissions', hintKey: 'nav.permissions_hint' },
      { to: '/memory', icon: Brain, labelKey: 'nav.memory', hintKey: 'nav.memory_hint' },
      { to: '/cost', icon: DollarSign, labelKey: 'nav.cost', hintKey: 'nav.cost_hint' },
    ],
  },
  {
    labelKey: 'sidebar.workspace_group_advanced',
    items: [
      { to: '/dashboard', icon: LayoutDashboard, labelKey: 'nav.dashboard', hintKey: 'nav.dashboard_hint' },
      { to: '/integrations', icon: Puzzle, labelKey: 'nav.integrations', hintKey: 'nav.integrations_hint' },
      { to: '/logs', icon: Activity, labelKey: 'nav.logs', hintKey: 'nav.logs_hint' },
      { to: '/doctor', icon: Stethoscope, labelKey: 'nav.doctor', hintKey: 'nav.doctor_hint' },
      { to: '/config', icon: Settings, labelKey: 'nav.config', hintKey: 'nav.config_hint' },
    ],
  },
];

export default function Sidebar() {
  const location = useLocation();
  const navigate = useNavigate();
  const { locale, setAppLocale } = useLocaleContext();
  const { logout } = useAuth();
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const [recentSessions, setRecentSessions] = useState<ChatSessionItem[]>([]);
  const [recentSessionsLoading, setRecentSessionsLoading] = useState(false);
  const [recentSessionsError, setRecentSessionsError] = useState<string | null>(null);
  const [deletingSessionId, setDeletingSessionId] = useState<string | null>(null);
  const [sessionPendingDelete, setSessionPendingDelete] = useState<ChatSessionItem | null>(null);
  const activeSearchParams = useMemo(() => new URLSearchParams(location.search), [location.search]);

  const accountSectionActive = useMemo(
    () =>
      workspaceNavGroups.some((group) =>
        group.items.some((item) => new URL(item.to, window.location.origin).pathname === location.pathname),
      ),
    [location.pathname],
  );

  const activeChatSessionId = useMemo(() => {
    if (location.pathname !== '/agent') return null;
    return activeSearchParams.get('session');
  }, [activeSearchParams, location.pathname]);

  const findReusableTaskSession = useCallback(
    (items: ChatSessionItem[]) =>
      items.find(
        (item) => item.kind === 'task' && item.last_message.trim().length === 0,
      ) ?? null,
    [],
  );

  useEffect(() => {
    setAccountMenuOpen(false);
  }, [location.pathname, location.search]);

  const loadRecentSessions = useCallback(async () => {
    setRecentSessionsLoading(true);
    setRecentSessionsError(null);
    try {
      const items = await getChatSessions();
      setRecentSessions(items);
    } catch {
      setRecentSessions([]);
      setRecentSessionsError(t('agent.session_reload_failed'));
    } finally {
      setRecentSessionsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadRecentSessions();
  }, [loadRecentSessions, location.pathname, location.search]);

  useEffect(() => {
    const handleSessionsUpdated = () => {
      void loadRecentSessions();
    };
    window.addEventListener(CHAT_SESSIONS_UPDATED_EVENT, handleSessionsUpdated);
    return () => {
      window.removeEventListener(CHAT_SESSIONS_UPDATED_EVENT, handleSessionsUpdated);
    };
  }, [loadRecentSessions]);

  useEffect(() => {
    if (!accountMenuOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setAccountMenuOpen(false);
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [accountMenuOpen]);

  useEffect(() => {
    if (!accountMenuOpen) return;
    const { overflow } = document.body.style;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = overflow;
    };
  }, [accountMenuOpen]);

  const handleDeleteSession = async (session: ChatSessionItem) => {
    setDeletingSessionId(session.session_id);
    setRecentSessionsError(null);
    try {
      await deleteChatSession(session.session_id);
      const remainingSessions = recentSessions.filter(
        (item) => item.session_id !== session.session_id,
      );
      setRecentSessions(remainingSessions);
      if (activeChatSessionId === session.session_id) {
        const fallbackSession =
          findReusableTaskSession(remainingSessions) ?? remainingSessions[0] ?? null;
        if (fallbackSession) {
          navigate(`/agent?session=${encodeURIComponent(fallbackSession.session_id)}`, {
            replace: true,
          });
        } else {
          const created = await createChatSession();
          navigate(`/agent?session=${encodeURIComponent(created.session_id)}`, {
            replace: true,
          });
        }
      }
      emitChatSessionsUpdated();
    } catch {
      setRecentSessionsError(t('sidebar.delete_session_failed'));
    } finally {
      setDeletingSessionId(null);
      setSessionPendingDelete(null);
    }
  };

  const handleRequestDeleteSession = (session: ChatSessionItem) => {
    if (deletingSessionId) return;
    setSessionPendingDelete(session);
  };

  const handleCreateTask = async () => {
    setRecentSessionsError(null);
    try {
      const sessions =
        recentSessions.length > 0 || recentSessionsLoading
          ? recentSessions
          : await getChatSessions();
      const reusableSession = findReusableTaskSession(sessions);
      if (reusableSession) {
        navigate(`/agent?session=${encodeURIComponent(reusableSession.session_id)}`);
        return;
      }
      const created = await createChatSession();
      navigate(`/agent?session=${encodeURIComponent(created.session_id)}`);
      emitChatSessionsUpdated();
    } catch {
      setRecentSessionsError(t('agent.session_reload_failed'));
    }
  };

  const isWorkspaceItemActive = (to: string) => {
    const target = new URL(to, window.location.origin);
    if (target.pathname !== location.pathname) return false;
    const targetTab = target.searchParams.get('tab');
    if (!targetTab) return !activeSearchParams.get('tab');
    return activeSearchParams.get('tab') === targetTab;
  };

  const workspaceModal =
    accountMenuOpen && typeof document !== 'undefined'
      ? createPortal(
          <div className="fixed inset-0 z-240 flex items-center justify-center p-6">
            <button
              type="button"
              aria-label={t('common.cancel')}
              className="absolute inset-0 bg-black/70 backdrop-blur-sm"
              onClick={() => setAccountMenuOpen(false)}
            />
            <div className="relative z-10 w-full max-w-5xl overflow-hidden rounded-3xl border border-gray-800 bg-gray-900 shadow-2xl shadow-black/60">
              <div className="border-b border-gray-800 px-6 py-5">
                <div className="flex items-start justify-between gap-6">
                  <div className="flex items-start gap-4">
                    <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gray-800 text-blue-300">
                      <Logo className="h-6 w-6" />
                    </div>
                    <div>
                      <p className="text-lg font-semibold text-white">
                        {t('sidebar.workspace_title')}
                      </p>
                      <p className="mt-1 text-sm text-gray-400">
                        {t('sidebar.workspace_hint')}
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    aria-label={t('common.close')}
                    onClick={() => setAccountMenuOpen(false)}
                    className="flex h-10 w-10 items-center justify-center rounded-xl border border-gray-800 bg-gray-950/60 text-gray-400 transition-colors hover:border-gray-700 hover:bg-gray-800 hover:text-white"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              </div>

              <div className="space-y-5 px-6 py-5">
                {workspaceNavGroups.map((group, groupIndex) => (
                  <section
                    key={group.labelKey}
                    className={groupIndex === 0 ? '' : 'border-t border-gray-800 pt-5'}
                  >
                    <div className="mb-3 flex items-center justify-between gap-3">
                      <p className="text-xs font-medium uppercase tracking-[0.18em] text-gray-500">
                        {t(group.labelKey)}
                      </p>
                      <div className="h-px flex-1 bg-gray-800" />
                    </div>
                    <div className="grid grid-cols-2 gap-2 lg:grid-cols-5">
                      {group.items.map(({ to, icon: Icon, labelKey, hintKey }) => {
                        const active = isWorkspaceItemActive(to);
                        return (
                          <Link
                            key={to}
                            to={to}
                            className={[
                              'group flex min-h-[104px] flex-col rounded-2xl border px-3.5 py-3 transition-colors',
                              active
                                ? 'border-blue-500/50 bg-blue-500/10 text-white'
                                : 'border-gray-800 bg-gray-950/40 text-gray-300 hover:border-gray-700 hover:bg-gray-800 hover:text-white',
                            ].join(' ')}
                          >
                            <div
                              className={`flex h-9 w-9 items-center justify-center rounded-xl ${
                                active ? 'bg-blue-500/15 text-blue-100' : 'bg-gray-800 text-gray-300'
                              }`}
                            >
                              <Icon className="h-4.5 w-4.5 shrink-0" />
                            </div>
                            <div className="mt-4">
                              <span className="block text-sm font-medium leading-5">
                                {t(labelKey)}
                              </span>
                              {hintKey && (
                                <span
                                  className={`mt-1 block text-xs leading-5 ${
                                    active ? 'text-blue-100/80' : 'text-gray-500'
                                  }`}
                                >
                                  {t(hintKey)}
                                </span>
                              )}
                            </div>
                          </Link>
                        );
                      })}
                    </div>
                  </section>
                ))}
              </div>

              <div className="grid grid-cols-2 gap-2 border-t border-gray-800 px-6 py-5">
                <button
                  type="button"
                  onClick={() => setAppLocale(locale === 'en' ? 'zh' : 'en')}
                  className="group flex min-h-[56px] w-full items-center justify-between rounded-2xl border border-gray-800 bg-gray-950/50 px-4 py-3 text-sm text-gray-300 transition-colors hover:border-gray-700 hover:bg-gray-800 hover:text-white"
                >
                  <span className="flex items-center gap-3">
                    <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-gray-800 text-gray-300">
                      <Globe className="h-4 w-4 shrink-0" />
                    </span>
                    {t('sidebar.language')}
                  </span>
                  <span className="text-xs text-gray-500">{locale === 'en' ? 'EN' : '中文'}</span>
                </button>
                <button
                  type="button"
                  onClick={logout}
                  className="group flex min-h-[56px] w-full items-center gap-3 rounded-2xl border border-gray-800 bg-gray-950/50 px-4 py-3 text-sm text-gray-300 transition-colors hover:border-gray-700 hover:bg-gray-800 hover:text-white"
                >
                  <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-gray-800 text-gray-300">
                    <LogOut className="h-4 w-4 shrink-0" />
                  </span>
                  {t('auth.logout')}
                </button>
              </div>
            </div>
          </div>,
          document.body,
        )
      : null;

  return (
    <>
      {sessionPendingDelete && (
        <div className="fixed inset-0 z-200 flex items-center justify-center p-4">
          <button
            type="button"
            aria-label={t('common.cancel')}
            className="absolute inset-0 bg-black/70 backdrop-blur-sm"
            onClick={() => {
              if (!deletingSessionId) {
                setSessionPendingDelete(null);
              }
            }}
          />
          <div className="relative z-10 w-full max-w-md rounded-2xl border border-gray-800 bg-gray-900 p-5 shadow-2xl shadow-black/60">
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-red-500/10 text-red-300">
                <Trash2 className="h-5 w-5" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-base font-medium text-white">
                  {t('sidebar.delete_session_title')}
                </p>
                <p className="mt-2 text-sm leading-6 text-gray-400">
                  {t('sidebar.delete_session_description', {
                    title: formatChatSessionTitle(sessionPendingDelete.title),
                  })}
                </p>
              </div>
            </div>

            <div className="mt-5 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setSessionPendingDelete(null)}
                disabled={Boolean(deletingSessionId)}
                className="rounded-xl border border-gray-700 bg-gray-800 px-4 py-2 text-sm text-gray-200 transition-colors hover:border-gray-600 hover:bg-gray-700 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {t('common.cancel')}
              </button>
              <button
                type="button"
                onClick={() => void handleDeleteSession(sessionPendingDelete)}
                disabled={Boolean(deletingSessionId)}
                className="inline-flex min-w-[88px] items-center justify-center rounded-xl bg-red-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {deletingSessionId === sessionPendingDelete.session_id ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  t('common.delete')
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      <aside className="fixed top-0 left-0 h-screen w-60 bg-gray-900 flex flex-col border-r border-gray-800">
        <div className="flex items-center gap-2 px-6 h-16 border-b border-gray-800 bg-gray-900 z-10">
          <Logo showText={true} />
        </div>

      <div className="flex min-h-0 flex-1 flex-col">
        <div className="shrink-0 px-3 py-4 space-y-1">
          {primaryNavItems.map((item) => {
            const Icon = item.icon;
            if ('kind' in item && item.kind === 'new-task') {
              return (
                <button
                  key={item.labelKey}
                  type="button"
                  onClick={() => void handleCreateTask()}
                  className="flex w-full items-center gap-3 rounded-lg border border-blue-500/30 bg-blue-500/10 px-3 py-2.5 text-sm font-medium text-blue-100 transition-colors hover:border-blue-400/40 hover:bg-blue-500/15"
                >
                  <Icon className="h-5 w-5 shrink-0" />
                  <span>{t(item.labelKey)}</span>
                </button>
              );
            }

            if (!('to' in item)) {
              return null;
            }

            return (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) =>
                  [
                    'flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors',
                    isActive
                      ? 'bg-blue-600 text-white'
                      : 'text-gray-300 hover:bg-gray-800 hover:text-white',
                  ].join(' ')
                }
              >
                <Icon className="h-5 w-5 shrink-0" />
                <span>{t(item.labelKey)}</span>
              </NavLink>
            );
          })}
        </div>

        <div className="min-h-0 flex-1 border-t border-gray-800 px-3 pb-4 pt-3">
          <div className="mb-2 flex items-center justify-between px-1">
            <div>
              <p className="text-xs font-medium uppercase tracking-[0.18em] text-gray-500">
                {t('sidebar.recent_sessions')}
              </p>
              <p className="mt-1 text-[11px] text-gray-500">{t('sidebar.recent_sessions_hint')}</p>
            </div>
          </div>

          {recentSessionsError && (
            <p className="mb-2 px-1 text-[11px] text-red-300">{recentSessionsError}</p>
          )}

          <div className="space-y-1 overflow-y-auto pr-1">
            {recentSessions.map((session) => {
              const deleting = deletingSessionId === session.session_id;
              const sessionTitle = formatChatSessionTitle(session.title);
              return (
                <div key={session.session_id} className="group relative">
                  <button
                    type="button"
                    onClick={() =>
                      navigate(`/agent?session=${encodeURIComponent(session.session_id)}`)
                    }
                    className={`flex w-full items-start gap-3 rounded-xl px-3 py-2.5 pr-12 text-left transition-colors ${
                      activeChatSessionId === session.session_id
                        ? 'bg-amber-500/15 text-white'
                        : 'text-gray-300 hover:bg-gray-800 hover:text-white'
                    }`}
                  >
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-gray-800 text-gray-400">
                      {session.kind === 'task' ? (
                        <Logo className="h-4 w-4" />
                      ) : (
                        <MessageSquare className="h-4 w-4" />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium leading-6">{sessionTitle}</p>
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() => handleRequestDeleteSession(session)}
                    disabled={Boolean(deletingSessionId)}
                    title={t('common.delete')}
                    className={`absolute right-2 top-2 flex h-8 w-8 items-center justify-center rounded-lg transition ${
                      activeChatSessionId === session.session_id
                        ? 'text-amber-200 hover:bg-amber-500/10 hover:text-red-200'
                        : 'text-gray-500 hover:bg-gray-800 hover:text-red-300'
                    } ${
                      deleting ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 focus:opacity-100'
                    } disabled:cursor-not-allowed disabled:opacity-60`}
                  >
                    {deleting ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Trash2 className="h-4 w-4" />
                    )}
                  </button>
                </div>
              );
            })}

            {recentSessionsLoading && (
              <div className="rounded-xl border border-dashed border-gray-800 bg-gray-950/40 px-3 py-4 text-sm text-gray-500">
                {t('agent.session_loading')}
              </div>
            )}

            {!recentSessionsLoading && recentSessions.length === 0 && (
              <div className="rounded-xl border border-dashed border-gray-800 bg-gray-950/40 px-3 py-4 text-sm text-gray-500">
                {t('sidebar.recent_sessions_empty')}
              </div>
            )}
          </div>
        </div>
      </div>

        <div className="border-t border-gray-800 p-3">
        <button
          type="button"
          onClick={() => setAccountMenuOpen((open) => !open)}
          className={`flex w-full items-center gap-3 rounded-xl border px-3 py-3 text-left transition-colors ${
            accountMenuOpen || accountSectionActive
              ? 'border-blue-500/40 bg-blue-500/10'
              : 'border-gray-800 bg-gray-950/60 hover:border-gray-700 hover:bg-gray-800'
          }`}
        >
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gray-800">
            <Logo className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-white">{t('sidebar.workspace_title')}</p>
            <p className="mt-0.5 truncate text-xs text-gray-500">{t('sidebar.workspace_bar_hint')}</p>
          </div>
          <ChevronUp
            className={`h-4 w-4 shrink-0 text-gray-500 transition-transform ${
              accountMenuOpen ? 'rotate-0' : 'rotate-180'
            }`}
          />
        </button>
        </div>
      </aside>
      {workspaceModal}
    </>
  );
}
