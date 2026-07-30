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

  React.useEffect(() => {
    let active = true;
    void hasWebCreationAccess()
      .then((value) => { if (active) setAllowed(value); })
      .catch(() => { if (active) setAllowed(false); });
    return () => { active = false; };
  }, []);

  if (!allowed) return null;
  return (
    <Button asChild size="sm">
      <Link href="/create">
        <PlusIcon size={14} />
        {t(labelKey, lang)}
      </Link>
    </Button>
  );
}
