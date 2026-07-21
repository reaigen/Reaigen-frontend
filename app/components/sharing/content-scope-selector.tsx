"use client";

import * as React from "react";
import { t, type LocaleKey } from "../../lib/i18n";
import {
  SHARE_BUNDLES,
  SHARE_FIELD_GROUPS,
  type ShareBundleName,
} from "../../lib/tour-types";

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

// ── Icons (16px) ───────────────────────────────────────────────────────

const icons = {
  cube: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><path d="M3.27 6.96L12 12.01l8.73-5.05M12 22.08V12"/></svg>,
  image: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg>,
  list: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>,
  layout: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="2" width="20" height="20" rx="2"/><path d="M2 8h20M8 2v20M14 8v14"/></svg>,
  check: <svg width="10" height="10" viewBox="0 0 16 16" fill="none"><path d="M3 8l4 4 6-6" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/></svg>,
  lock: <svg width="10" height="10" viewBox="0 0 16 16" fill="none"><rect x="3" y="7" width="10" height="7" rx="2" stroke="currentColor" strokeWidth="1.5" /><path d="M5 7V5a3 3 0 016 0v2" stroke="currentColor" strokeWidth="1.5" /></svg>,
};

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
    { key: "tour", icon: icons.cube, labelKey: "sharing.scopeTour", available: hasTour },
    { key: "photos", icon: icons.image, labelKey: "sharing.scopePhotos", available: hasPhotos },
    { key: "details", icon: icons.list, labelKey: "sharing.scopeDetails", available: true },
    { key: "floorplan", icon: icons.layout, labelKey: "sharing.scopeFloorplan", available: hasFloorplan },
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
              className={`flex h-11 w-full items-center justify-center gap-1.5 rounded-full px-3 text-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                !card.available
                  ? "border border-border/40 bg-transparent text-foreground/50 opacity-40 cursor-not-allowed"
                  : active
                    ? "border border-foreground bg-foreground text-background"
                    : "border border-border/40 bg-transparent text-foreground/60 hover:bg-foreground/[0.04] hover:text-foreground/80"
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
          <div className="flex items-center gap-1.5">
            {BUNDLE_OPTIONS.map(({ name, labelKey }) => (
              <button
                key={name}
                type="button"
                aria-pressed={activeBundle === name}
                onClick={() => handleBundleClick(name)}
                className={`px-2.5 py-1 rounded-full text-[11px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                  activeBundle === name
                    ? "bg-foreground text-background border border-foreground"
                    : "bg-transparent text-foreground/50 border border-border/40 hover:bg-foreground/[0.04] hover:text-foreground/70"
                }`}
              >
                {t(labelKey, lang)}
              </button>
            ))}
            <div className="flex-1" />
            <button
              type="button"
              aria-expanded={detailsExpanded}
              onClick={() => setDetailsExpanded((v) => !v)}
              className="rounded text-[11px] font-medium text-foreground/50 hover:text-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {t("shareDialog.customizeFields", lang)}
              <svg width="8" height="8" viewBox="0 0 16 16" fill="none" className={`inline ml-0.5 transition-transform ${detailsExpanded ? "rotate-180" : ""}`}>
                <path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
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
                          {checked && !isTitle && icons.check}
                          {t(`shareDialog.field.${field}` as LocaleKey, lang)}
                          {isTitle && icons.lock}
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
