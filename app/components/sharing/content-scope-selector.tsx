"use client";

import * as React from "react";
import { Switch } from "../../lib/ui/switch";
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

  const visibleCards = cards.filter((c) => c.available);

  return (
    <div className="space-y-2.5">
      <h3 className="text-[11px] font-medium text-foreground/40 uppercase tracking-wider">
        {t("sharing.whatToShare", lang)}
      </h3>

      {/* Toggle chips — compact inline row */}
      <div className="flex flex-wrap gap-1.5">
        {visibleCards.map((card) => {
          const active = scope[card.key];
          return (
            <button
              key={card.key}
              type="button"
              onClick={() => toggleCard(card.key)}
              className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-left transition-all ${
                active
                  ? "border-foreground/20 bg-foreground/[0.04]"
                  : "border-border/40 bg-transparent text-foreground/35"
              }`}
            >
              {active && <span className="text-foreground/50">{icons.check}</span>}
              <span className={active ? "text-foreground/60" : ""}>{card.icon}</span>
              <span className={`text-[12px] font-medium ${active ? "text-foreground/80" : ""}`}>
                {t(card.labelKey, lang)}
              </span>
            </button>
          );
        })}
      </div>

      {/* Details sub-section — bundle pills + optional custom toggles */}
      {scope.details && (
        <div className="rounded-lg border border-border/50 p-2.5 space-y-2">
          <div className="flex items-center gap-1">
            {BUNDLE_OPTIONS.map(({ name, labelKey }) => (
              <button
                key={name}
                type="button"
                onClick={() => handleBundleClick(name)}
                className={`px-2 py-0.5 rounded-md text-[10px] font-medium transition-all ${
                  activeBundle === name
                    ? "bg-foreground text-background"
                    : "bg-foreground/[0.05] text-foreground/50 hover:text-foreground"
                }`}
              >
                {t(labelKey, lang)}
              </button>
            ))}
            <div className="flex-1" />
            <button
              type="button"
              onClick={() => setDetailsExpanded((v) => !v)}
              className="text-[10px] font-medium text-foreground/40 hover:text-foreground transition-colors"
            >
              {t("shareDialog.customizeFields", lang)}
              <svg width="8" height="8" viewBox="0 0 16 16" fill="none" className={`inline ml-0.5 transition-transform ${detailsExpanded ? "rotate-180" : ""}`}>
                <path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          </div>

          {detailsExpanded && (
            <div className="border-t border-border/40 pt-2 max-h-[180px] overflow-y-auto overscroll-contain space-y-1.5">
              {SHARE_FIELD_GROUPS.map((group) => (
                <div key={group.key}>
                  <p className="text-[9px] font-medium text-foreground/30 uppercase tracking-wide mb-0.5">
                    {t(`shareDialog.fieldGroup.${group.key}` as LocaleKey, lang)}
                  </p>
                  {group.fields.map((field) => {
                    const isTitle = field === "title";
                    const checked = scope.selectedFields.has(field);
                    return (
                      <div key={field} className="flex items-center justify-between gap-2 h-6">
                        <span className={`text-[11px] ${isTitle ? "text-foreground/40" : "text-foreground/70"}`}>
                          {t(`shareDialog.field.${field}` as LocaleKey, lang)}
                          {isTitle && <span className="ml-1 text-[9px] text-foreground/25">{icons.lock}</span>}
                        </span>
                        {isTitle ? (
                          <span className="text-[9px] text-foreground/30 uppercase tracking-wide">{t("common.required", lang)}</span>
                        ) : (
                          <Switch
                            checked={checked}
                            onCheckedChange={(v) => handleFieldToggle(field, v)}
                            size="sm"
                          />
                        )}
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
