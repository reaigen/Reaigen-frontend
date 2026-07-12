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
  max_access_count?: number;
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
  const [privacyLevel, setPrivacyLevel] = React.useState<PrivacyLevel>("pin");
  const [pin, setPin] = React.useState("");
  const [lifetimeHours, setLifetimeHours] = React.useState(168);
  const [maxViews, setMaxViews] = React.useState("");

  const pinValid = privacyLevel !== "pin" || pin.length >= 4;

  const handleSubmit = async () => {
    const opts: ShareFormData = {
      share_type: privacyLevel === "pin" ? "pin" : lifetimeHours > 0 ? "temporary" : "permanent",
      field_names: Array.from(scope.selectedFields),
    };
    if (privacyLevel === "pin") opts.pin = pin;
    if (lifetimeHours > 0) opts.expires_in_hours = lifetimeHours;
    const mv = parseInt(maxViews);
    if (mv > 0) opts.max_access_count = mv;
    await onSubmit(opts);
  };

  return (
    <div className="space-y-4">
      {error && <p className="text-[12px] text-destructive">{error}</p>}

      <ContentScopeSelector
        scope={scope}
        onChange={onScopeChange}
        hasTour={hasTour}
        hasPhotos={hasPhotos}
        hasFloorplan={hasFloorplan}
        lang={lang}
      />

      <PrivacyLevelSelector
        level={privacyLevel}
        pin={pin}
        onLevelChange={setPrivacyLevel}
        onPinChange={setPin}
        lang={lang}
      />

      <LifetimeSelector
        hours={lifetimeHours}
        maxViews={maxViews}
        onHoursChange={setLifetimeHours}
        onMaxViewsChange={setMaxViews}
        lang={lang}
      />

      <Button
        className="w-full"
        size="sm"
        onClick={handleSubmit}
        disabled={saving || !pinValid}
        loading={saving}
      >
        {t("sharing.createAndCopy", lang)}
      </Button>
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
