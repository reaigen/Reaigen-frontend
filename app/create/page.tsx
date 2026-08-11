"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { AppShell } from "../components/app-shell";
import { useAuth } from "../components/hooks/use-auth";
import { useWebAuthoringAccess } from "../components/hooks/use-web-authoring-access";
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  DocumentIcon,
  LockIcon,
  TourIcon,
} from "../components/icons";
import { PageHeader } from "../components/page-header";
import { PageLoading } from "../components/page-loading";
import {
  createWebDraft,
  createWebTour,
  listDrafts,
} from "../lib/api/client";
import { getUserLanguage, t } from "../lib/i18n";
import { Button } from "../lib/ui/button";
import { Input } from "../lib/ui/input";
import { Label } from "../lib/ui/label";
import { Textarea } from "../lib/ui/textarea";
import { cn } from "../lib/utils";
import type { DraftListingItem } from "../lib/tour-types";

type CreationMode = "draft" | "tour";

export default function WebCreatePage() {
  const { isAuthenticated, isLoading, user, logout } = useAuth();
  const router = useRouter();
  const { allowed, loading: accessLoading } = useWebAuthoringAccess(isAuthenticated);
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
    } catch {
      setError(t("webCreate.createFailed", lang));
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
    } catch {
      setError(t("webCreate.createFailed", lang));
      setSubmitting(false);
    }
  };

  return (
    <AppShell user={user} onLogout={logout}>
      <div className="mx-auto w-full max-w-[980px] pb-12">
        <Button variant="ghost" size="sm" className="mb-5 -ml-2" onClick={() => router.push("/dashboard")}>
          <ArrowLeftIcon size={14} />
          {t("common.back", lang)}
        </Button>
        <PageHeader
          eyebrow={t("webCreate.permissionEyebrow", lang)}
          title={t("webCreate.title", lang)}
          description={t("webCreate.subtitle", lang)}
          className="mb-7"
        />

        <div className="grid gap-3 sm:grid-cols-2">
          {([
            ["draft", DocumentIcon, "webCreate.draftTitle", "webCreate.draftDescription"],
            ["tour", TourIcon, "webCreate.tourTitle", "webCreate.tourDescription"],
          ] as const).map(([value, Icon, titleKey, descriptionKey]) => (
            <button
              key={value}
              type="button"
              onClick={() => { setMode(value); setError(null); }}
              className={cn(
                "rounded-[1.35rem] border p-5 text-left transition-all",
                mode === value
                  ? "border-foreground/20 bg-foreground/[0.045] shadow-control"
                  : "border-border bg-card hover:border-foreground/15",
              )}
            >
              <Icon size={18} className="text-foreground/55" />
              <span className="mt-3 block text-[15px] font-semibold">{t(titleKey, lang)}</span>
              <span className="mt-1 block text-[12px] leading-relaxed text-muted-foreground">
                {t(descriptionKey, lang)}
              </span>
            </button>
          ))}
        </div>

        <div className="mt-5 rounded-[1.5rem] border border-border bg-card p-5 shadow-sm sm:p-7">
          {mode === "draft" ? (
            <form onSubmit={submitDraft} className="space-y-5">
              <div>
                <h2 className="text-lg font-semibold">{t("webCreate.draftFormTitle", lang)}</h2>
                <p className="mt-1 text-[13px] text-muted-foreground">{t("webCreate.draftFormHint", lang)}</p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="creation-title">{t("webCreate.listingTitle", lang)}</Label>
                <Input
                  id="creation-title"
                  required
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  placeholder={t("webCreate.listingTitlePlaceholder", lang)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="creation-description">{t("webCreate.description", lang)}</Label>
                <Textarea
                  id="creation-description"
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                  placeholder={t("webCreate.descriptionPlaceholder", lang)}
                />
              </div>
              <div className="grid gap-4 sm:grid-cols-3">
                <div className="space-y-2 sm:col-span-3">
                  <Label htmlFor="creation-address">{t("webCreate.address", lang)}</Label>
                  <Input id="creation-address" value={address} onChange={(event) => setAddress(event.target.value)} />
                </div>
                <div className="space-y-2 sm:col-span-2">
                  <Label htmlFor="creation-city">{t("webCreate.city", lang)}</Label>
                  <Input id="creation-city" value={city} onChange={(event) => setCity(event.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="creation-country">{t("webCreate.country", lang)}</Label>
                  <Input id="creation-country" value={country} onChange={(event) => setCountry(event.target.value)} />
                </div>
              </div>
              {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
              <div className="flex justify-end">
                <Button type="submit" loading={submitting} disabled={!title.trim()}>
                  {t("webCreate.createDraft", lang)}
                  <ArrowRightIcon size={14} />
                </Button>
              </div>
            </form>
          ) : (
            <form onSubmit={submitTour} className="space-y-5">
              <div>
                <h2 className="text-lg font-semibold">{t("webCreate.tourFormTitle", lang)}</h2>
                <p className="mt-1 text-[13px] text-muted-foreground">{t("webCreate.tourFormHint", lang)}</p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="tour-draft">{t("webCreate.chooseDraft", lang)}</Label>
                <select
                  id="tour-draft"
                  required
                  value={selectedDraftId}
                  onChange={(event) => setSelectedDraftId(event.target.value)}
                  className="flex h-11 w-full rounded-xl border border-input bg-card px-4 text-sm outline-none focus:ring-2 focus:ring-ring"
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
                <Button type="submit" loading={submitting} disabled={!selectedDraftId}>
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
