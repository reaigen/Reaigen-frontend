"use client";

import * as React from "react";
import {
  ApiError,
  login as apiLogin,
  register as apiRegister,
  logout as apiLogout,
  getProfile,
  type UserProfile,
} from "../../lib/api/client";

const SILENT_REFRESH_INTERVAL_MS = 45 * 60 * 1000;

export type AuthState = {
  isAuthenticated: boolean;
  user: UserProfile | null;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (data: {
    email: string;
    username: string;
    password: string;
    password_confirm: string;
    first_name: string;
    last_name: string;
    accept_privacy_policy: boolean;
    accept_terms: boolean;
  }) => Promise<void>;
  logout: () => void;
  refreshProfile: () => Promise<UserProfile | null>;
};

const AuthContext = React.createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = React.useState<UserProfile | null>(null);
  const [isLoading, setIsLoading] = React.useState(true);
  const userRef = React.useRef<UserProfile | null>(null);

  React.useEffect(() => {
    userRef.current = user;
  }, [user]);

  const refreshProfile = React.useCallback(async (): Promise<UserProfile | null> => {
    try {
      const profile = await getProfile();
      setUser(profile);
      return profile;
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        setUser(null);
        return null;
      }
      return userRef.current;
    }
  }, []);

  // Initial load
  React.useEffect(() => {
    refreshProfile().finally(() => setIsLoading(false));
  }, [refreshProfile]);

  // Silent refresh
  React.useEffect(() => {
    if (!user) return;
    const id = setInterval(() => { refreshProfile(); }, SILENT_REFRESH_INTERVAL_MS);
    return () => clearInterval(id);
  }, [user, refreshProfile]);

  // Refresh on tab re-focus
  React.useEffect(() => {
    if (!user) return;
    const handleVisibility = () => {
      if (document.visibilityState === "visible") refreshProfile();
    };
    document.addEventListener("visibilitychange", handleVisibility);
    return () => document.removeEventListener("visibilitychange", handleVisibility);
  }, [user, refreshProfile]);

  const login = React.useCallback(async (email: string, password: string) => {
    const result = await apiLogin(email, password);
    if (result?.user) {
      setUser(result.user as UserProfile);
      refreshProfile().catch(() => {});
      return;
    }
    let lastErr: unknown;
    for (let attempt = 0; attempt < 3; attempt++) {
      if (attempt > 0) await new Promise((r) => setTimeout(r, 500));
      try {
        const profile = await getProfile();
        if (profile) { setUser(profile); return; }
      } catch (e) { lastErr = e; }
    }
    const detail = lastErr instanceof ApiError
      ? `status=${lastErr.status} body=${lastErr.body?.slice(0, 120)}`
      : lastErr instanceof Error ? lastErr.message : "unknown";
    throw new Error(`Session failed: ${detail}`);
  }, [refreshProfile]);

  const register = React.useCallback(
    async (data: {
      email: string;
      username: string;
      password: string;
      password_confirm: string;
      first_name: string;
      last_name: string;
      accept_privacy_policy: boolean;
      accept_terms: boolean;
    }) => {
      await apiRegister(data);
      await refreshProfile();
    },
    [refreshProfile],
  );

  const logout = React.useCallback(async () => {
    try { await apiLogout(); } catch {}
    setUser(null);
  }, []);

  const value = React.useMemo<AuthState>(() => ({
    isAuthenticated: user !== null,
    user,
    isLoading,
    login,
    register,
    logout,
    refreshProfile,
  }), [user, isLoading, login, register, logout, refreshProfile]);

  return React.createElement(AuthContext.Provider, { value }, children);
}

export function useAuth(): AuthState {
  const ctx = React.useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
