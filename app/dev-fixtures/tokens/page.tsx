"use client";

// Dev QA fixture: the detail design tokens — used by the UI smoke suite to
// guard the computed card material, chips and action language.

import { notFound } from "next/navigation";

export default function TokensFixture() {
  if (process.env.NODE_ENV === "production") notFound();
  return (
    <div className="p-10">
      <h2 className="detail-section-title"><span className="detail-icon-chip">i</span>Detaily</h2>
      <div data-qa="card" className="detail-card p-4">obsah</div>
      <div data-qa="card-lg" className="detail-card-lg mt-4 p-4">obsah</div>
      <button type="button" data-qa="chip" className="detail-action-chip">Upraviť</button>
    </div>
  );
}
