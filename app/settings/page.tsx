"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "../components/hooks/use-auth";
import { AppShell } from "../components/app-shell";
import { SettingsForm } from "../components/settings-form";
import { t, getUserLanguage } from "../lib/i18n";

export default function SettingsPage() {
  const { isAuthenticated, isLoading, user, logout, refreshProfile } = useAuth();
  const router = useRouter();

  React.useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      router.replace("/");
    }
  }, [isLoading, isAuthenticated, router]);

  if (isLoading || !user) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin h-8 w-8 border-2 border-foreground/20 border-t-foreground rounded-full" />
      </div>
    );
  }

  const lang = getUserLanguage(user.localization);

  return (
    <AppShell user={user} onLogout={logout}>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t("settings.title", lang)}</h1>
          <p className="text-muted-foreground mt-1">{t("settings.subtitle", lang)}</p>
        </div>
        <SettingsForm user={user} onSaved={() => refreshProfile()} />
      </div>
    </AppShell>
  );
}
