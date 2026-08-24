"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  ApiError,
  login as apiLogin,
  register as apiRegister,
  logout as apiLogout,
  getProfile,
  isStepUpChallenge,
  resetPrivateApiState,
  verifyStepUp,
  type StepUpChallenge,
  type UserProfile,
} from "../../lib/api/client";
import {
  AUTH_BOUNDARY_STORAGE_KEY,
  broadcastAuthBoundary,
  clearPrivateBrowserState,
} from "../../lib/private-client-state";
import {
  disableWebPushForUser,
  restoreWebPushForUser,
} from "../../lib/web-push";

const SILENT_REFRESH_INTERVAL_MS = 45 * 60 * 1000;

export type AuthState = {
  isAuthenticated: boolean;
  user: UserProfile | null;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<StepUpChallenge | void>;
  completeStepUp: (
    stepUpToken: string,
    method: "otp" | "totp",
    code: string,
  ) => Promise<void>;
  register: (data: {
    email: string;
    username: string;
    password: string;
    password_confirm: string;
    first_name: string;
    last_name: string;
    accept_privacy_policy: boolean;
    accept_terms: boolean;
    preferred_language: string;
    preferred_timezone: string;
  }) => Promise<void>;
  logout: () => Promise<void>;
  refreshProfile: () => Promise<UserProfile | null>;
};

const AuthContext = React.createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [user, setUser] = React.useState<UserProfile | null>(null);
  const [isLoading, setIsLoading] = React.useState(true);
  const userRef = React.useRef<UserProfile | null>(null);
  const logoutInFlightRef = React.useRef<Promise<void> | null>(null);

  React.useEffect(() => {
    userRef.current = user;
  }, [user]);

  // Repair an already-authorized browser subscription after login or a
  // cleared service worker. Never prompt here; permission prompts are only
  // triggered by the explicit Settings toggle.
  React.useEffect(() => {
    if (!user?.personalized_data?.push_notifications) return;
    void restoreWebPushForUser(user.id);
  }, [user?.id, user?.personalized_data?.push_notifications]);

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

  // Global session-expiry handler. The event fires only once the API client has
  // established that the identity is genuinely gone — either a proxy said so
  // outright, or a probe confirmed it — never on a bare 401, which is raised for
  // plenty of reasons that leave the session perfectly valid. If we were
  // authenticated, clear state and send the user to a clean login instead of
  // leaving them on a stale authenticated page.
  React.useEffect(() => {
    const handleUnauthorized = () => {
      const expiredUser = userRef.current;
      if (expiredUser === null) return; // not logged in / already on auth
      void disableWebPushForUser(expiredUser.id, {
        unregisterBackend: false,
      });
      void clearPrivateBrowserState();
      broadcastAuthBoundary("expired");
      setIsLoading(true);
      setUser(null);
      router.replace("/");
      window.requestAnimationFrame(() => setIsLoading(false));
    };
    window.addEventListener("reai:unauthorized", handleUnauthorized);
    return () => window.removeEventListener("reai:unauthorized", handleUnauthorized);
  }, [router]);

  // HttpOnly auth cookies are shared by tabs. When one tab logs out or changes
  // identity, every other tab must discard its mounted private state too.
  React.useEffect(() => {
    const handleAuthBoundary = (event: StorageEvent) => {
      if (event.key !== AUTH_BOUNDARY_STORAGE_KEY || !event.newValue) return;
      resetPrivateApiState();
      setIsLoading(true);
      setUser(null);
      router.replace("/");
      void clearPrivateBrowserState().finally(() => {
        setIsLoading(false);
      });
    };
    window.addEventListener("storage", handleAuthBoundary);
    return () => window.removeEventListener("storage", handleAuthBoundary);
  }, [router]);

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

  const adoptAuthenticatedResult = React.useCallback(async (result: unknown) => {
    // Invalidate anything that finished while the identity was changing.
    resetPrivateApiState();
    const withUser = result as { user?: UserProfile } | null;
    if (withUser?.user) {
      setUser(withUser.user);
      broadcastAuthBoundary("login");
      refreshProfile().catch(() => {});
      return;
    }
    let lastErr: unknown;
    for (let attempt = 0; attempt < 3; attempt++) {
      if (attempt > 0) await new Promise((r) => setTimeout(r, 500));
      try {
        const profile = await getProfile();
        if (profile) {
          setUser(profile);
          broadcastAuthBoundary("login");
          return;
        }
      } catch (e) { lastErr = e; }
    }
    const detail = lastErr instanceof ApiError
      ? `status=${lastErr.status} body=${lastErr.body?.slice(0, 120)}`
      : lastErr instanceof Error ? lastErr.message : "unknown";
    throw new Error(`Session failed: ${detail}`);
  }, [refreshProfile]);

  const login = React.useCallback(async (email: string, password: string) => {
    resetPrivateApiState();
    const result = await apiLogin(email, password);
    // High-risk sign-ins answer with a verification challenge instead of
    // tokens; hand it to the form so the user can enter the code.
    if (isStepUpChallenge(result)) {
      return result;
    }
    await adoptAuthenticatedResult(result);
  }, [adoptAuthenticatedResult]);

  const completeStepUp = React.useCallback(
    async (stepUpToken: string, method: "otp" | "totp", code: string) => {
      resetPrivateApiState();
      const result = await verifyStepUp(stepUpToken, method, code);
      await adoptAuthenticatedResult(result);
    },
    [adoptAuthenticatedResult],
  );

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
      preferred_language: string;
      preferred_timezone: string;
    }) => {
      await apiRegister(data);
      resetPrivateApiState();
      await refreshProfile();
      broadcastAuthBoundary("login");
    },
    [refreshProfile],
  );

  const logout = React.useCallback(async () => {
    if (logoutInFlightRef.current) return logoutInFlightRef.current;

    const transition = (async () => {
      const currentUser = userRef.current;
      // Move to a neutral transition frame immediately, then keep that single
      // frame mounted until cookies and private browser state are cleared.
      // A second hard reload here caused the signed-out home to flash twice.
      setIsLoading(true);
      setUser(null);
      router.replace("/");

      const tasks: Promise<unknown>[] = [clearPrivateBrowserState(), apiLogout()];
      if (currentUser) tasks.push(disableWebPushForUser(currentUser.id));
      await Promise.allSettled(tasks);
      broadcastAuthBoundary("logout");
      setIsLoading(false);
    })().finally(() => {
      logoutInFlightRef.current = null;
    });

    logoutInFlightRef.current = transition;
    return transition;
  }, [router]);

  const value = React.useMemo<AuthState>(() => ({
    isAuthenticated: user !== null,
    user,
    isLoading,
    login,
    completeStepUp,
    register,
    logout,
    refreshProfile,
  }), [user, isLoading, login, completeStepUp, register, logout, refreshProfile]);

  return React.createElement(AuthContext.Provider, { value }, children);
}

export function useAuth(): AuthState {
  const ctx = React.useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
