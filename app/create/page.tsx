"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { AppShell } from "../components/app-shell";
import { useAuth } from "../components/hooks/use-auth";
import { useLiveSplatAccess } from "../components/hooks/use-live-splat-access";
import { useLiveScanCaptureDevice } from "../components/hooks/use-live-scan-device";
import { useWebAuthoringAccess } from "../components/hooks/use-web-authoring-access";
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  DocumentIcon,
  LockIcon,
  TourIcon,
  VideoIcon,
} from "../components/icons";
import { PageHeader } from "../components/page-header";
import { PageLoading } from "../components/page-loading";
import {
  createWebDraft,
  createWebTour,
  listDrafts,
} from "../lib/api/client";
import {
  getSafeApiErrorMessage,
  isInsufficientComputeCredits,
} from "../lib/api/error-message";
import { getUserLanguage, t } from "../lib/i18n";
import { Button } from "../lib/ui/button";
import { Input } from "../lib/ui/input";
import { Label } from "../lib/ui/label";
import { Textarea } from "../lib/ui/textarea";
import type { DraftListingItem } from "../lib/tour-types";

type CreationMode = "draft" | "tour";

export default function WebCreatePage() {
  const { isAuthenticated, isLoading, user, logout } = useAuth();
  const router = useRouter();
  const { allowed, loading: accessLoading } = useWebAuthoringAccess(isAuthenticated);
  const { allowed: liveScanAllowed } = useLiveSplatAccess(isAuthenticated);
  const { supported: liveScanDevice } = useLiveScanCaptureDevice();
  const [mode, setMode] = React.useState<CreationMode>("draft");
  const [drafts, setDrafts] = React.useState<DraftListingItem[]>([]);
  const [draftsLoading, setDraftsLoading] = React.useState(false);
  const [draftsLoaded, setDraftsLoaded] = React.useState(false);
  const [title, setTitle] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [address, setAddress] = React.useState("");
  const [city, setCity] = React.useState("");
  const [country, setCountry] = React.useState("");
  const [selectedDraftId, setSelectedDraftId] = React.useState("");
  const [tourName, setTourName] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!isLoading && !isAuthenticated) router.replace("/");
  }, [isAuthenticated, isLoading, router]);

  React.useEffect(() => {
    const requestedMode = new URLSearchParams(window.location.search).get("mode");
    if (requestedMode === "draft" || requestedMode === "tour") {
      setMode(requestedMode);
    }
  }, []);

  React.useEffect(() => {
    if (!allowed || mode !== "tour" || draftsLoaded || draftsLoading) return;
    let active = true;
    setDraftsLoading(true);
    listDrafts(1, 100)
      .then((draftPage) => {
        if (!active) return;
        setDrafts(draftPage.results ?? []);
        setDraftsLoaded(true);
      })
      .catch(() => {
        if (active) setDraftsLoaded(true);
      })
      .finally(() => {
        if (active) setDraftsLoading(false);
      });
    return () => { active = false; };
  }, [allowed, draftsLoaded, draftsLoading, mode]);

  if (isLoading || accessLoading || !user) return <PageLoading />;
  const lang = getUserLanguage(user.localization);

  if (!allowed) {
    return (
      <AppShell user={user} onLogout={logout}>
        <div className="mx-auto flex min-h-[60vh] max-w-lg items-center justify-center">
          <div className="floating-panel w-full p-8 text-center">
            <LockIcon size={22} className="mx-auto text-foreground/40" />
            <h1 className="mt-4 text-xl font-semibold">{t("webCreate.restrictedTitle", lang)}</h1>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
              {t("webCreate.restrictedDescription", lang)}
            </p>
            <Button className="mt-5" variant="outline" onClick={() => router.push("/dashboard")}>
              {t("common.back", lang)}
            </Button>
          </div>
        </div>
      </AppShell>
    );
  }

  const submitDraft = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!title.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      const draft = await createWebDraft({
        title: title.trim(),
        description: description.trim(),
        address: address.trim(),
        city: city.trim(),
        country: country.trim(),
      });
      router.push(`/draft/${draft.id}`);
    } catch (err) {
      setError(
        isInsufficientComputeCredits(err)
          ? t("errors.needMoreCredits", lang)
          : getSafeApiErrorMessage(err, lang, "webCreate.createFailed"),
      );
      setSubmitting(false);
    }
  };

  const submitTour = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!selectedDraftId) return;
    setSubmitting(true);
    setError(null);
    try {
      const workspace = await createWebTour({
        draft_id: Number(selectedDraftId),
        name: tourName.trim() || undefined,
      });
      router.push(`/create/tour/${workspace.tour_id}`);
    } catch (err) {
      setError(
        isInsufficientComputeCredits(err)
          ? t("errors.needMoreCredits", lang)
          : getSafeApiErrorMessage(err, lang, "webCreate.createFailed"),
      );
      setSubmitting(false);
    }
  };

  return (
    <AppShell user={user} onLogout={logout}>
      <div className="mx-auto w-full max-w-[920px] pb-12">
        <button
          type="button"
          onClick={() => router.push("/dashboard")}
          aria-label={t("common.back", lang)}
          title={t("common.back", lang)}
          className="floating-icon-button pen-touch-target mb-5 border border-border/60 bg-card/75 text-foreground/65 shadow-sm backdrop-blur-xl transition-[background-color,color,box-shadow] hover:bg-foreground hover:text-background hover:shadow-control focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          <ArrowLeftIcon size={17} />
        </button>
        <PageHeader
          title={t("webCreate.title", lang)}
          description={t("webCreate.subtitle", lang)}
          className="mb-6"
        />

        <div
          className={`selection-capsule-track grid ${liveScanAllowed && liveScanDevice ? "grid-cols-3" : "grid-cols-2"}`}
          role="group"
          aria-label={t("webCreate.title", lang)}
        >
          {([
            ["draft", DocumentIcon, "webCreate.draftTitle"],
            ["tour", TourIcon, "webCreate.tourTitle"],
          ] as const).map(([value, Icon, titleKey]) => (
            <button
              key={value}
              type="button"
              onClick={() => { setMode(value); setError(null); }}
              aria-pressed={mode === value}
              className="selection-capsule-item pen-touch-target min-w-0 px-2 text-[12px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:px-4 sm:text-[13px]"
            >
              <Icon size={15} className="shrink-0" />
              <span className="truncate">{t(titleKey, lang)}</span>
            </button>
          ))}
          {liveScanAllowed && liveScanDevice ? (
            <button
              type="button"
              onClick={() => router.push("/create/live-scan")}
              className="selection-capsule-item pen-touch-target min-w-0 px-2 text-[12px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:px-4 sm:text-[13px]"
            >
              <VideoIcon size={15} className="shrink-0" />
              <span className="truncate">{t("liveScan.title", lang)}</span>
            </button>
          ) : null}
        </div>

        <div className="mt-4 overflow-hidden rounded-[1.875rem] border border-border/60 bg-card/[0.80] shadow-[0_18px_50px_-42px_rgba(0,0,0,0.32)] backdrop-blur-2xl">
          {mode === "draft" ? (
            <form onSubmit={submitDraft} className="space-y-5 p-5 sm:p-7">
              <div className="flex items-start gap-3">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-foreground/[0.045] text-foreground/55 ring-1 ring-inset ring-border/35">
                  <DocumentIcon size={17} />
                </span>
                <div className="min-w-0 pt-0.5">
                  <h2 className="text-[17px] font-semibold">{t("webCreate.draftFormTitle", lang)}</h2>
                  <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">{t("webCreate.draftFormHint", lang)}</p>
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="creation-title">{t("webCreate.listingTitle", lang)}</Label>
                <Input
                  id="creation-title"
                  required
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  placeholder={t("webCreate.listingTitlePlaceholder", lang)}
                  className="h-12 rounded-2xl border-border/70 bg-card/75 px-4 shadow-none"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="creation-description">{t("webCreate.description", lang)}</Label>
                <Textarea
                  id="creation-description"
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                  placeholder={t("webCreate.descriptionPlaceholder", lang)}
                  className="min-h-[7rem] rounded-2xl border-border/70 bg-card/75 px-4 py-3 shadow-none"
                />
              </div>
              <div className="grid gap-4 sm:grid-cols-3">
                <div className="space-y-2 sm:col-span-3">
                  <Label htmlFor="creation-address">{t("webCreate.address", lang)}</Label>
                  <Input id="creation-address" value={address} onChange={(event) => setAddress(event.target.value)} className="h-12 rounded-2xl border-border/70 bg-card/75 px-4 shadow-none" />
                </div>
                <div className="space-y-2 sm:col-span-2">
                  <Label htmlFor="creation-city">{t("webCreate.city", lang)}</Label>
                  <Input id="creation-city" value={city} onChange={(event) => setCity(event.target.value)} className="h-12 rounded-2xl border-border/70 bg-card/75 px-4 shadow-none" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="creation-country">{t("webCreate.country", lang)}</Label>
                  <Input id="creation-country" value={country} onChange={(event) => setCountry(event.target.value)} className="h-12 rounded-2xl border-border/70 bg-card/75 px-4 shadow-none" />
                </div>
              </div>
              {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
              <div className="flex justify-end">
                <Button type="submit" loading={submitting} disabled={!title.trim()} className="h-11 rounded-full px-5 shadow-control">
                  {t("webCreate.createDraft", lang)}
                  <ArrowRightIcon size={14} />
                </Button>
              </div>
            </form>
          ) : (
            <form onSubmit={submitTour} className="space-y-5 p-5 sm:p-7">
              <div className="flex items-start gap-3">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-foreground/[0.045] text-foreground/55 ring-1 ring-inset ring-border/35">
                  <TourIcon size={17} />
                </span>
                <div className="min-w-0 pt-0.5">
                  <h2 className="text-[17px] font-semibold">{t("webCreate.tourFormTitle", lang)}</h2>
                  <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">{t("webCreate.tourFormHint", lang)}</p>
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="tour-draft">{t("webCreate.chooseDraft", lang)}</Label>
                <select
                  id="tour-draft"
                  required
                  value={selectedDraftId}
                  onChange={(event) => setSelectedDraftId(event.target.value)}
                  className="flex h-12 w-full rounded-2xl border border-border/70 bg-card/75 px-4 text-sm outline-none focus:ring-2 focus:ring-ring"
                >
                  <option value="">
                    {draftsLoading ? t("common.loading", lang) : t("webCreate.chooseDraftPlaceholder", lang)}
                  </option>
                  {drafts.map((draft) => (
                    <option key={draft.id} value={draft.id}>{draft.title || t("dashboard.untitled", lang)}</option>
                  ))}
                </select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="tour-name">{t("webCreate.tourName", lang)}</Label>
                <Input
                  id="tour-name"
                  value={tourName}
                  onChange={(event) => setTourName(event.target.value)}
                  placeholder={t("webCreate.tourNamePlaceholder", lang)}
                  className="h-12 rounded-2xl border-border/70 bg-card/75 px-4 shadow-none"
                />
              </div>
              <p className="rounded-xl bg-muted/45 px-4 py-3 text-[12px] leading-relaxed text-muted-foreground">
                {t("webCreate.uploadHint", lang)}
              </p>
              {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
              <div className="flex items-center justify-between gap-3">
                <Button type="button" variant="ghost" onClick={() => setMode("draft")}>
                  {t("webCreate.needDraft", lang)}
                </Button>
                <Button type="submit" loading={submitting} disabled={!selectedDraftId} className="h-11 rounded-full px-5 shadow-control">
                  {t("webCreate.openEditor", lang)}
                  <ArrowRightIcon size={14} />
                </Button>
              </div>
            </form>
          )}
        </div>
      </div>
    </AppShell>
  );
}
