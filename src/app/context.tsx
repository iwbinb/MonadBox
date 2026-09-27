import { createContext, useContext, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { publicConfigSchema } from '../shared/config';
import type { PublicConfig } from '../shared/config';
import type { Locale } from '../shared/tools';

type State =
  { status: 'loading' } | { status: 'error' } | { status: 'ready'; config: PublicConfig };
const AppContext = createContext<{
  locale: Locale;
  setLocale: (value: Locale) => void;
  state: State;
  retry: () => void;
} | null>(null);
export function AppProvider({ children }: { children: ReactNode }) {
  const [locale, setLocale] = useState<Locale>(() => {
    try {
      return localStorage.getItem('monadbox.locale') === 'zh' ? 'zh' : 'en';
    } catch {
      return 'en';
    }
  });
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<State>({ status: 'loading' });
  useEffect(() => {
    document.documentElement.lang = locale === 'zh' ? 'zh-CN' : 'en';
    try {
      localStorage.setItem('monadbox.locale', locale);
    } catch {
      /* Preferences are optional. */
    }
  }, [locale]);
  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    setState({ status: 'loading' });
    async function load() {
      try {
        const response = await fetch('/api/v1/config', {
          signal: controller.signal,
          credentials: 'same-origin',
          cache: 'no-store',
        });
        if (!response.ok) throw new Error('Configuration unavailable');
        const payload: unknown = await response.json();
        if (typeof payload !== 'object' || !payload || !('data' in payload))
          throw new Error('Invalid response');
        const config = publicConfigSchema.parse(payload.data);
        if (active) setState({ status: 'ready', config });
      } catch {
        if (active) setState({ status: 'error' });
      }
    }
    void load();
    return () => {
      active = false;
      controller.abort();
    };
  }, [attempt]);
  return (
    <AppContext.Provider
      value={{ locale, setLocale, state, retry: () => setAttempt((a) => a + 1) }}
    >
      {children}
    </AppContext.Provider>
  );
}
export function useApp() {
  const value = useContext(AppContext);
  if (!value) throw new Error('Missing AppProvider');
  return { ...value, t: (en: string, zh: string) => (value.locale === 'en' ? en : zh) };
}
