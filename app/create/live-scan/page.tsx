"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { AppShell } from "../../components/app-shell";
import { useAuth } from "../../components/hooks/use-auth";
import { useLiveSplatAccess } from "../../components/hooks/use-live-splat-access";
import { useLiveScanCaptureDevice } from "../../components/hooks/use-live-scan-device";
import { LockIcon } from "../../components/icons";
import { PageLoading } from "../../components/page-loading";
import {
  createLiveSplatSession,
  startLiveSplatSession,
} from "../../lib/api/client";
import { getUserLanguage, t } from "../../lib/i18n";
import { Button } from "../../lib/ui/button";

const LIVE_SCAN_PIPELINE_QUALITY = "fast" as const;

export default function LiveScanStartPage() {
  const { isAuthenticated, isLoading, user, logout } = useAuth();
  const { allowed, loading: accessLoading, access } = useLiveSplatAccess(isAuthenticated);
  const { supported: captureDevice, loading: deviceLoading } = useLiveScanCaptureDevice();
  const router = useRouter();
  const [starting, setStarting] = React.useState(false);
  const [startFailed, setStartFailed] = React.useState(false);
  const attemptedRef = React.useRef(false);

  React.useEffect(() => {
    if (!isLoading && !isAuthenticated) router.replace("/");
  }, [isAuthenticated, isLoading, router]);

  const startSession = React.useCallback(async () => {
    if (!captureDevice || access?.runtime_available !== true) return;
    setStarting(true);
    setStartFailed(false);
    try {
      const session = await createLiveSplatSession({
        postprocess: {
          quality: LIVE_SCAN_PIPELINE_QUALITY,
          floor_preview: access.capabilities.automatic_floor_retry === true,
          dragon_refinement: access.capabilities.dragon_refinement === true,
          output_format: "ply",
        },
      });
      try {
        // Otter requires prewarming before capture. Dispatch while the
        // workspace and camera are opening; its normal start path remains a
        // safe retry if this best-effort request hits transient GPU capacity.
        await startLiveSplatSession(session.id);
      } catch {
        // The durable session still exists, so navigating preserves the scan
        // and lets the workspace retry without creating a duplicate session.
      }
      router.push(`/create/live-scan/${session.id}`);
    } catch {
      setStartFailed(true);
      setStarting(false);
    }
  }, [access, captureDevice, router]);

  React.useEffect(() => {
    if (
      isLoading
      || accessLoading
      || deviceLoading
      || !user
      || !allowed
      || !captureDevice
      || access?.runtime_available !== true
      || attemptedRef.current
    ) return;
    attemptedRef.current = true;
    void startSession();
  }, [
    access?.runtime_available,
    accessLoading,
    allowed,
    captureDevice,
    deviceLoading,
    isLoading,
    startSession,
    user,
  ]);

  if (isLoading || accessLoading || deviceLoading || !user) return <PageLoading />;
  const lang = getUserLanguage(user.localization);

  if (!allowed) {
    return (
      <AppShell user={user} onLogout={logout}>
        <div className="mx-auto flex min-h-[60vh] max-w-lg items-center justify-center">
          <div className="floating-panel w-full p-8 text-center">
            <LockIcon size={22} className="mx-auto text-foreground/40" />
            <h1 className="mt-4 text-xl font-semibold">{t("liveScan.restrictedTitle", lang)}</h1>
            <Button className="mt-5" variant="outline" onClick={() => router.push("/dashboard")}>
              {t("common.back", lang)}
            </Button>
          </div>
        </div>
      </AppShell>
    );
  }

  if (starting && !startFailed) return <PageLoading />;

  const unavailable = !captureDevice || access?.runtime_available !== true;
  if (!unavailable && !startFailed) return <PageLoading />;

  return (
    <AppShell user={user} onLogout={logout} hideMobileNav>
      <div className="mx-auto flex min-h-[60vh] max-w-lg items-center justify-center">
        <div className="floating-panel w-full p-8 text-center">
          <h1 className="text-xl font-semibold">
            {!captureDevice
              ? t("liveScan.mobileRequired", lang)
              : unavailable
                ? t("liveScan.runtimeUnavailable", lang)
                : t("liveScan.startFailed", lang)}
          </h1>
          <Button
            className="mt-5 h-11 rounded-full px-5"
            onClick={unavailable
              ? () => router.push("/create")
              : () => {
                  attemptedRef.current = true;
                  void startSession();
                }}
          >
            {unavailable ? t("common.back", lang) : t("common.retry", lang)}
          </Button>
        </div>
      </div>
    </AppShell>
  );
}
