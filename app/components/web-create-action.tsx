"use client";

import * as React from "react";
import Link from "next/link";
import { t } from "../lib/i18n";
import { Button } from "../lib/ui/button";
import { cn } from "../lib/utils";
import { useWebAuthoringAccess } from "./hooks/use-web-authoring-access";
import { PlusIcon } from "./icons";

export function WebCreateAction({
  lang,
  labelKey = "webCreate.action",
}: {
  lang: string;
  labelKey?: "webCreate.action" | "webCreate.tourAction";
}) {
  // Only ever rendered inside AppShell, which does not mount without a signed-in
  // user — so the session is established by the time this runs.
  const { allowed, loading } = useWebAuthoringAccess(true);

  // This is the page's primary action, and on a phone it is reached with a
  // thumb — so it keeps the 44px touch target there and only compacts to the
  // dense 36px header control once there is a pointer.
  const touchHeight = "h-11 sm:h-[var(--floating-control-sm)]";

  if (loading) {
    return (
      <span aria-hidden="true" className={cn("relative inline-flex shrink-0", touchHeight)}>
        <Button
          type="button"
          size="sm"
          disabled
          tabIndex={-1}
          className={cn("invisible", touchHeight)}
        >
          <PlusIcon size={14} />
          {t(labelKey, lang)}
        </Button>
        <span className="absolute inset-0 animate-pulse rounded-full bg-foreground/[0.055] motion-reduce:animate-none" />
      </span>
    );
  }

  // Keep the header's vertical action row stable for users without creation
  // access. A zero-width spacer prevents a late permission response from
  // collapsing the mobile header after its first paint.
  if (!allowed) return <span aria-hidden="true" className={cn("w-0 shrink-0", touchHeight)} />;

  return (
    <Button asChild size="sm" className={touchHeight}>
      <Link href="/create">
        <PlusIcon size={14} />
        {t(labelKey, lang)}
      </Link>
    </Button>
  );
}
