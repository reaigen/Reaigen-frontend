"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AppShell } from "../components/app-shell";
import { BillingUpgradeFlow } from "../components/billing-upgrade-flow";
import { useAuth } from "../components/hooks/use-auth";
import { PageHeader } from "../components/page-header";
import { PageLoading } from "../components/page-loading";
import { getUserLanguage, t } from "../lib/i18n";
import { Button } from "../lib/ui/button";
import { ArrowLeftIcon } from "../components/icons";

export default function UpgradePage() {
  const { isAuthenticated, isLoading, user, logout } = useAuth();
  const router = useRouter();

  React.useEffect(() => {
    if (!isLoading && !isAuthenticated) router.replace("/");
  }, [isAuthenticated, isLoading, router]);

  if (isLoading || !user) return <PageLoading />;

  const lang = getUserLanguage(user.localization);
  return (
    <AppShell user={user} onLogout={logout}>
      <div className="mx-auto w-full max-w-[1180px] pb-12">
        <PageHeader
          eyebrow={t("upgrade.eyebrow", lang)}
          title={t("upgrade.title", lang)}
          description={t("upgrade.subtitle", lang)}
          actions={(
            <Button asChild variant="outline" size="sm">
              <Link href="/settings#billing">
                <ArrowLeftIcon size={15} />
                <span className="hidden sm:inline">{t("upgrade.back", lang)}</span>
              </Link>
            </Button>
          )}
          className="mb-4 sm:mb-5"
        />
        <BillingUpgradeFlow lang={lang} />
      </div>
    </AppShell>
  );
}
