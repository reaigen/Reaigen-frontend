"use client";

import * as React from "react";
import { ListBulletIcon } from "@radix-ui/react-icons";
import { t, type LocaleKey } from "../../lib/i18n";
import {
  SHARE_BUNDLES,
  SHARE_FIELD_GROUPS,
  type ShareBundleName,
} from "../../lib/tour-types";
import { cn } from "../../lib/utils";
import { ArrowRightIcon, CheckIcon, FloorplanIcon, ImageIcon, LockIcon, MainTourIcon } from "../icons";
import { SidePanel } from "../side-panel";

// ── Content scope types ────────────────────────────────────────────────

export interface ContentScope {
  tour: boolean;
  photos: boolean;
  details: boolean;
  floorplan: boolean;
  selectedFields: Set<string>;
}

interface ContentScopeSelectorProps {
  scope: ContentScope;
  onChange: (scope: ContentScope) => void;
  hasTour: boolean;
  hasPhotos: boolean;
  hasFloorplan: boolean;
  lang: string;
  layout?: "default" | "workspace";
  detailsMode?: "panel" | "inline";
}

// ── Bundle detection ───────────────────────────────────────────────────

function detectBundle(selected: Set<string>, unavailable: Set<string>): ShareBundleName | null {
  const comparableSelected = [...selected].filter((field) => !unavailable.has(field));
  for (const name of ["minimal", "less", "all"] as const) {
    const bundle = SHARE_BUNDLES[name].filter((field) => !unavailable.has(field));
    if (bundle.length === comparableSelected.length && bundle.every((field) => selected.has(field))) {
      return name;
    }
  }
  return null;
}

const BUNDLE_OPTIONS: { name: ShareBundleName; labelKey: LocaleKey }[] = [
  { name: "minimal", labelKey: "shareDialog.bundle.minimal" },
  { name: "less", labelKey: "shareDialog.bundle.less" },
  { name: "all", labelKey: "shareDialog.bundle.all" },
];

// ── Component ──────────────────────────────────────────────────────────

