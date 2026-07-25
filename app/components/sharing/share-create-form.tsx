"use client";

import * as React from "react";
import { Button } from "../../lib/ui/button";
import { t } from "../../lib/i18n";
import { SHARE_BUNDLES, type ShareData } from "../../lib/tour-types";
import { ContentScopeSelector, type ContentScope } from "./content-scope-selector";
import { PrivacyLevelSelector, type PrivacyLevel } from "./privacy-level-selector";
import { LifetimeSelector } from "./lifetime-selector";

interface ShareCreateFormProps {
  scope: ContentScope;
  onScopeChange: (scope: ContentScope) => void;
  hasTour: boolean;
  hasPhotos: boolean;
  hasFloorplan: boolean;
  lang: string;
  onSubmit: (opts: ShareFormData) => Promise<void>;
  saving: boolean;
  error: string | null;
  initialShare?: ShareData | null;
  onCancelEdit?: () => void;
}

export interface ShareFormData {
  share_type: string;
  pin?: string;
  expires_in_hours?: number;
  field_names: string[];
}

export function ShareCreateForm({
  scope,
  onScopeChange,
  hasTour,
  hasPhotos,
  hasFloorplan,
  lang,
  onSubmit,
  saving,
  error,
  initialShare = null,
  onCancelEdit,
}: ShareCreateFormProps) {
  const [privacyLevel, setPrivacyLevel] = React.useState<PrivacyLevel>("open");
  const [pin, setPin] = React.useState("");
  const [lifetimeHours, setLifetimeHours] = React.useState<number | null>(0);

  React.useEffect(() => {
    setPrivacyLevel(initialShare?.requires_pin ? "pin" : "open");
    setPin("");
    // `null` means keep the existing exact expiry. A chosen preset replaces it.
    setLifetimeHours(initialShare?.expires_at ? null : 0);
  }, [initialShare]);

  const pinValid = privacyLevel !== "pin"
    || pin.length >= 4
    || Boolean(initialShare?.requires_pin && pin.length === 0);

  const handleSubmit = async () => {
    // The scope toggles shape the actual field list: tour ⇄ tour,
    // photos ⇄ uploads, floorplan ⇄ floorplan; details off strips
    // everything but title/media.
    const fields = new Set(scope.selectedFields);
    fields.add("title");
    if (scope.tour) fields.add("tour");
    else fields.delete("tour");
    if (scope.photos) fields.add("uploads");
    else fields.delete("uploads");
    if (scope.floorplan) fields.add("floorplan");
    else fields.delete("floorplan");
    if (!scope.details) {
      for (const f of Array.from(fields)) {
        if (f !== "title" && f !== "uploads" && f !== "floorplan" && f !== "tour") fields.delete(f);
      }
    }
    const hasExpiry = lifetimeHours === null ? Boolean(initialShare?.expires_at) : lifetimeHours > 0;
    const opts: ShareFormData = {
      share_type: privacyLevel === "pin" ? "pin" : hasExpiry ? "temporary" : "permanent",
      field_names: Array.from(fields),
    };
    if (privacyLevel === "pin" && pin.length >= 4) opts.pin = pin;
    if (lifetimeHours !== null && (initialShare || lifetimeHours > 0)) opts.expires_in_hours = lifetimeHours;
    await onSubmit(opts);
  };

  return (
    <div className="space-y-3">
      {error && <p role="alert" className="rounded-2xl border border-destructive/25 bg-destructive/[0.035] px-4 py-3 text-[12px] text-destructive">{error}</p>}

      <section className="rounded-[1.35rem] border border-border/60 bg-card p-4 shadow-card sm:rounded-2xl sm:p-5">
        <ContentScopeSelector
          scope={scope}
          onChange={onScopeChange}
          hasTour={hasTour}
          hasPhotos={hasPhotos}
          hasFloorplan={hasFloorplan}
          lang={lang}
        />
      </section>

      <section className="rounded-[1.35rem] border border-border/60 bg-card p-4 shadow-card sm:rounded-2xl sm:p-5">
        <PrivacyLevelSelector
          level={privacyLevel}
          pin={pin}
          onLevelChange={setPrivacyLevel}
          onPinChange={setPin}
          lang={lang}
        />
      </section>

      <section className="rounded-[1.35rem] border border-border/60 bg-card p-4 shadow-card sm:rounded-2xl sm:p-5">
        <LifetimeSelector
          hours={lifetimeHours}
          onHoursChange={setLifetimeHours}
          currentExpiry={initialShare?.expires_at}
          lang={lang}
        />
      </section>

      <div className="sticky bottom-[calc(4rem+env(safe-area-inset-bottom,0px))] z-20 -mx-1 flex gap-2 rounded-full border border-border/70 bg-card/95 p-1.5 shadow-elevated backdrop-blur-xl md:static md:mx-0 md:border-0 md:bg-transparent md:p-0 md:pt-1 md:shadow-none">
        {initialShare && onCancelEdit ? (
          <Button type="button" variant="outline" className="h-11 flex-1 text-[13px] font-semibold" onClick={onCancelEdit} disabled={saving}>
            {t("common.cancel", lang)}
          </Button>
        ) : null}
        <Button
          type="button"
          className="h-11 flex-1 text-[13px] font-semibold shadow-sm"
          onClick={handleSubmit}
          disabled={saving || !pinValid}
          loading={saving}
        >
          {t(initialShare ? "shareDialog.save" : "sharing.createAndCopy", lang)}
        </Button>
      </div>
    </div>
  );
}

export function defaultContentScope(hasTour: boolean, hasPhotos: boolean, hasFloorplan: boolean): ContentScope {
  return {
    tour: hasTour,
    photos: hasPhotos,
    details: true,
    floorplan: hasFloorplan,
    selectedFields: new Set(SHARE_BUNDLES.less),
  };
}
