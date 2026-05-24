import { Routes, Route, Navigate } from 'react-router-dom';
import { useState, useEffect, createContext, useContext } from 'react';
import { useTranslation } from 'react-i18next';
import Layout from './components/layout/Layout';
import Dashboard from './pages/Dashboard';
import AgentChat from './pages/AgentChat';
import Cron from './pages/Cron';
import Integrations from './pages/Integrations';
import Memory from './pages/Memory';
import Config from './pages/Config';
import Channels from './pages/Channels';
import Permissions from './pages/Permissions';
import DeerClawSettings from './pages/DeerClawSettings';
import Cost from './pages/Cost';
import Logs from './pages/Logs';
import Doctor from './pages/Doctor';
import SkillMarket from './pages/SkillMarket';
import Onboard from './pages/Onboard';
import { AuthProvider, useAuth } from './hooks/useAuth';
import { setLocale, type Locale } from './lib/i18n';
import { getOnboardStatus } from './lib/api';
import { Logo } from './components/ui/Logo';
import GlobalToast from './components/ui/GlobalToast';

// Locale context
interface LocaleContextType {
  locale: string;
  setAppLocale: (locale: string) => void;
}

export const LocaleContext = createContext<LocaleContextType>({
  locale: 'zh',
  setAppLocale: () => {},
});

export const useLocaleContext = () => useContext(LocaleContext);

// Pairing dialog component
function PairingDialog({ onPair }: { onPair: (code: string) => Promise<void> }) {
  const { t } = useTranslation();
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      await onPair(code);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : t('auth.pairing_failed'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center">
      <div className="bg-gray-900 rounded-xl p-8 w-full max-w-md border border-gray-800">
        <div className="text-center mb-6">
          <div className="flex justify-center mb-4">
            <Logo className="h-16 w-16" />
          </div>
          <h1 className="text-2xl font-bold text-white mb-2">DeerClaw</h1>
          <p className="text-gray-400">{t('auth.enter_code')}</p>
        </div>
        <form onSubmit={handleSubmit}>
          <input
            type="text"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder={t('auth.pairing_code')}
            className="w-full px-4 py-3 bg-gray-800 border border-gray-700 rounded-lg text-white text-center text-2xl tracking-widest focus:outline-none focus:border-blue-500 mb-4"
            maxLength={6}
            autoFocus
          />
          {error && (
            <p className="text-red-400 text-sm mb-4 text-center">{error}</p>
          )}
          <button
            type="submit"
            disabled={loading || code.length < 6}
            className="w-full py-3 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-700 disabled:text-gray-500 text-white rounded-lg font-medium transition-colors"
          >
            {loading ? t('auth.pairing') : t('auth.pair_button')}
          </button>
        </form>
      </div>
    </div>
  );
}

function AppContent() {
  const { t } = useTranslation();
  const { isAuthenticated, loading: authLoading, pair, logout } = useAuth();
  const [locale, setLocaleState] = useState('zh');
  const [onboardStatus, setOnboardStatus] = useState<{ configured: boolean } | null>(null);
  const [onboardLoading, setOnboardLoading] = useState(true);

  // Check onboarding status
  useEffect(() => {
    let cancelled = false;
    const checkOnboard = async (retries = 10, delay = 500) => {
      try {
        const status = await getOnboardStatus();
        if (cancelled) return;
        setOnboardStatus(status);
        setOnboardLoading(false);
      } catch (err) {
        if (cancelled) return;
        if (retries > 0) {
          setTimeout(() => checkOnboard(retries - 1, delay), delay);
        } else {
          // If check fails after retries, assume configured to avoid blocking
          console.error('Failed to check onboard status', err);
          setOnboardStatus({ configured: true });
          setOnboardLoading(false);
        }
      }
    };

    checkOnboard();

    return () => {
      cancelled = true;
    };
  }, []);

  const setAppLocale = (newLocale: string) => {
    setLocaleState(newLocale);
    setLocale(newLocale as Locale);
  };

  // Listen for 401 events to force logout
  useEffect(() => {
    const handler = () => {
      logout();
    };
    window.addEventListener('zeroclaw-unauthorized', handler);
    return () => window.removeEventListener('zeroclaw-unauthorized', handler);
  }, [logout]);

  if (authLoading || onboardLoading) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center">
        <p className="text-gray-400">{t('common.loading')}</p>
      </div>
    );
  }

  // If not configured, show onboarding
  if (onboardStatus && !onboardStatus.configured) {
    return <Onboard />;
  }

  if (!isAuthenticated) {
    return <PairingDialog onPair={pair} />;
  }

  return (
    <LocaleContext.Provider value={{ locale, setAppLocale }}>
      <GlobalToast />
      <Routes>
        <Route element={<Layout />}>
          <Route path="/" element={<Navigate to="/agent" replace />} />
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/agent" element={<AgentChat />} />
          <Route path="/tools" element={<Navigate to="/integrations?tab=capabilities" replace />} />
          <Route path="/cron" element={<Cron />} />
          <Route path="/integrations" element={<Integrations />} />
          <Route path="/memory" element={<Memory />} />
          <Route path="/config" element={<Config />} />
          <Route path="/deerclaw-settings" element={<DeerClawSettings />} />
          <Route path="/channels" element={<Channels />} />
          <Route path="/permissions" element={<Permissions />} />
          <Route path="/cost" element={<Cost />} />
          <Route path="/logs" element={<Logs />} />
          <Route path="/doctor" element={<Doctor />} />
          <Route path="/skill-market" element={<SkillMarket />} />
          <Route path="*" element={<Navigate to="/agent" replace />} />
        </Route>
      </Routes>
    </LocaleContext.Provider>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <AppContent />
    </AuthProvider>
  );
}
