"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { AppShell } from "../../components/app-shell";
import { useAuth } from "../../components/hooks/use-auth";
import { useLiveSplatAccess } from "../../components/hooks/use-live-splat-access";
import { useLiveScanCaptureDevice } from "../../components/hooks/use-live-scan-device";
import { ArrowLeftIcon, LockIcon, PlayIcon, VideoIcon } from "../../components/icons";
import { PageHeader } from "../../components/page-header";
import { PageLoading } from "../../components/page-loading";
import {
  createLiveSplatSession,
  listLiveSplatSessions,
  type LiveSplatSession,
} from "../../lib/api/client";
import { getSafeApiErrorMessage } from "../../lib/api/error-message";
import { getUserLanguage, t } from "../../lib/i18n";
import { Button } from "../../lib/ui/button";
import { Switch } from "../../lib/ui/switch";

const ACTIVE_STATES = new Set(["created", "starting", "capturing", "draining", "refining"]);

export default function LiveScanStartPage() {
  const { isAuthenticated, isLoading, user, logout } = useAuth();
  const { allowed, loading: accessLoading, access } = useLiveSplatAccess(isAuthenticated);
  const { supported: captureDevice, loading: deviceLoading } = useLiveScanCaptureDevice();
  const router = useRouter();
  const [latest, setLatest] = React.useState<LiveSplatSession | null>(null);
  const [starting, setStarting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [quality, setQuality] = React.useState<"fast" | "balanced" | "quality">("balanced");
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

  React.useEffect(() => {
    if (!allowed) return;
    let active = true;
    listLiveSplatSessions()
      .then(({ results }) => {
        if (!active) return;
        setLatest(results.find((session) => ACTIVE_STATES.has(session.status)) ?? null);
      })
      .catch(() => { if (active) setLatest(null); });
    return () => { active = false; };
  }, [allowed]);

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
          floor_preview: floorPreview,
          dragon_refinement: dragonRefinement,
          output_format: "sog",
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
      <div className="mx-auto w-full max-w-[1040px] pb-12">
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
        {access?.runtime.profile === "preview" ? (
          <p role="status" className="mt-5 rounded-2xl border border-sky-500/25 bg-sky-500/10 px-4 py-3 text-sm leading-relaxed text-sky-950 dark:text-sky-100">
            {t("liveScan.previewMode", lang)}
          </p>
        ) : null}

        <div className="mt-6 grid gap-4 md:grid-cols-3">
          {([
            ["liveScan.realtimeTitle", "liveScan.realtimeDescription"],
            ["liveScan.durableTitle", "liveScan.durableDescription"],
            ["liveScan.floorTitle", "liveScan.floorDescription"],
          ] as const).map(([titleKey, descriptionKey]) => (
            <div key={titleKey} className="rounded-[1.5rem] border border-border/60 bg-card/75 p-5 shadow-sm backdrop-blur-xl">
              <VideoIcon size={18} className="text-foreground/55" />
              <h2 className="mt-4 text-[15px] font-semibold">{t(titleKey, lang)}</h2>
              <p className="mt-1.5 text-[13px] leading-relaxed text-muted-foreground">{t(descriptionKey, lang)}</p>
            </div>
          ))}
        </div>

        <div className="mt-4 rounded-[1.875rem] border border-border/60 bg-card/80 p-5 shadow-[0_18px_50px_-42px_rgba(0,0,0,0.32)] backdrop-blur-2xl sm:p-7">
          <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <h2 className="text-lg font-semibold">{t("liveScan.readyTitle", lang)}</h2>
              <p className="mt-1 max-w-2xl text-sm leading-relaxed text-muted-foreground">
                {t("liveScan.readyDescription", lang)}
              </p>
              {error ? <p role="alert" className="mt-3 text-sm text-destructive">{error}</p> : null}
            </div>
            <div className="flex shrink-0 flex-col gap-2 sm:items-end">
              {latest ? (
                <Button variant="outline" onClick={() => router.push(`/create/live-scan/${latest.id}`)}>
                  {t("liveScan.continue", lang)}
                </Button>
              ) : null}
              <Button
                loading={starting}
                disabled={!captureDevice || access?.runtime_available !== true}
                onClick={startSession}
                className="h-11 rounded-full px-5 shadow-control"
              >
                <PlayIcon size={15} />
                {t("liveScan.start", lang)}
              </Button>
            </div>
          </div>

          {captureDevice ? (
          <div className="mt-6 border-t border-border/60 pt-5">
            <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">{t("liveScan.options", lang)}</p>
            <div className="mt-3 grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
              <div className="rounded-2xl border border-border/60 bg-background/50 p-4">
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
              </div>
              <div className="divide-y divide-border/60 rounded-2xl border border-border/60 bg-background/50 px-4">
                <label className="flex min-h-14 items-center justify-between gap-4 py-3 text-sm font-medium">
                  <span>{t("liveScan.floorPreview", lang)}</span>
                  <Switch checked={floorPreview} onCheckedChange={setFloorPreview} />
                </label>
                <label className="flex min-h-14 items-center justify-between gap-4 py-3 text-sm font-medium">
                  <span>{t("liveScan.dragonRefinement", lang)}</span>
                  <Switch
                    checked={dragonRefinement}
                    disabled={access?.capabilities.dragon_refinement !== true}
                    onCheckedChange={setDragonRefinement}
                  />
                </label>
              </div>
            </div>
            {access?.runtime_available !== true ? (
              <p role="status" className="mt-3 rounded-xl bg-amber-500/10 px-3 py-2 text-sm text-amber-800 dark:text-amber-200">
                {t("liveScan.runtimeUnavailable", lang)}
              </p>
            ) : null}
          </div>
          ) : (
            <p role="status" className="mt-6 rounded-2xl border border-border/60 bg-background/50 p-4 text-sm leading-relaxed text-muted-foreground">
              {t("liveScan.mobileRequired", lang)}
            </p>
          )}
        </div>
      </div>
    </AppShell>
  );
}