export function ContentScopeSelector({
  scope,
  onChange,
  hasTour,
  hasPhotos,
  hasFloorplan,
  lang,
  layout = "default",
  detailsMode = "panel",
}: ContentScopeSelectorProps) {
  const [detailsExpanded, setDetailsExpanded] = React.useState(false);
  const unavailableFields = new Set<string>();
  if (!hasTour) unavailableFields.add("tour");
  if (!hasPhotos) unavailableFields.add("uploads");
  if (!hasFloorplan) unavailableFields.add("floorplan");
  const activeBundle = detectBundle(scope.selectedFields, unavailableFields);

  const toggleCard = (key: "tour" | "photos" | "details" | "floorplan") => {
    onChange({ ...scope, [key]: !scope[key] });
  };

  const handleBundleClick = (name: ShareBundleName) => {
    onChange({ ...scope, selectedFields: new Set(SHARE_BUNDLES[name]) });
    setDetailsExpanded(false);
  };

  const handleFieldToggle = (field: string, checked: boolean) => {
    const next = new Set(scope.selectedFields);
    if (checked) next.add(field);
    else next.delete(field);
    next.add("title");
    onChange({ ...scope, selectedFields: next });
  };

  const cards: { key: "tour" | "photos" | "details" | "floorplan"; icon: React.ReactNode; labelKey: LocaleKey; available: boolean }[] = [
    { key: "tour", icon: <MainTourIcon size={16} />, labelKey: "sharing.scopeTour", available: hasTour },
    { key: "photos", icon: <ImageIcon size={16} />, labelKey: "sharing.scopePhotos", available: hasPhotos },
    { key: "details", icon: <ListBulletIcon width={16} height={16} aria-hidden="true" />, labelKey: "sharing.scopeDetails", available: true },
    { key: "floorplan", icon: <FloorplanIcon size={16} />, labelKey: "sharing.scopeFloorplan", available: hasFloorplan },
  ];
  const fieldGroups = (
    <div className={cn(
      "grid gap-5",
      layout === "workspace" && "sm:grid-cols-2 lg:grid-cols-3",
    )}>
      {SHARE_FIELD_GROUPS.map((group) => (
        <section key={group.key}>
          <h4 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.045em] text-muted-foreground">
            {t(`shareDialog.fieldGroup.${group.key}` as LocaleKey, lang)}
          </h4>
          <div className="grid grid-cols-2 gap-2">
            {group.fields.map((field) => {
              const isTitle = field === "title";
              const checked = isTitle || scope.selectedFields.has(field);
              return (
                <button
                  key={field}
                  type="button"
                  disabled={isTitle}
                  aria-pressed={checked}
                  onClick={() => handleFieldToggle(field, !checked)}
                  className={`flex min-h-11 min-w-0 items-center justify-between gap-2 rounded-xl border px-3 text-left text-[12px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                    checked
                      ? "border-foreground/18 bg-foreground/[0.07] text-foreground"
                      : "border-border/70 bg-card text-foreground/65 hover:border-foreground/20 hover:bg-foreground/[0.035] hover:text-foreground"
                  } ${isTitle ? "cursor-default opacity-65" : ""}`}
                >
                  <span className="truncate">{t(`shareDialog.field.${field}` as LocaleKey, lang)}</span>
                  {isTitle ? <LockIcon size={11} /> : checked ? <CheckIcon size={11} /> : null}
                </button>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );

  return (
    <div className="space-y-3.5">
      <h3 className="px-0.5 text-[13px] font-semibold text-foreground/70">
        {t("sharing.whatToShare", lang)}
      </h3>

      <div className={cn("grid grid-cols-1 gap-2 min-[480px]:grid-cols-2", layout === "workspace" && "sm:grid-cols-4")}>
        {cards.map((card) => {
          const active = card.available && scope[card.key];
          return (
            <button
              key={card.key}
              type="button"
              disabled={!card.available}
              aria-disabled={!card.available}
              aria-pressed={active}
              onClick={() => toggleCard(card.key)}
              className={`floating-panel-shape pen-touch-target group relative flex min-h-16 w-full items-center gap-2.5 border px-3 py-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${
                !card.available
                  ? "cursor-not-allowed border-border/45 bg-surface-subtle text-foreground/38"
                  : `${active ? "border-foreground/20 bg-foreground/[0.065] text-foreground" : "border-border/65 bg-card text-foreground/55 hover:border-foreground/18 hover:bg-foreground/[0.035] hover:text-foreground"}`
              }`}
            >
              <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition-colors ${active ? "bg-foreground/[0.12] text-foreground" : "bg-secondary/80 text-foreground/45"}`}>
                {card.icon}
              </span>
              {/*
                The check sits in the flow rather than absolutely over the label.
                Reserving space with padding was not enough: a single long word
                ("nehnuteľnosti") is wider than the padded box and overflows it
                instead of wrapping, running straight under the badge. Its slot
                is always present so toggling does not reflow the label.
              */}
              <span className="min-w-0 flex-1 hyphens-auto break-words text-[12px] font-semibold leading-[1.25] sm:text-[13px]">
                {t(card.labelKey, lang)}
              </span>
              <span
                aria-hidden="true"
                className={cn(
                  "flex h-5 w-5 shrink-0 items-center justify-center rounded-full border transition-colors",
                  active
                    ? "border-foreground/38 bg-card text-foreground"
                    : "border-foreground/25 bg-card text-transparent",
                )}
              >
                <CheckIcon size={12} />
              </span>
            </button>
          );
        })}
      </div>

      {/* Details sub-section — bundle pills inline + optional custom toggles */}
      {scope.details && (
        <div className="space-y-1.5">
          <div className="selection-capsule-track grid grid-cols-3">
            {BUNDLE_OPTIONS.map(({ name, labelKey }) => (
              <button
                key={name}
                type="button"
                aria-pressed={activeBundle === name}
                onClick={() => handleBundleClick(name)}
                className="selection-capsule-item pen-touch-target min-w-0 px-2 text-[12px] leading-tight focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span className="block truncate">{t(labelKey, lang)}</span>
              </button>
            ))}
          </div>

          <button
            type="button"
            aria-expanded={detailsExpanded}
            aria-haspopup={detailsMode === "panel" ? "dialog" : undefined}
            onClick={() => setDetailsExpanded((v) => !v)}
            className="floating-control pen-touch-target flex w-full items-center justify-between px-3.5 text-[12px] font-semibold text-foreground/70 transition-colors hover:bg-foreground/[0.04] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            <span>{t("shareDialog.customizeFields", lang)}</span>
            <span className="flex items-center gap-2">
              {!activeBundle ? <span className="rounded-full bg-secondary px-2 py-0.5 text-[10px] font-semibold">{t("shareDialog.bundle.custom", lang)}</span> : null}
              <ArrowRightIcon size={12} className={cn("transition-transform", detailsExpanded && "rotate-90")} />
            </span>
          </button>
        </div>
      )}

      {detailsMode === "inline" && detailsExpanded ? (
        <div className="animate-fade-in border-t border-border/50 pt-4">
          {fieldGroups}
        </div>
      ) : null}

      {detailsMode === "panel" ? (
        <SidePanel
          open={detailsExpanded}
          onOpenChange={setDetailsExpanded}
          title={t("shareDialog.customizeFields", lang)}
          description={t("sharing.scopeDetails", lang)}
          headerMode="editor"
          closeIcon="back"
          lang={lang}
        >
          <div className="space-y-6">{fieldGroups}</div>
        </SidePanel>
      ) : null}
    </div>
  );
}
