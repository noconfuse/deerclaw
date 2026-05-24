import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Cpu,
  Clock,
  Globe,
  Database,
  Activity,
  DollarSign,
  Radio,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { StatusResponse, CostSummary } from '@/types/api';
import { getStatus, getCost } from '@/lib/api';

function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function formatUSD(value: number): string {
  return `$${value.toFixed(4)}`;
}

function healthColor(status: string): string {
  switch (status.toLowerCase()) {
    case 'ok':
    case 'healthy':
      return 'bg-green-500';
    case 'warn':
    case 'warning':
    case 'degraded':
      return 'bg-yellow-500';
    default:
      return 'bg-red-500';
  }
}

function healthBorder(status: string): string {
  switch (status.toLowerCase()) {
    case 'ok':
    case 'healthy':
      return 'border-green-500/30';
    case 'warn':
    case 'warning':
    case 'degraded':
      return 'border-yellow-500/30';
    default:
      return 'border-red-500/30';
  }
}

export function DashboardPanel({ compact = false }: { compact?: boolean }) {
  const { t } = useTranslation();
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [cost, setCost] = useState<CostSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([getStatus(), getCost()])
      .then(([nextStatus, nextCost]) => {
        setStatus(nextStatus);
        setCost(nextCost);
      })
      .catch((err) => setError(err.message));
  }, []);

  if (error) {
    return (
      <div className={compact ? 'p-4' : 'p-6'}>
        <div className="rounded-lg border border-red-700 bg-red-900/30 p-4 text-red-300">
          {t('dashboard.load_failed')}: {error}
        </div>
      </div>
    );
  }

  if (!status || !cost) {
    return (
      <div className={`flex items-center justify-center ${compact ? 'h-56 p-4' : 'h-64'}`}>
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-blue-500 border-t-transparent" />
      </div>
    );
  }

  const maxCost = Math.max(cost.session_cost_usd, cost.daily_cost_usd, cost.monthly_cost_usd, 0.001);
  const outerClassName = compact ? 'space-y-4 p-4' : 'space-y-6 p-6';
  const cardClassName = compact
    ? 'rounded-xl border border-gray-800 bg-gray-900 p-4'
    : 'rounded-xl border border-gray-800 bg-gray-900 p-5';
  const sectionGapClassName = compact ? 'grid grid-cols-1 gap-4 xl:grid-cols-3' : 'grid grid-cols-1 gap-6 lg:grid-cols-3';
  const summaryGridClassName = compact
    ? 'grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4'
    : 'grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4';

  return (
    <div className={outerClassName}>
      <div className={summaryGridClassName}>
        <div className={cardClassName}>
          <div className="mb-3 flex items-center gap-3">
            <div className="rounded-lg bg-blue-600/20 p-2">
              <Cpu className="h-5 w-5 text-blue-400" />
            </div>
            <span className="text-sm text-gray-400">{t('dashboard.provider_model')}</span>
          </div>
          <p className="truncate text-lg font-semibold text-white">
            {status.provider ?? t('dashboard.unknown')}
          </p>
          <p className="truncate text-sm text-gray-400">{status.model}</p>
        </div>

        <div className={cardClassName}>
          <div className="mb-3 flex items-center gap-3">
            <div className="rounded-lg bg-green-600/20 p-2">
              <Clock className="h-5 w-5 text-green-400" />
            </div>
            <span className="text-sm text-gray-400">{t('dashboard.uptime')}</span>
          </div>
          <p className="text-lg font-semibold text-white">{formatUptime(status.uptime_seconds)}</p>
          <p className="text-sm text-gray-400">{t('dashboard.since_last_restart')}</p>
        </div>

        <div className={cardClassName}>
          <div className="mb-3 flex items-center gap-3">
            <div className="rounded-lg bg-purple-600/20 p-2">
              <Globe className="h-5 w-5 text-purple-400" />
            </div>
            <span className="text-sm text-gray-400">{t('dashboard.gateway_port')}</span>
          </div>
          <p className="text-lg font-semibold text-white">:{status.gateway_port}</p>
          <p className="text-sm text-gray-400">
            {t('dashboard.locale')}: {status.locale}
          </p>
        </div>

        <div className={cardClassName}>
          <div className="mb-3 flex items-center gap-3">
            <div className="rounded-lg bg-orange-600/20 p-2">
              <Database className="h-5 w-5 text-orange-400" />
            </div>
            <span className="text-sm text-gray-400">{t('dashboard.memory_backend')}</span>
          </div>
          <p className="text-lg font-semibold capitalize text-white">{status.memory_backend}</p>
          <p className="text-sm text-gray-400">
            {t('dashboard.paired')}: {status.paired ? t('common.yes') : t('common.no')}
          </p>
        </div>
      </div>

      <div className={sectionGapClassName}>
        <div className={cardClassName}>
          <div className="mb-4 flex items-center gap-2">
            <DollarSign className="h-5 w-5 text-blue-400" />
            <h2 className="text-base font-semibold text-white">{t('dashboard.cost_overview')}</h2>
          </div>
          <div className="space-y-4">
            {[
              { label: t('dashboard.session'), value: cost.session_cost_usd, color: 'bg-blue-500' },
              { label: t('dashboard.daily'), value: cost.daily_cost_usd, color: 'bg-green-500' },
              { label: t('dashboard.monthly'), value: cost.monthly_cost_usd, color: 'bg-purple-500' },
            ].map(({ label, value, color }) => (
              <div key={label}>
                <div className="mb-1 flex justify-between text-sm">
                  <span className="text-gray-400">{label}</span>
                  <span className="font-medium text-white">{formatUSD(value)}</span>
                </div>
                <div className="h-2 w-full overflow-hidden rounded-full bg-gray-800">
                  <div
                    className={`h-full rounded-full ${color}`}
                    style={{ width: `${Math.max((value / maxCost) * 100, 2)}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
          <div className="mt-4 flex justify-between border-t border-gray-800 pt-3 text-sm">
            <span className="text-gray-400">{t('dashboard.total_tokens')}</span>
            <span className="text-white">{cost.total_tokens.toLocaleString()}</span>
          </div>
          <div className="mt-1 flex justify-between text-sm">
            <span className="text-gray-400">{t('dashboard.requests')}</span>
            <span className="text-white">{cost.request_count.toLocaleString()}</span>
          </div>
        </div>

        <div className={cardClassName}>
          <div className="mb-4 flex items-center gap-2">
            <Radio className="h-5 w-5 text-blue-400" />
            <h2 className="text-base font-semibold text-white">{t('dashboard.active_channels')}</h2>
          </div>
          <div className="space-y-2">
            {Object.entries(status.channels).length === 0 ? (
              <div className="rounded-lg border border-dashed border-gray-700 bg-gray-950/40 p-4">
                <p className="text-sm text-gray-500">{t('dashboard.no_channels')}</p>
                <Link
                  to="/channels"
                  className="mt-3 inline-flex rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-blue-700"
                >
                  {t('dashboard.configure_channels')}
                </Link>
              </div>
            ) : (
              Object.entries(status.channels).map(([name, active]) => (
                <div
                  key={name}
                  className="flex items-center justify-between rounded-lg bg-gray-800/50 px-3 py-2"
                >
                  <span className="text-sm capitalize text-white">{name}</span>
                  <div className="flex items-center gap-2">
                    <span
                      className={`inline-block h-2.5 w-2.5 rounded-full ${
                        active ? 'bg-green-500' : 'bg-gray-500'
                      }`}
                    />
                    <span className="text-xs text-gray-400">
                      {active ? t('dashboard.active') : t('dashboard.inactive')}
                    </span>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        <div className={cardClassName}>
          <div className="mb-4 flex items-center gap-2">
            <Activity className="h-5 w-5 text-blue-400" />
            <h2 className="text-base font-semibold text-white">{t('dashboard.component_health')}</h2>
          </div>
          <div className="grid grid-cols-2 gap-3">
            {Object.entries(status.health.components).length === 0 ? (
              <p className="col-span-2 text-sm text-gray-500">{t('dashboard.no_components')}</p>
            ) : (
              Object.entries(status.health.components).map(([name, comp]) => (
                <div
                  key={name}
                  className={`rounded-lg border bg-gray-800/50 p-3 ${healthBorder(comp.status)}`}
                >
                  <div className="mb-1 flex items-center gap-2">
                    <span className={`inline-block h-2 w-2 rounded-full ${healthColor(comp.status)}`} />
                    <span className="truncate text-sm font-medium capitalize text-white">{name}</span>
                  </div>
                  <p className="text-xs capitalize text-gray-400">{comp.status}</p>
                  {comp.restart_count > 0 && (
                    <p className="mt-1 text-xs text-yellow-400">
                      {t('dashboard.restarts')}: {comp.restart_count}
                    </p>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
