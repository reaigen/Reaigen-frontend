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

function detectBundle(selected: Set<string>): ShareBundleName | null {
  for (const name of ["minimal", "less", "all"] as const) {
    const bundle = SHARE_BUNDLES[name];
    if (bundle.length === selected.size && bundle.every((f) => selected.has(f))) {
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
  const activeBundle = detectBundle(scope.selectedFields);

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

      {/* Toggle chips — uniform 2-column grid so every option is the same size */}
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
              className={`flex h-11 w-full items-center justify-center gap-1.5 rounded-full px-3 text-center shadow-control transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                !card.available
                  ? "cursor-not-allowed border border-border/40 bg-surface text-foreground/50 opacity-40"
                  : active
                    ? "border border-foreground bg-foreground text-background"
                    : "border border-border/55 bg-surface text-foreground/60 hover:border-border hover:bg-foreground/[0.04] hover:text-foreground/80"
              }`}
            >
              <span className="shrink-0">{card.icon}</span>
              <span className="truncate text-[12px] font-medium">
                {t(card.labelKey, lang)}
              </span>
            </button>
          );
        })}
      </div>

      {/* Details sub-section — bundle pills inline + optional custom toggles */}
      {scope.details && (
        <div className="space-y-2.5">
          <div className="flex flex-wrap items-center gap-1.5">
            {BUNDLE_OPTIONS.map(({ name, labelKey }) => (
              <button
                key={name}
                type="button"
                aria-pressed={activeBundle === name}
                onClick={() => handleBundleClick(name)}
                className={`rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                  activeBundle === name
                    ? "bg-foreground text-background border border-foreground"
                    : "bg-transparent text-foreground/50 border border-border/40 hover:bg-foreground/[0.04] hover:text-foreground/70"
                }`}
              >
                {t(labelKey, lang)}
              </button>
            ))}
            <button
              type="button"
              aria-expanded={detailsExpanded}
              onClick={() => setDetailsExpanded((v) => !v)}
              className="ml-auto rounded px-1 py-1 text-[11px] font-medium text-foreground/50 transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {t("shareDialog.customizeFields", lang)}
              <ChevronDownIcon size={10} className={`ml-0.5 inline transition-transform ${detailsExpanded ? "rotate-180" : ""}`} />
            </button>
          </div>

          {detailsExpanded && (
            <div className="rounded-xl bg-foreground/[0.02] p-3.5 space-y-3 animate-fade-in">
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
