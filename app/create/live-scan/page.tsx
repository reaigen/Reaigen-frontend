"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { AppShell } from "../../components/app-shell";
import { useAuth } from "../../components/hooks/use-auth";
import { useLiveSplatAccess } from "../../components/hooks/use-live-splat-access";
import { useLiveScanCaptureDevice } from "../../components/hooks/use-live-scan-device";
import { ArrowLeftIcon, LockIcon, PlayIcon } from "../../components/icons";
import { PageHeader } from "../../components/page-header";
import { PageLoading } from "../../components/page-loading";
import {
  createLiveSplatSession,
} from "../../lib/api/client";
import { getSafeApiErrorMessage } from "../../lib/api/error-message";
import { getUserLanguage, t } from "../../lib/i18n";
import { Button } from "../../lib/ui/button";
import { Switch } from "../../lib/ui/switch";

export default function LiveScanStartPage() {
  const { isAuthenticated, isLoading, user, logout } = useAuth();
  const { allowed, loading: accessLoading, access } = useLiveSplatAccess(isAuthenticated);
  const { supported: captureDevice, loading: deviceLoading } = useLiveScanCaptureDevice();
  const router = useRouter();
  const [starting, setStarting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [quality, setQuality] = React.useState<"fast" | "balanced" | "quality">("fast");
  const [floorPreview, setFloorPreview] = React.useState(true);
  const [dragonRefinement, setDragonRefinement] = React.useState(true);

  React.useEffect(() => {
    if (access && access.capabilities.dragon_refinement !== true) {
      setDragonRefinement(false);
    }
  }, [access]);

  React.useEffect(() => {
    if (!isLoading && !isAuthenticated) router.replace("/");
  }, [isAuthenticated, isLoading, router]);

  if (isLoading || accessLoading || deviceLoading || !user) return <PageLoading />;
  const lang = getUserLanguage(user.localization);

  if (!allowed) {
    return (
      <AppShell user={user} onLogout={logout}>
        <div className="mx-auto flex min-h-[60vh] max-w-lg items-center justify-center">
          <div className="floating-panel w-full p-8 text-center">
            <LockIcon size={22} className="mx-auto text-foreground/40" />
            <h1 className="mt-4 text-xl font-semibold">{t("liveScan.restrictedTitle", lang)}</h1>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
              {t("liveScan.restrictedDescription", lang)}
            </p>
            <Button className="mt-5" variant="outline" onClick={() => router.push("/dashboard")}>
              {t("common.back", lang)}
            </Button>
          </div>
        </div>
      </AppShell>
    );
  }

  const startSession = async () => {
    if (!captureDevice) return;
    setStarting(true);
    setError(null);
    try {
      const session = await createLiveSplatSession({
        postprocess: {
          quality,
          floor_preview: access?.capabilities.automatic_floor_retry === true && floorPreview,
          dragon_refinement: dragonRefinement,
          output_format: "ply",
        },
      });
      router.push(`/create/live-scan/${session.id}`);
    } catch (err) {
      setError(getSafeApiErrorMessage(err, lang, "liveScan.startFailed"));
      setStarting(false);
    }
  };

  return (
    <AppShell user={user} onLogout={logout} hideMobileNav>
      <div className="mx-auto w-full max-w-[720px] pb-12">
        <button
          type="button"
          onClick={() => router.push("/create")}
          aria-label={t("common.back", lang)}
          className="floating-icon-button pen-touch-target mb-5 border border-border/60 bg-card/75 text-foreground/65 shadow-sm backdrop-blur-xl transition-colors hover:bg-foreground hover:text-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <ArrowLeftIcon size={17} />
        </button>
        <PageHeader title={t("liveScan.title", lang)} description={t("liveScan.subtitle", lang)} />

        {access?.runtime.profile === "contract-test" ? (
          <p role="status" className="mt-5 rounded-2xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm leading-relaxed text-amber-900 dark:text-amber-100">
            {t("liveScan.contractTest", lang)}
          </p>
        ) : null}
        <div className="mt-6 rounded-[1.875rem] border border-border/60 bg-card/80 p-5 shadow-[0_18px_50px_-42px_rgba(0,0,0,0.32)] backdrop-blur-2xl sm:p-7">
          <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <h2 className="text-lg font-semibold">{t("liveScan.readyTitle", lang)}</h2>
              <p className="mt-1 max-w-2xl text-sm leading-relaxed text-muted-foreground">
                {t("liveScan.readyDescription", lang)}
              </p>
              {error ? <p role="alert" className="mt-3 text-sm text-destructive">{error}</p> : null}
            </div>
            <Button
              loading={starting}
              disabled={!captureDevice || access?.runtime_available !== true}
              onClick={startSession}
              className="h-11 shrink-0 rounded-full px-5 shadow-control"
            >
              <PlayIcon size={15} />
              {t("liveScan.start", lang)}
            </Button>
          </div>

          {captureDevice ? (
          <details className="mt-5 border-t border-border/60 pt-4">
            <summary className="cursor-pointer select-none text-sm font-medium text-muted-foreground marker:text-muted-foreground">
              {t("liveScan.options", lang)} · {t(`liveScan.quality.${quality}`, lang)}
            </summary>
            <div className="mt-4 rounded-2xl border border-border/60 bg-background/50 p-4">
              <p className="text-sm font-semibold">{t("liveScan.quality", lang)}</p>
              <div className="selection-capsule-track mt-3 grid grid-cols-3" role="group" aria-label={t("liveScan.quality", lang)}>
                {(["fast", "balanced", "quality"] as const).map((value) => (
                  <button
                    key={value}
                    type="button"
                    aria-pressed={quality === value}
                    onClick={() => setQuality(value)}
                    className="selection-capsule-item pen-touch-target min-w-0 px-2 text-[11px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <span className="truncate">{t(`liveScan.quality.${value}`, lang)}</span>
                  </button>
                ))}
              </div>
              {access?.capabilities.automatic_floor_retry === true ? (
                <label className="mt-4 flex min-h-11 items-center justify-between gap-4 border-t border-border/60 pt-3 text-sm font-medium">
                  <span>{t("liveScan.floorPreview", lang)}</span>
                  <Switch checked={floorPreview} onCheckedChange={setFloorPreview} />
                </label>
              ) : null}
              {access?.capabilities.dragon_refinement === true ? (
                <label className="mt-3 flex min-h-11 items-center justify-between gap-4 border-t border-border/60 pt-3 text-sm font-medium">
                  <span>{t("liveScan.dragonRefinement", lang)}</span>
                  <Switch checked={dragonRefinement} onCheckedChange={setDragonRefinement} />
                </label>
              ) : null}
            </div>
            {access?.runtime_available !== true ? (
              <p role="status" className="mt-3 rounded-xl bg-amber-500/10 px-3 py-2 text-sm text-amber-800 dark:text-amber-200">
                {t("liveScan.runtimeUnavailable", lang)}
              </p>
            ) : null}
          </details>
          ) : !captureDevice ? (
            <p role="status" className="mt-6 rounded-2xl border border-border/60 bg-background/50 p-4 text-sm leading-relaxed text-muted-foreground">
              {t("liveScan.mobileRequired", lang)}
            </p>
          ) : null}
        </div>
      </div>
    </AppShell>
  );
}
