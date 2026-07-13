"use client";

import * as React from "react";
import { Button } from "../../lib/ui/button";
import { t } from "../../lib/i18n";
import { SHARE_BUNDLES } from "../../lib/tour-types";
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
}: ShareCreateFormProps) {
  const [privacyLevel, setPrivacyLevel] = React.useState<PrivacyLevel>("open");
  const [pin, setPin] = React.useState("");
  const [lifetimeHours, setLifetimeHours] = React.useState(0);

  const pinValid = privacyLevel !== "pin" || pin.length >= 4;

  const handleSubmit = async () => {
    // The scope toggles shape the actual field list: photos ⇄ uploads,
    // floorplan ⇄ floorplan; details off strips everything but title/media.
    const fields = new Set(scope.selectedFields);
    fields.add("title");
    if (scope.photos) fields.add("uploads");
    else fields.delete("uploads");
    if (scope.floorplan) fields.add("floorplan");
    else fields.delete("floorplan");
    if (!scope.details) {
      for (const f of Array.from(fields)) {
        if (f !== "title" && f !== "uploads" && f !== "floorplan") fields.delete(f);
      }
    }
    const opts: ShareFormData = {
      share_type: privacyLevel === "pin" ? "pin" : lifetimeHours > 0 ? "temporary" : "permanent",
      field_names: Array.from(fields),
    };
    if (privacyLevel === "pin") opts.pin = pin;
    if (lifetimeHours > 0) opts.expires_in_hours = lifetimeHours;
    await onSubmit(opts);
  };

  return (
    <div className="space-y-5">
      {error && <p className="text-[12px] text-destructive">{error}</p>}

      <ContentScopeSelector
        scope={scope}
        onChange={onScopeChange}
        hasTour={hasTour}
        hasPhotos={hasPhotos}
        hasFloorplan={hasFloorplan}
        lang={lang}
      />

      <div className="border-t border-border/30 pt-5">
        <PrivacyLevelSelector
          level={privacyLevel}
          pin={pin}
          onLevelChange={setPrivacyLevel}
          onPinChange={setPin}
          lang={lang}
        />
      </div>

      <div className="border-t border-border/30 pt-5">
        <LifetimeSelector
          hours={lifetimeHours}
          onHoursChange={setLifetimeHours}
          lang={lang}
        />
      </div>

      <div className="border-t border-border/30 pt-5">
        <Button
          className="w-full h-11 text-[13px] font-semibold shadow-sm"
          onClick={handleSubmit}
          disabled={saving || !pinValid}
          loading={saving}
        >
          {t("sharing.createAndCopy", lang)}
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
