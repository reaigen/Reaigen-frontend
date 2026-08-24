"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "../components/hooks/use-auth";
import { AppShell } from "../components/app-shell";
import { SettingsForm } from "../components/settings-form";
import { PageHeader } from "../components/page-header";
import { t, getUserLanguage } from "../lib/i18n";
import { PageLoading } from "../components/page-loading";

export default function SettingsPage() {
  const { isAuthenticated, isLoading, user, logout, refreshProfile } = useAuth();
  const router = useRouter();

  React.useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      router.replace("/");
    }
  }, [isLoading, isAuthenticated, router]);

  if (isLoading || !user) {
    return <PageLoading />;
  }

  const lang = getUserLanguage(user.localization);

  return (
    <AppShell user={user} onLogout={logout}>
      <div className="mx-auto w-full max-w-[1180px] pb-12">
        <PageHeader
          title={t("settings.title", lang)}
          description={t("settings.subtitle", lang)}
          className="mb-6 sm:mb-8"
        />
        <SettingsForm user={user} onSaved={() => refreshProfile()} />
      </div>
    </AppShell>
  );
}
