"use client";

import { AppShell } from "../../components/app-shell";
import { CollectionLoading } from "../../components/collection-loading";
import { useAuth } from "../../components/hooks/use-auth";
import { PageLoading } from "../../components/page-loading";
import { getUserLanguage, t } from "../../lib/i18n";

/** Show an immediate navigation state while the private detail route streams. */
export default function DraftDetailLoading() {
  const { isLoading, user, logout } = useAuth();
  if (isLoading || !user) return <PageLoading />;

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
      <div className="mx-auto flex min-h-[65vh] w-full max-w-[1360px] items-center justify-center pb-28 md:pb-10">
        <CollectionLoading label={t("common.loading", lang)} className="min-h-0 p-0" />
      </div>
    </AppShell>
  );
}
