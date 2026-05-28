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

export function useAuth(): AuthState {
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

  React.useEffect(() => {
    refreshProfile().finally(() => setIsLoading(false));
  }, [refreshProfile]);

  const login = React.useCallback(async (email: string, password: string) => {
    const result = await apiLogin(email, password);
    // Backend returns user data alongside tokens — use it directly so we
    // don't depend on cookies being available for the immediate next fetch.
    if (result?.user) {
      setUser(result.user as UserProfile);
      // Still refresh in background to get the full profile shape
      refreshProfile().catch(() => {});
      return;
    }
    // Fallback: fetch profile via cookies — retry to handle cookie propagation delay
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
    throw new Error(`Session failed (login ok=${!!result}, user=${!!result?.user}, keys=${result ? Object.keys(result).join(",") : "null"}): ${detail}`);
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

  return {
    isAuthenticated: user !== null,
    user,
    isLoading,
    login,
    register,
    logout,
    refreshProfile,
  };
}
