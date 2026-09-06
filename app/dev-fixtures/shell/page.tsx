"use client";

// Dev QA fixture: AppShell with the agent and a side panel — used by the UI
// smoke suite to guard shell layering (scrim over agent, panel placement).

import { notFound } from "next/navigation";
import { useState } from "react";
import { AppShell } from "../../components/app-shell";
import { SidePanel } from "../../components/side-panel";
import type { UserProfile } from "../../lib/api/client";

const USER = { id: 1, email: "qa@reaigen.local", first_name: "QA", last_name: "Shell" } as unknown as UserProfile;

export default function ShellFixture() {
  const [open, setOpen] = useState(false);
  if (process.env.NODE_ENV === "production") notFound();
  return (
    <AppShell user={USER} onLogout={() => {}} headerBackHref="/dashboard" headerTitle="QA Shell">
      <div className="p-10">
        <button type="button" data-qa="open-side" onClick={() => setOpen(true)} className="rounded-full border px-4 py-2">
          Panel
        </button>
        <SidePanel open={open} onOpenChange={setOpen} title="Panel" headerMode="editor" closeIcon="close" className="sm:max-w-[640px]" lang="sk">
          <div data-qa="side-body" className="p-4">obsah</div>
        </SidePanel>
      </div>
    </AppShell>
  );
}
