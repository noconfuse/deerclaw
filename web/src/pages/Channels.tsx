import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  MessageSquareMore,
  Save,
  Trash2,
  X,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { getConfigForm, putConfigForm } from '@/lib/api';
import { CHANNEL_DEFS, CHANNEL_LABEL_MAP } from '@/lib/channels';
import { useNotify } from '@/hooks/useNotify';

type ConfigForm = Record<string, unknown>;
type EditMode = 'form' | 'json';

export default function Channels() {
  const { t } = useTranslation();
  const notify = useNotify();
  const [config, setConfig] = useState<ConfigForm | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [modalChannelId, setModalChannelId] = useState<string | null>(null);
  const [editMode, setEditMode] = useState<EditMode>('form');
  const [channelDrafts, setChannelDrafts] = useState<Record<string, string>>({});

  useEffect(() => {
    const load = async () => {
      try {
        const formData = await getConfigForm<ConfigForm>();
        setConfig(formData);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : t('config.error');
        setError(message);
        notify.error(message, { key: 'channels:load:error' });
      } finally {
        setLoading(false);
      }
    };
    void load();
  }, [notify, t]);

  const channelsConfig = useMemo(
    () =>
      ((config?.channels_config as Record<string, unknown> | undefined) ?? {}) as Record<
        string,
        unknown
      >,
    [config],
  );

  const getChannelConfig = (channelId: string) => {
    const value = channelsConfig[channelId];
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  };

  const getChannelDraft = (channelId: string) => {
    if (channelDrafts[channelId]) {
      return channelDrafts[channelId];
    }
    const existing = getChannelConfig(channelId);
    const template =
      existing ?? (structuredClone(
        CHANNEL_DEFS.find((item) => item.id === channelId)?.template ?? {},
      ) as Record<string, unknown>);
    return JSON.stringify(template, null, 2);
  };

  const parseChannelDraft = (channelId: string) => {
    const raw = getChannelDraft(channelId);
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

  const openChannelModal = (channelId: string) => {
    setModalChannelId(channelId);
    setEditMode('form');
    setChannelDrafts((prev) => ({
      ...prev,
      [channelId]: getChannelDraft(channelId),
    }));
  };

  const closeModal = () => {
    setModalChannelId(null);
    setEditMode('form');
    setError(null);
  };

  const updateDraftField = (
    channelId: string,
    field: string,
    currentValue: unknown,
    rawValue: string | boolean,
  ) => {
    const parsed = parseChannelDraft(channelId);
    if (!parsed) return;
    let nextValue: unknown = rawValue;
    if (typeof currentValue === 'number') {
      const n = Number(rawValue);
      nextValue = Number.isNaN(n) ? 0 : n;
    } else if (typeof currentValue === 'boolean') {
      nextValue = Boolean(rawValue);
    } else if (Array.isArray(currentValue)) {
      nextValue = String(rawValue)
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean);
    } else if (currentValue === null && typeof rawValue === 'string' && rawValue.trim() === '') {
      nextValue = null;
    }
    const next = { ...parsed, [field]: nextValue };
    setChannelDrafts((prev) => ({
      ...prev,
      [channelId]: JSON.stringify(next, null, 2),
    }));
  };

  const persistChannelConfig = async (channelId: string, nextValue: Record<string, unknown> | null) => {
    if (!config) return;
    setSaving(true);
    setError(null);
    try {
      const nextConfig = structuredClone(config) as ConfigForm;
      const nextChannels =
        ((nextConfig.channels_config as Record<string, unknown> | undefined) ?? {}) as Record<
          string,
          unknown
        >;
      if (nextValue === null) {
        delete nextChannels[channelId];
      } else {
        nextChannels[channelId] = nextValue;
      }
      nextConfig.channels_config = nextChannels;
      await putConfigForm(nextConfig);
      setConfig(nextConfig);
      const message =
        nextValue === null ? t('channels.removed') : t('channels.saved', { channel: CHANNEL_LABEL_MAP[channelId] ?? channelId });
      notify.success(message, {
        key: nextValue === null ? `channels:${channelId}:removed` : `channels:${channelId}:saved`,
      });
      closeModal();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : t('config.error');
      setError(message);
      notify.error(message, { key: `channels:${channelId}:save:error` });
    } finally {
      setSaving(false);
    }
  };

  const saveModalChannel = async () => {
    if (!modalChannelId) return;
    const parsed = parseChannelDraft(modalChannelId);
    if (!parsed) {
      const message = t('config.channels.invalid_json', {
        channel: CHANNEL_LABEL_MAP[modalChannelId] ?? modalChannelId,
      });
      setError(message);
      notify.error(message, { key: `channels:${modalChannelId}:invalid-json` });
      return;
    }
    await persistChannelConfig(modalChannelId, parsed);
  };

  const removeModalChannel = async () => {
    if (!modalChannelId) return;
    await persistChannelConfig(modalChannelId, null);
  };

  const activeChannel = modalChannelId
    ? CHANNEL_DEFS.find((channel) => channel.id === modalChannelId) ?? null
    : null;
  const activeChannelConfigured = modalChannelId ? getChannelConfig(modalChannelId) !== null : false;
  const parsedModalDraft = modalChannelId ? parseChannelDraft(modalChannelId) : null;

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

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-500/10 text-blue-300">
            <MessageSquareMore className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-base font-semibold text-white">{t('config.channels.title')}</h2>
            <p className="mt-1 text-sm text-gray-400">{t('channels.page_hint')}</p>
          </div>
        </div>
      </div>

      {error && (
        <div className="rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-200">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {CHANNEL_DEFS.map((channel) => {
          const configured = getChannelConfig(channel.id) !== null;
          return (
            <button
              key={channel.id}
              type="button"
              onClick={() => openChannelModal(channel.id)}
              className="rounded-2xl border border-gray-800 bg-gray-900 p-5 text-left transition-colors hover:border-gray-700 hover:bg-gray-900/90"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-base font-semibold text-white">{channel.label}</div>
                  <div className="mt-2 text-sm leading-6 text-gray-400">{channel.description}</div>
                </div>
                <span
                  className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${
                    configured
                      ? 'bg-emerald-500/10 text-emerald-200'
                      : 'bg-gray-800 text-gray-300'
                  }`}
                >
                  {configured ? t('channels.configured') : t('channels.not_configured')}
                </span>
              </div>
              <div className="mt-5 flex items-center justify-between gap-3 text-xs">
                <span className="font-mono text-gray-500">{channel.id}</span>
                <span className="text-blue-300">{t('channels.open_config')}</span>
              </div>
            </button>
          );
        })}
      </div>

      {modalChannelId && activeChannel && (
        <div className="fixed inset-0 z-200 flex items-center justify-center p-6">
          <button
            type="button"
            aria-label={t('common.cancel')}
            className="absolute inset-0 border-0 bg-black/55 backdrop-blur-sm"
            onClick={closeModal}
          />
          <div className="relative z-10 flex max-h-[85vh] w-full max-w-4xl flex-col overflow-hidden rounded-3xl border border-gray-800 bg-gray-900 shadow-2xl shadow-black/60">
            <div className="flex items-start justify-between gap-4 border-b border-gray-800 px-6 py-5">
              <div>
                <div className="flex items-center gap-3">
                  <h3 className="text-lg font-semibold text-white">{activeChannel.label}</h3>
                  <span
                    className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
                      activeChannelConfigured
                        ? 'bg-emerald-500/10 text-emerald-200'
                        : 'bg-gray-800 text-gray-300'
                    }`}
                  >
                    {activeChannelConfigured ? t('channels.configured') : t('channels.not_configured')}
                  </span>
                </div>
                <p className="mt-2 text-sm text-gray-400">{activeChannel.description}</p>
              </div>
              <button
                type="button"
                onClick={closeModal}
                className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-gray-800 bg-gray-950/60 text-gray-400 transition-colors hover:border-gray-700 hover:bg-gray-800 hover:text-white"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="flex items-center justify-between gap-3 border-b border-gray-800 px-6 py-4">
              <div className="flex items-center rounded-lg border border-gray-800 bg-gray-950 p-1">
                <button
                  type="button"
                  onClick={() => setEditMode('form')}
                  className={`rounded-md px-3 py-1.5 text-xs font-medium ${
                    editMode === 'form'
                      ? 'bg-blue-600 text-white'
                      : 'text-gray-400 hover:text-gray-200'
                  }`}
                >
                  {t('config.channels.form_mode')}
                </button>
                <button
                  type="button"
                  onClick={() => setEditMode('json')}
                  className={`rounded-md px-3 py-1.5 text-xs font-medium ${
                    editMode === 'json'
                      ? 'bg-blue-600 text-white'
                      : 'text-gray-400 hover:text-gray-200'
                  }`}
                >
                  {t('config.channels.json_mode')}
                </button>
              </div>
              <div className="font-mono text-xs text-gray-500">{activeChannel.id}</div>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
              {editMode === 'form' && parsedModalDraft ? (
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  {Object.entries(parsedModalDraft).map(([field, value]) => (
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
                              updateDraftField(modalChannelId, field, value, e.target.checked)
                            }
                          />
                        </div>
                      ) : (
                        <input
                          type={typeof value === 'number' ? 'number' : 'text'}
                          value={
                            Array.isArray(value)
                              ? value.join(', ')
                              : value === null
                                ? ''
                                : String(value)
                          }
                          onChange={(e) =>
                            updateDraftField(modalChannelId, field, value, e.target.value)
                          }
                          className="mt-2 w-full rounded-lg border border-gray-800 bg-gray-950 px-3 py-2 text-sm text-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />
                      )}
                    </label>
                  ))}
                </div>
              ) : (
                <div className="space-y-3">
                  {!parsedModalDraft && (
                    <div className="inline-flex items-center gap-2 rounded-lg border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
                      <AlertTriangle className="h-3.5 w-3.5" />
                      {t('channels.invalid_json_hint')}
                    </div>
                  )}
                  <textarea
                    value={getChannelDraft(modalChannelId)}
                    onChange={(e) =>
                      setChannelDrafts((prev) => ({ ...prev, [modalChannelId]: e.target.value }))
                    }
                    className="min-h-[360px] w-full rounded-lg border border-gray-800 bg-gray-950 p-3 font-mono text-sm text-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    spellCheck={false}
                    autoComplete="off"
                  />
                </div>
              )}
            </div>

            <div className="flex items-center justify-between gap-3 border-t border-gray-800 px-6 py-4">
              <div className="text-xs text-gray-500">
                {activeChannelConfigured ? t('channels.modal_update_hint') : t('channels.modal_create_hint')}
              </div>
              <div className="flex items-center gap-3">
                {activeChannelConfigured && (
                  <button
                    type="button"
                    onClick={() => void removeModalChannel()}
                    disabled={saving}
                    className="inline-flex items-center gap-2 rounded-lg border border-red-900/60 bg-red-950/30 px-3 py-2 text-sm text-red-300 transition-colors hover:bg-red-900/40 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    <Trash2 className="h-4 w-4" />
                    {t('config.channels.remove')}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => void saveModalChannel()}
                  disabled={saving}
                  className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {saving ? (
                    <span className="block h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                  ) : (
                    <Save className="h-4 w-4" />
                  )}
                  {activeChannelConfigured ? t('config.saved') : t('channels.enable_and_save')}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
