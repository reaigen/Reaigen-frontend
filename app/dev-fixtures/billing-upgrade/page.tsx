"use client";

import { notFound } from "next/navigation";
import { BillingUpgradeFlow } from "../../components/billing-upgrade-flow";

/** Development-only browser fixture; the smoke suite supplies Django JSON. */
export default function BillingUpgradeFixture() {
  if (process.env.NODE_ENV === "production") notFound();
  return (
    <main className="mx-auto max-w-6xl p-6 sm:p-10" data-testid="billing-upgrade-fixture">
      <BillingUpgradeFlow lang="en" />
    </main>
  );
}
