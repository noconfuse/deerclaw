import i18n from 'i18next';
import { initReactI18next, useTranslation } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';

import en from '../locales/en.json';
import zh from '../locales/zh.json';

// ---------------------------------------------------------------------------
// Types & Exports
// ---------------------------------------------------------------------------

export type Locale = 'en' | 'zh';

export const RESOURCES = {
  en: { translation: en },
  zh: { translation: zh },
};

// ---------------------------------------------------------------------------
// Initialization
// ---------------------------------------------------------------------------

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: RESOURCES,
    fallbackLng: 'zh',
    interpolation: {
      escapeValue: false, // React already safes from xss
    },
    detection: {
      order: ['localStorage'],
      lookupLocalStorage: 'zeroclaw_lng',
      caches: ['localStorage'],
    },
  });

export default i18n;

// ---------------------------------------------------------------------------
// Legacy/Compatibility API (to match previous custom implementation)
// ---------------------------------------------------------------------------

export function getLocale(): Locale {
  return (i18n.language as Locale) || 'zh';
}

export function setLocale(locale: Locale): void {
  i18n.changeLanguage(locale);
}

export const t = i18n.t.bind(i18n);

export function tLocale(key: string, locale: Locale): string {
  // i18next doesn't easily support one-off locale translation without changing state,
  // but we can use getFixedT if needed. For now, let's just use the global t
  // or a crude approximation if strictly needed.
  // Actually, i18n.getFixedT(locale) works.
  return i18n.getFixedT(locale)(key);
}

/**
 * React hook wrapper to maintain compatibility with existing components
 */
export function useLocale() {
  const { t, i18n } = useTranslation();
  return {
    locale: (i18n.language as Locale) || 'zh',
    t,
  };
}
