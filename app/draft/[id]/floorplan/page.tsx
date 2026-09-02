"use client";

import { use, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AppShell } from "../../../components/app-shell";
import FloorplanEditor from "../../../components/floorplan-editor";
import { useAuth } from "../../../components/hooks/use-auth";
import { PageLoading } from "../../../components/page-loading";
import { getDraft, listUnits } from "../../../lib/api/client";
import { getUserLanguage, t } from "../../../lib/i18n";
import type { DraftDetailItem } from "../../../lib/tour-types";
import type { UnitLookup } from "../../../lib/unit-catalog";

/**
 * The floorplan editor as a real route: linkable, refresh-safe, and open
 * directly from anywhere — instead of overlay state buried in the detail page.
 */
export default function DraftFloorplanPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const draftId = parseInt(id, 10);
  const { isAuthenticated, isLoading, user, logout } = useAuth();
  const router = useRouter();
  const lang = getUserLanguage(user?.localization);
  const [draft, setDraft] = useState<DraftDetailItem | null>(null);
  const [units, setUnits] = useState<UnitLookup[]>([]);

  useEffect(() => {
    if (!isAuthenticated) return;
    let active = true;
    listUnits()
      .then((result) => {
        if (active) setUnits(result);
      })
      .catch(() => {
        // Units are a display preference; the editor falls back to metric.
      });
    return () => {
      active = false;
    };
  }, [isAuthenticated]);

  useEffect(() => {
    if (!isLoading && !isAuthenticated) router.replace("/");
  }, [isLoading, isAuthenticated, router]);

  // Floorplan authoring is desktop-only — the same gate the detail page keeps.
  useEffect(() => {
    if (window.matchMedia("(max-width: 767px)").matches) {
      router.replace(`/draft/${draftId}`);
    }
  }, [draftId, router]);

  useEffect(() => {
    if (!isAuthenticated || !Number.isFinite(draftId)) return;
    let active = true;
    getDraft(draftId)
      .then((data) => {
        if (active) setDraft(data);
      })
      .catch(() => {
        if (active) router.replace(`/draft/${draftId}`);
      });
    return () => {
      active = false;
    };
  }, [isAuthenticated, draftId, router]);

  if (isLoading || !user || !draft) return <PageLoading />;

  return (
    <AppShell
      user={user}
      onLogout={logout}
      hideMobileNav
      reaiWorkspaceContext="floorplan"
      headerBackHref={`/draft/${draftId}`}
      headerBackLabel={draft.title || undefined}
      headerTitle={t("floorplan.editor.title", lang)}
    >
      <FloorplanEditor
        draftId={draftId}
        draftData={draft.draft_data ?? []}
        lang={lang}
        units={units}
        targetAreaUnit={draft.area_preferred_unit ?? draft.area_unit}
        onClose={() => router.push(`/draft/${draftId}`)}
        onSaved={(entries) =>
          setDraft((current) => {
            if (!current) return current;
            const byId = new Map((current.draft_data ?? []).map((entry) => [entry.id, entry]));
            for (const entry of entries) byId.set(entry.id, entry);
            return { ...current, draft_data: [...byId.values()] };
          })
        }
      />
    </AppShell>
  );
}
