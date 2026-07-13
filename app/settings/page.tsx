"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "../components/hooks/use-auth";
import { AppShell } from "../components/app-shell";
import { SettingsForm } from "../components/settings-form";
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
      <div className="mx-auto w-full max-w-2xl animate-fade-in space-y-6">
        <div className="border-b border-border/70 pb-5">
          <h1 className="text-[20px] font-semibold tracking-tight">{t("settings.title", lang)}</h1>
          <p className="text-[14px] text-muted-foreground mt-1">{t("settings.subtitle", lang)}</p>
        </div>
        <SettingsForm user={user} onSaved={() => refreshProfile()} />
      </div>
    </AppShell>
  );
}
