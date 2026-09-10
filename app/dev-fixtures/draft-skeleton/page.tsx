"use client";

// Dev QA fixture: the draft detail silhouette inside a workspace container —
// used by the UI smoke suite to guard that the skeleton follows the saved
// viewing mode (focused / wide) and collapses with the workspace width the
// way the loaded listing does beside a docked Agent.

import { notFound } from "next/navigation";
import { useState } from "react";
import { DetailLayoutToggle } from "../../components/detail-layout-toggle";
import { DraftDetailSkeleton } from "../../components/draft-detail-skeleton";
import { useDetailLayout } from "../../lib/detail-layout";

const twinCard = "h-10 rounded-xl bg-foreground/[0.075]";

export default function DraftSkeletonFixture() {
  const [narrow, setNarrow] = useState(false);
  const detailLayout = useDetailLayout();
  if (process.env.NODE_ENV === "production") notFound();
  return (
    <div className="p-10">
      <div className="mb-4 flex items-center gap-3">
        <DetailLayoutToggle lang="sk" />
        <button type="button" data-qa="toggle-narrow" onClick={() => setNarrow((value) => !value)} className="rounded-full border px-4 py-2">
          Narrow
        </button>
      </div>
      <div
        data-qa="workspace"
        className="[container-name:app-workspace] [container-type:inline-size]"
        style={{ width: narrow ? 700 : "100%" }}
      >
        <DraftDetailSkeleton label="Loading" />

        {/* Geometry twin of the loaded listing's support grid — display:contents
            wrappers and a card spanning two columns — so the suite can prove the
            focused mode is one real column, not an implicit second track. */}
        <div data-qa="support-twin" data-detail-layout={detailLayout} className="draft-detail-page mx-auto mt-10 w-full max-w-[1360px]">
          <div className="draft-support-grid grid gap-6 lg:grid-cols-2 lg:items-start">
            <div className="draft-support-contents min-w-0 space-y-7 lg:contents lg:space-y-0">
              <section data-qa="twin-a" className={`lg:col-span-2 ${twinCard}`} />
              <section data-qa="twin-b" className={twinCard} />
            </div>
            <div className="draft-support-contents min-w-0 space-y-7 lg:contents lg:space-y-0">
              <section data-qa="twin-c" className={twinCard} />
              <section data-qa="twin-d" className={twinCard} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
