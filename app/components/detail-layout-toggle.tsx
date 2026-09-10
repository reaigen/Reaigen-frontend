"use client";

import { FocusColumnIcon, WideColumnsIcon } from "./icons";
import { useDetailLayout, writeDetailLayout } from "../lib/detail-layout";
import { t } from "../lib/i18n";

/**
 * Header switch between the focused and wide detail modes. One quiet circular
 * button in the header's own language (same as the back button) — the icon
 * previews the mode a click switches to. The loaded listing and its loading
 * states render the same control, so it never pops in after the data.
 */
export function DetailLayoutToggle({ lang }: { lang: string }) {
  const detailLayout = useDetailLayout();
  const focused = detailLayout === 1;
  const label = t(focused ? "draft.layout.wide" : "draft.layout.focused", lang);
  return (
    <button
      type="button"
      data-testid="detail-layout-toggle"
      onClick={() => writeDetailLayout(focused ? 2 : 1)}
      aria-pressed={focused}
      aria-label={label}
      title={label}
      className="flex h-10 w-10 items-center justify-center rounded-full border border-border/60 bg-card text-foreground/65 shadow-control transition-[background-color,color,transform] duration-100 hover:bg-surface-subtle hover:text-foreground active:scale-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
    >
      {focused ? <WideColumnsIcon size={16} /> : <FocusColumnIcon size={16} />}
    </button>
  );
}
