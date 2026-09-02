"use client";

import { AppShell } from "../components/app-shell";
import { CollectionCardSkeletons } from "../components/collection-card-skeleton";
import { useAuth } from "../components/hooks/use-auth";
import { PageLoading } from "../components/page-loading";
import { getUserLanguage, t } from "../lib/i18n";

/** Paint immediately on navigation so the tours list never feels like a dead
    click while its route chunk and data stream in. */
export default function ToursLoading() {
  const { isLoading, user, logout } = useAuth();
  if (isLoading || !user) return <PageLoading />;

  const lang = getUserLanguage(user.localization);
  return (
    <AppShell user={user} onLogout={logout}>
      <div className="mx-auto w-full max-w-[1360px] pb-10">
        <CollectionCardSkeletons label={t("common.loading", lang)} count={4} columns={2} />
      </div>
    </AppShell>
  );
}
