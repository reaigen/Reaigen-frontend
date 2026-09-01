"use client";

import { AppShell } from "../../components/app-shell";
import { DraftDetailSkeleton } from "../../components/draft-detail-skeleton";
import { useAuth } from "../../components/hooks/use-auth";
import { getUserLanguage, t } from "../../lib/i18n";

/** Show an immediate navigation state while the private detail route streams. */
export default function DraftDetailLoading() {
  const { isLoading, user, logout } = useAuth();
  if (isLoading || !user) {
    return <DraftDetailSkeleton label={t("common.loading", "en")} standalone />;
  }

  const lang = getUserLanguage(user.localization);
  return (
    <AppShell
      user={user}
      onLogout={logout}
      hideMobileNav
      headerBackHref="/dashboard"
      headerBackLabel={t("nav.dashboard", lang)}
      headerTitleLoading
    >
      <DraftDetailSkeleton label={t("common.loading", lang)} />
    </AppShell>
  );
}
