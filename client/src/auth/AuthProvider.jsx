import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { api, setCsrfToken } from '../lib/api.js';

/**
 * Session state for the whole app.
 *
 * `status` is deliberately explicit — the UI never guesses whether you are
 * signed in, it waits for /api/auth/me. That is what keeps the login page as
 * the first screen instead of flashing protected cards for a frame.
 */
const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [status, setStatus] = useState('checking'); // checking | authed | anon
  const [user, setUser] = useState(null);
  const [config, setConfig] = useState(null);
  const [flash, setFlash] = useState(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    api('/auth/config')
      .then((data) => mounted.current && setConfig(data))
      .catch(() => {});
  }, []);

  const applySession = useCallback((payload) => {
    if (!payload) return;
    setCsrfToken(payload.csrfToken);
    setUser(payload.user ?? null);
    setStatus(payload.user ? 'authed' : 'anon');
  }, []);

  const refresh = useCallback(async () => {
    try {
      const me = await api('/auth/me');
      if (!mounted.current) return;
      applySession(me);
    } catch {
      if (!mounted.current) return;
      setUser(null);
      setStatus('anon');
    }
  }, [applySession]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const run = useCallback(async (path, body) => {
    const res = await api(path, { method: 'POST', body });
    if (!mounted.current) return res;
    applySession(res);
    return res;
  }, [applySession]);

  const value = useMemo(
    () => ({
      status,
      user,
      isAuthenticated: status === 'authed' && Boolean(user),
      config,
      flash,
      setFlash,
      login: (email, password) => run('/auth/login', { email, password }),
      register: (form) => run('/auth/register', form),
      googleDemo: (email, passcode) => run('/auth/google/demo', { email, passcode }),
      googleCredential: (credential) => run('/auth/google/credential', { credential }),
      logout: async () => {
        try {
          await api('/auth/logout', { method: 'POST', body: {} });
        } finally {
          setUser(null);
          setStatus('anon');
          setCsrfToken(null);
        }
      },
      refresh,
    }),
    [status, user, config, flash, refresh, run, applySession]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
