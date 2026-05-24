import { useState } from 'react';
import {
  Stethoscope,
  Play,
  CheckCircle,
  AlertTriangle,
  XCircle,
  Loader2,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { DiagResult } from '@/types/api';
import { runDoctor } from '@/lib/api';
import { useNotify } from '@/hooks/useNotify';

function severityIcon(severity: DiagResult['severity']) {
  switch (severity) {
    case 'ok':
      return <CheckCircle className="h-4 w-4 shrink-0 text-green-400" />;
    case 'warn':
      return <AlertTriangle className="h-4 w-4 shrink-0 text-yellow-400" />;
    case 'error':
      return <XCircle className="h-4 w-4 shrink-0 text-red-400" />;
  }
}

function severityBorder(severity: DiagResult['severity']): string {
  switch (severity) {
    case 'ok':
      return 'border-green-700/40';
    case 'warn':
      return 'border-yellow-700/40';
    case 'error':
      return 'border-red-700/40';
  }
}

function severityBg(severity: DiagResult['severity']): string {
  switch (severity) {
    case 'ok':
      return 'bg-green-900/10';
    case 'warn':
      return 'bg-yellow-900/10';
    case 'error':
      return 'bg-red-900/10';
  }
}

export default function Doctor() {
  const { t } = useTranslation();
  const notify = useNotify();
  const [results, setResults] = useState<DiagResult[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleRun = async () => {
    setLoading(true);
    setError(null);
    setResults(null);
    try {
      const data = await runDoctor();
      setResults(data);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : t('doctor.run_failed');
      setError(message);
      notify.error(message, { key: 'doctor:run:error' });
    } finally {
      setLoading(false);
    }
  };

  // Compute summary counts
  const okCount = results?.filter((r) => r.severity === 'ok').length ?? 0;
  const warnCount = results?.filter((r) => r.severity === 'warn').length ?? 0;
  const errorCount = results?.filter((r) => r.severity === 'error').length ?? 0;

  // Group by category
  const grouped =
    results?.reduce<Record<string, DiagResult[]>>((acc, item) => {
      const key = item.category;
      if (!acc[key]) acc[key] = [];
      acc[key].push(item);
      return acc;
    }, {}) ?? {};

  const formatSeverity = (severity: DiagResult['severity']) => {
    if (severity === 'ok') return t('doctor.ok');
    if (severity === 'warn') return t('doctor.warn');
    return t('doctor.error');
  };

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Stethoscope className="h-5 w-5 text-blue-400" />
          <h2 className="text-base font-semibold text-white">{t('doctor.title')}</h2>
        </div>
        <button
          onClick={handleRun}
          disabled={loading}
          className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors disabled:opacity-50"
        >
          {loading ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              {t('doctor.running_short')}
            </>
          ) : (
            <>
              <Play className="h-4 w-4" />
              {t('doctor.run')}
            </>
          )}
        </button>
      </div>

      {/* Error */}
      {error && (
        <div className="rounded-lg bg-red-900/30 border border-red-700 p-4 text-red-300">
          {error}
        </div>
      )}

      {/* Loading spinner */}
      {loading && (
        <div className="flex flex-col items-center justify-center py-16">
          <Loader2 className="h-10 w-10 text-blue-500 animate-spin mb-4" />
          <p className="text-gray-400">{t('doctor.running')}</p>
          <p className="text-sm text-gray-500 mt-1">
            {t('doctor.running_hint')}
          </p>
        </div>
      )}

      {/* Results */}
      {results && !loading && (
        <>
          {/* Summary Bar */}
          <div className="flex items-center gap-4 bg-gray-900 rounded-xl border border-gray-800 p-4">
            <div className="flex items-center gap-2">
              <CheckCircle className="h-5 w-5 text-green-400" />
              <span className="text-sm text-white font-medium">
                {okCount}{' '}
                <span className="text-gray-400 font-normal">{t('doctor.ok')}</span>
              </span>
            </div>
            <div className="w-px h-5 bg-gray-700" />
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-yellow-400" />
              <span className="text-sm text-white font-medium">
                {warnCount}{' '}
                <span className="text-gray-400 font-normal">
                  {t('doctor.warn')}
                </span>
              </span>
            </div>
            <div className="w-px h-5 bg-gray-700" />
            <div className="flex items-center gap-2">
              <XCircle className="h-5 w-5 text-red-400" />
              <span className="text-sm text-white font-medium">
                {errorCount}{' '}
                <span className="text-gray-400 font-normal">
                  {t('doctor.error')}
                </span>
              </span>
            </div>

            {/* Overall indicator */}
            <div className="ml-auto">
              {errorCount > 0 ? (
                <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium bg-red-900/40 text-red-400 border border-red-700/50">
                  {t('doctor.issues_found')}
                </span>
              ) : warnCount > 0 ? (
                <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium bg-yellow-900/40 text-yellow-400 border border-yellow-700/50">
                  {t('doctor.warnings')}
                </span>
              ) : (
                <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium bg-green-900/40 text-green-400 border border-green-700/50">
                  {t('doctor.all_clear')}
                </span>
              )}
            </div>
          </div>

          {/* Grouped Results */}
          {Object.entries(grouped)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([category, items]) => (
              <div key={category}>
                <h3 className="mb-3 text-sm font-semibold uppercase tracking-wider text-gray-400">
                  {category}
                </h3>
                <div className="space-y-2">
                  {items.map((result, idx) => (
                    <div
                      key={`${category}-${idx}`}
                      className={`flex items-start gap-3 rounded-lg border p-3 ${severityBorder(
                        result.severity,
                      )} ${severityBg(result.severity)}`}
                    >
                      {severityIcon(result.severity)}
                      <div className="min-w-0">
                        <p className="text-sm text-white">{result.message}</p>
                        <p className="text-xs text-gray-500 mt-0.5 capitalize">
                          {formatSeverity(result.severity)}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
        </>
      )}

      {/* Empty state */}
      {!results && !loading && !error && (
        <div className="flex flex-col items-center justify-center py-16 text-gray-500">
          <Stethoscope className="h-12 w-12 text-gray-600 mb-4" />
          <p className="text-lg font-medium">{t('doctor.empty_title')}</p>
          <p className="text-sm mt-1">
            {t('doctor.empty_hint')}
          </p>
        </div>
      )}
    </div>
  );
}
