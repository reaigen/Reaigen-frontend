"use client";

import * as React from "react";
import Link from "next/link";
import { hasWebCreationAccess } from "../lib/api/client";
import { t } from "../lib/i18n";
import { Button } from "../lib/ui/button";
import { PlusIcon } from "./icons";

export function WebCreateAction({
  lang,
  labelKey = "webCreate.action",
}: {
  lang: string;
  labelKey?: "webCreate.action" | "webCreate.tourAction";
}) {
  const [allowed, setAllowed] = React.useState(false);
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    let active = true;
    void hasWebCreationAccess()
      .then((value) => { if (active) setAllowed(value); })
      .catch(() => { if (active) setAllowed(false); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  if (loading) {
    return (
      <span aria-hidden="true" className="relative inline-flex h-9 shrink-0">
        <Button
          type="button"
          size="sm"
          disabled
          tabIndex={-1}
          className="invisible"
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
  if (!allowed) return <span aria-hidden="true" className="h-9 w-0 shrink-0" />;

  return (
    <Button asChild size="sm">
      <Link href="/create">
        <PlusIcon size={14} />
        {t(labelKey, lang)}
      </Link>
    </Button>
  );
}
