"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "../components/hooks/use-auth";
import { AppShell } from "../components/app-shell";
import { AccountSetupFlow } from "../components/account-setup-flow";
import { PageLoading } from "../components/page-loading";
import { t, getUserLanguage } from "../lib/i18n";

/**
 * Guided account setup. Opened once after sign-in while the account still has
 * gaps (see the dashboard), and reachable any time from the dashboard
 * reminder. Settings remains the place to edit each section afterwards.
 */
export default function AccountSetupPage() {
  const { isAuthenticated, isLoading, user, logout, refreshProfile } = useAuth();
  const router = useRouter();

  React.useEffect(() => {
    if (!isLoading && !isAuthenticated) router.replace("/");
  }, [isLoading, isAuthenticated, router]);

  if (isLoading || !user) return <PageLoading />;

  const lang = getUserLanguage(user.localization);
  return (
    <AppShell
      user={user}
      onLogout={logout}
      hideMobileNav
      reaiWorkspaceContext="settings"
      headerBackHref="/dashboard"
      headerBackLabel={t("nav.dashboard", lang)}
      headerTitle={t("setup.headerTitle", lang)}
    >
      <AccountSetupFlow user={user} lang={lang} onSaved={refreshProfile} />
    </AppShell>
  );
}
