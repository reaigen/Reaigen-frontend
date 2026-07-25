"use client";

import * as React from "react";
import { ListBulletIcon } from "@radix-ui/react-icons";
import { t, type LocaleKey } from "../../lib/i18n";
import {
  SHARE_BUNDLES,
  SHARE_FIELD_GROUPS,
  type ShareBundleName,
} from "../../lib/tour-types";
import { CheckIcon, ChevronDownIcon, FloorplanIcon, ImageIcon, LockIcon, TourIcon } from "../icons";

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

export function ContentScopeSelector({ scope, onChange, hasTour, hasPhotos, hasFloorplan, lang }: ContentScopeSelectorProps) {
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
    { key: "tour", icon: <TourIcon size={16} />, labelKey: "sharing.scopeTour", available: hasTour },
    { key: "photos", icon: <ImageIcon size={16} />, labelKey: "sharing.scopePhotos", available: hasPhotos },
    { key: "details", icon: <ListBulletIcon width={16} height={16} aria-hidden="true" />, labelKey: "sharing.scopeDetails", available: true },
    { key: "floorplan", icon: <FloorplanIcon size={16} />, labelKey: "sharing.scopeFloorplan", available: hasFloorplan },
  ];

  return (
    <div className="space-y-3">
      <h3 className="text-[13px] font-semibold text-foreground/70">
        {t("sharing.whatToShare", lang)}
      </h3>

      {/* Content choices are selection tiles, not four competing primary actions. */}
      <div className="grid grid-cols-2 gap-2">
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
              className={`group relative flex min-h-16 w-full items-center gap-2.5 rounded-2xl border px-3 py-2.5 text-left transition-[background-color,border-color,box-shadow] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${
                !card.available
                  ? "cursor-not-allowed border-border/35 bg-surface-subtle text-foreground/35 opacity-60"
                  : active
                    ? "border-foreground/25 bg-card text-foreground shadow-control"
                    : "border-border/55 bg-card/70 text-foreground/60 hover:border-foreground/15 hover:bg-card hover:text-foreground"
              }`}
            >
              <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition-colors ${active ? "bg-foreground text-background" : "bg-secondary text-foreground/55"}`}>
                {card.icon}
              </span>
              <span className="min-w-0 text-[12px] font-semibold leading-[1.25]">
                {t(card.labelKey, lang)}
              </span>
              {active ? (
                <span className="absolute right-2.5 top-2.5 flex h-4 w-4 items-center justify-center rounded-full bg-foreground text-background">
                  <CheckIcon size={9} />
                </span>
              ) : null}
            </button>
          );
        })}
      </div>

      {/* Details sub-section — bundle pills inline + optional custom toggles */}
      {scope.details && (
        <div className="space-y-2.5">
          <div className="grid grid-cols-3 gap-1 rounded-full border border-border/55 bg-surface-subtle p-1 shadow-control">
            {BUNDLE_OPTIONS.map(({ name, labelKey }) => (
              <button
                key={name}
                type="button"
                aria-pressed={activeBundle === name}
                onClick={() => handleBundleClick(name)}
                className={`min-h-9 min-w-0 rounded-full px-1.5 py-1 text-[11px] font-semibold leading-tight transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                  activeBundle === name
                    ? "bg-foreground text-background shadow-sm"
                    : "text-foreground/50 hover:bg-card hover:text-foreground/75"
                }`}
              >
                <span className="block truncate">{t(labelKey, lang)}</span>
              </button>
            ))}
          </div>

          <button
            type="button"
            aria-expanded={detailsExpanded}
            onClick={() => setDetailsExpanded((v) => !v)}
            className="flex min-h-11 w-full items-center justify-between rounded-xl px-3 text-[12px] font-semibold text-foreground/55 transition-colors hover:bg-foreground/[0.04] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            <span>{t("shareDialog.customizeFields", lang)}</span>
            <span className="flex items-center gap-2">
              {!activeBundle ? <span className="rounded-full bg-secondary px-2 py-0.5 text-[10px] font-semibold">{t("shareDialog.bundle.custom", lang)}</span> : null}
              <ChevronDownIcon size={12} className={`transition-transform ${detailsExpanded ? "rotate-180" : ""}`} />
            </span>
          </button>

          {detailsExpanded && (
            <div className="space-y-4 rounded-2xl border border-border/45 bg-surface-subtle p-3.5 animate-fade-in">
              {SHARE_FIELD_GROUPS.map((group) => (
                <div key={group.key} className="space-y-1.5">
                  <p className="text-[11px] font-medium text-foreground/50 uppercase tracking-wide">
                    {t(`shareDialog.fieldGroup.${group.key}` as LocaleKey, lang)}
                  </p>
                  <div className="flex flex-wrap gap-1.5">
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
                          className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                            checked
                              ? "bg-foreground text-background border border-foreground"
                              : "bg-transparent text-foreground/70 border border-border/40 hover:border-border hover:bg-foreground/[0.04] hover:text-foreground"
                          } ${isTitle ? "cursor-default opacity-60" : ""}`}
                        >
                          {checked && !isTitle && <CheckIcon size={10} />}
                          {t(`shareDialog.field.${field}` as LocaleKey, lang)}
                          {isTitle && <LockIcon size={10} />}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
