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
  register: (email: string, username: string, password: string) => Promise<void>;
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
    await apiLogin(email, password);
    await refreshProfile();
  }, [refreshProfile]);

  const register = React.useCallback(
    async (email: string, username: string, password: string) => {
      await apiRegister({ email, username, password });
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
