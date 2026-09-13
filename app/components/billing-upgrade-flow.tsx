"use client";

import * as React from "react";
import Link from "next/link";
import {
  confirmBillingCheckout,
  createCreditCheckout,
  createSubscriptionCheckout,
  getBillingCatalog,
  previewCreditCheckout,
  previewSubscriptionCheckout,
  type BillingCatalog,
  type BillingCatalogStatus,
  type BillingCheckoutResult,
  type BillingPurchasePreview,
  type BillingTierOption,
  type ComputeCreditPack,
} from "../lib/api/client";
import { getSafeApiErrorMessage } from "../lib/api/error-message";
import { Button } from "../lib/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../lib/ui/select";
import { Tabs, TabsList, TabsTrigger } from "../lib/ui/tabs";
import { cn } from "../lib/utils";
import { t } from "../lib/i18n";
import { ArrowLeftIcon, CheckIcon, ChevronRightIcon, PriceIcon } from "./icons";

type PurchaseMode = "plans" | "credits";
type StepCode = "choose" | "review" | "checkout" | "complete";

function Surface({ className, ...props }: React.HTMLAttributes<HTMLElement>) {
  return (
    <section
      className={cn(
        "rounded-2xl border border-border/65 bg-card p-4 shadow-card sm:p-5",
        className,
      )}
      {...props}
    />
  );
}

function findStatus(
  catalog: BillingCatalog,
  category: string,
  code: string,
): BillingCatalogStatus | null {
  return catalog.statuses[category]?.find((row) => row.code === code) ?? null;
}

function StepRail({
  steps,
  current,
}: {
  steps: BillingCatalogStatus[];
  current: StepCode;
}) {
  const currentIndex = Math.max(0, steps.findIndex((step) => step.code === current));
  return (
    <ol
      className="grid gap-2 sm:grid-cols-4"
      aria-label={steps.map((step) => step.name).join(", ")}
    >
      {steps.map((step, index) => {
        const complete = index < currentIndex || current === "complete";
        const active = index === currentIndex;
        return (
          <li
            key={step.code}
            aria-current={active ? "step" : undefined}
            className={cn(
              "flex min-w-0 items-center gap-2 rounded-xl border px-3 py-2.5",
              active && "border-foreground/25 bg-foreground/[0.045]",
              !active && "border-border/55 bg-muted/15",
            )}
          >
            <span
              className={cn(
                "flex size-6 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold",
                complete || active
                  ? "bg-foreground text-background"
                  : "bg-muted text-muted-foreground",
              )}
              aria-hidden="true"
            >
              {complete ? <CheckIcon size={13} /> : index + 1}
            </span>
            <span className="truncate text-[12px] font-semibold">{step.name}</span>
          </li>
        );
      })}
    </ol>
  );
}

function StatusNotice({ status }: { status: BillingCatalogStatus }) {
  return (
    <div
      className={cn(
        "rounded-xl border px-3.5 py-3",
        status.is_success
          ? "border-success/30 bg-success/5"
          : "border-border/65 bg-muted/30",
      )}
      data-status-code={status.code}
    >
      <p className={cn("text-[12px] font-semibold", status.is_success && "text-success")}>{status.name}</p>
      {status.description ? (
        <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">{status.description}</p>
      ) : null}
    </div>
  );
}

function ProviderState({ catalog }: { catalog: BillingCatalog }) {
  const status = catalog.provider.connection_status;
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 rounded-2xl border border-border/65 bg-muted/20 px-4 py-3.5">
      <div className="min-w-0">
        <p className="text-[12px] font-semibold">{status?.name ?? catalog.provider.name}</p>
        <p className="mt-1 max-w-2xl text-[12px] leading-relaxed text-muted-foreground">
          {status?.description || catalog.provider.description || "—"}
        </p>
      </div>
      <span className="rounded-full border border-border/60 bg-card px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
        {catalog.provider.name}
      </span>
    </div>
  );
}

function PlanCard({
  tier,
  cycle,
  pending,
  onReview,
  lang,
}: {
  tier: BillingTierOption;
  cycle: string;
  pending: boolean;
  onReview: () => void;
  lang: string;
}) {
  const price = tier.prices.find((candidate) => candidate.cycle_code === cycle);
  const action = tier.actions?.find((candidate) => candidate.cycle_code === cycle);
  return (
    <article
      className={cn(
        "flex min-h-64 flex-col rounded-2xl border p-4 transition-colors sm:p-5",
        tier.is_current ? "border-foreground/25 bg-foreground/[0.025]" : "border-border/65",
      )}
      data-tier-code={tier.code}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-[17px] font-semibold tracking-[-0.015em]">{tier.name}</h3>
            {tier.is_current && tier.current_status ? (
              <span className="rounded-full bg-foreground px-2 py-1 text-[10px] font-semibold text-background">
                {tier.current_status.name}
              </span>
            ) : null}
          </div>
          {tier.description ? (
            <p className="mt-2 text-[12px] leading-relaxed text-muted-foreground">{tier.description}</p>
          ) : null}
        </div>
        <p className="shrink-0 text-right text-[16px] font-semibold tracking-[-0.01em]">
          {price?.display_price ?? action?.name ?? "—"}
        </p>
      </div>

      {action ? (
        <div className="mt-5 flex-1">
          <p className={cn("text-[12px] font-semibold", action.can_checkout && "text-success")}>{action.name}</p>
          {action.description ? (
            <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">{action.description}</p>
          ) : null}
        </div>
      ) : <div className="flex-1" />}

      <Button
        type="button"
        size="sm"
        variant={tier.is_current ? "outline" : "default"}
        className="mt-4 w-full"
        loading={pending}
        disabled={!action}
        onClick={onReview}
      >
        {t("upgrade.reviewPlan", lang)}
        <ChevronRightIcon size={15} />
      </Button>
    </article>
  );
}

function PlanComparison({ tiers, lang }: { tiers: BillingTierOption[]; lang: string }) {
  const limits = tiers[0]?.limits ?? [];
  const features = (tiers[0]?.features ?? []).filter((feature) => (
    tiers.some((tier) => tier.features?.some(
      (candidate) => candidate.code === feature.code && candidate.enabled,
    ))
  ));
  const gridStyle = {
    gridTemplateColumns: `minmax(190px, 1.3fr) repeat(${tiers.length}, minmax(150px, 1fr))`,
    minWidth: `${190 + (tiers.length * 150)}px`,
  };

  if (tiers.length === 0) return null;
  return (
    <Surface>
      <div>
        <h2 className="text-[16px] font-semibold">{t("upgrade.compareTitle", lang)}</h2>
        <p className="mt-1.5 text-[12px] leading-relaxed text-muted-foreground">{t("upgrade.compareSubtitle", lang)}</p>
      </div>
      <div className="mt-4 overflow-x-auto rounded-2xl border border-border/65">
        <div className="grid" style={gridStyle}>
          <div className="border-b border-border/65 bg-muted/25 px-3 py-3 text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
            {t("upgrade.allowance", lang)}
          </div>
          {tiers.map((tier) => (
            <div key={tier.code} className="border-b border-l border-border/65 bg-muted/25 px-3 py-3 text-[12px] font-semibold">
              {tier.name}
            </div>
          ))}

          {limits.map((limit) => (
            <React.Fragment key={`limit-${limit.code}`}>
              <div className="border-b border-border/55 px-3 py-3 text-[12px] font-medium" title={limit.description}>{limit.name}</div>
              {tiers.map((tier) => {
                const candidate = tier.limits?.find((row) => row.code === limit.code);
                return (
                  <div key={`${tier.code}-${limit.code}`} className="border-b border-l border-border/55 px-3 py-3 text-[12px] font-semibold">
                    {candidate?.display_value ?? "—"}
                  </div>
                );
              })}
            </React.Fragment>
          ))}

          {features.length > 0 ? (
            <div className="border-b border-border/65 bg-muted/25 px-3 py-3 text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
              {t("upgrade.feature", lang)}
            </div>
          ) : null}
          {features.length > 0 ? tiers.map((tier) => (
            <div key={`feature-heading-${tier.code}`} className="border-b border-l border-border/65 bg-muted/25" />
          )) : null}
          {features.map((feature) => (
            <React.Fragment key={`feature-${feature.code}`}>
              <div className="border-b border-border/55 px-3 py-3 text-[12px] font-medium" title={feature.description}>{feature.name}</div>
              {tiers.map((tier) => {
                const enabled = tier.features?.find((row) => row.code === feature.code)?.enabled === true;
                const status = tier.features?.find((row) => row.code === feature.code)?.status;
                return (
                  <div key={`${tier.code}-${feature.code}`} className="flex items-center gap-2 border-b border-l border-border/55 px-3 py-3 text-[12px]">
                    {enabled ? <CheckIcon size={14} className="text-success" /> : null}
                    <span className={enabled ? "font-semibold" : "text-muted-foreground"}>{status?.name ?? "—"}</span>
                  </div>
                );
              })}
            </React.Fragment>
          ))}
        </div>
      </div>
    </Surface>
  );
}

function CreditCard({
  pack,
  pending,
  onReview,
  lang,
}: {
  pack: ComputeCreditPack;
  pending: boolean;
  onReview: () => void;
  lang: string;
}) {
  return (
    <article className="flex min-h-56 flex-col rounded-2xl border border-border/65 p-4 sm:p-5" data-pack-code={pack.code}>
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-[16px] font-semibold">{pack.name}</h3>
          {pack.description ? <p className="mt-2 text-[12px] leading-relaxed text-muted-foreground">{pack.description}</p> : null}
        </div>
        <p className="shrink-0 text-[16px] font-semibold">{pack.display_price}</p>
      </div>
      <p className="mt-5 text-3xl font-light tracking-[-0.035em]">{pack.credits}</p>
      <p className="text-[11px] font-medium text-muted-foreground">{t("settings.billing.creditUnit", lang)}</p>
      <div className="mt-4 flex-1">
        {pack.action ? <p className={cn("text-[11px] font-semibold", pack.action.can_checkout && "text-success")}>{pack.action.name}</p> : null}
      </div>
      <Button
        type="button"
        size="sm"
        className="mt-3 w-full"
        loading={pending}
        disabled={!pack.action}
        onClick={onReview}
      >
        {t("upgrade.reviewCredits", lang)}
        <ChevronRightIcon size={15} />
      </Button>
    </article>
  );
}

function PurchaseReview({
  preview,
  pricingCountry,
  pending,
  onBack,
  onCheckout,
  lang,
}: {
  preview: BillingPurchasePreview;
  pricingCountry: string;
  pending: boolean;
  onBack: () => void;
  onCheckout: () => void;
  lang: string;
}) {
  return (
    <Surface className="mx-auto max-w-2xl">
      <div className="flex items-start gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-foreground text-background">
          <PriceIcon size={20} />
        </span>
        <div>
          <h2 className="text-[18px] font-semibold tracking-[-0.015em]">{t("upgrade.reviewTitle", lang)}</h2>
          <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">{t("upgrade.reviewSubtitle", lang)}</p>
        </div>
      </div>

      <dl className="mt-5 divide-y divide-border/60 rounded-2xl border border-border/65 px-4">
        <div className="flex items-center justify-between gap-4 py-3 text-[12px]">
          <dt className="text-muted-foreground">{t("upgrade.selection", lang)}</dt>
          <dd className="text-right font-semibold">{preview.product_name}</dd>
        </div>
        {preview.billing_cycle ? (
          <div className="flex items-center justify-between gap-4 py-3 text-[12px]">
            <dt className="text-muted-foreground">{t("settings.billing.cycle", lang)}</dt>
            <dd className="text-right font-semibold">{preview.billing_cycle_name}</dd>
          </div>
        ) : null}
        {preview.credits > 0 ? (
          <div className="flex items-center justify-between gap-4 py-3 text-[12px]">
            <dt className="text-muted-foreground">{t("settings.billing.creditsTitle", lang)}</dt>
            <dd className="text-right font-semibold">{preview.credits}</dd>
          </div>
        ) : null}
        <div className="flex items-center justify-between gap-4 py-3 text-[12px]">
          <dt className="text-muted-foreground">{t("upgrade.price", lang)}</dt>
          <dd className="text-right font-semibold">{preview.price?.display_price ?? preview.action.name}</dd>
        </div>
        <div className="flex items-center justify-between gap-4 py-3 text-[12px]">
          <dt className="text-muted-foreground">{t("upgrade.pricingCountry", lang)}</dt>
          <dd className="text-right font-semibold">{pricingCountry || "—"}</dd>
        </div>
      </dl>

      <div className="mt-4"><StatusNotice status={preview.action} /></div>
      <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-between">
        <Button type="button" variant="outline" onClick={onBack} disabled={pending}>
          <ArrowLeftIcon size={15} />
          {t("upgrade.backToChoices", lang)}
        </Button>
        <Button
          type="button"
          loading={pending}
          disabled={!preview.action.can_checkout}
          onClick={onCheckout}
        >
          {t("upgrade.continueCheckout", lang)}
          <ChevronRightIcon size={15} />
        </Button>
      </div>
    </Surface>
  );
}

function PurchaseComplete({
  receipt,
  status,
  onContinue,
  lang,
}: {
  receipt: BillingCheckoutResult | null;
  status: BillingCatalogStatus;
  onContinue: () => void;
  lang: string;
}) {
  return (
    <Surface className="mx-auto max-w-2xl text-center">
      <span className="mx-auto flex size-12 items-center justify-center rounded-full bg-success text-success-foreground">
        <CheckIcon size={23} />
      </span>
      <h2 className="mt-4 text-[20px] font-semibold">{status.name}</h2>
      <p className="mx-auto mt-2 max-w-lg text-[13px] leading-relaxed text-muted-foreground">{status.description}</p>
      {receipt ? (
        <dl className="mx-auto mt-5 max-w-md divide-y divide-border/60 rounded-2xl border border-border/65 px-4 text-left">
          <div className="flex justify-between gap-4 py-3 text-[12px]"><dt className="text-muted-foreground">{t("upgrade.selection", lang)}</dt><dd className="font-semibold">{receipt.product_name}</dd></div>
          {receipt.amount_minor > 0 ? <div className="flex justify-between gap-4 py-3 text-[12px]"><dt className="text-muted-foreground">{t("upgrade.price", lang)}</dt><dd className="font-semibold">{receipt.display_amount}</dd></div> : null}
          {receipt.credits > 0 ? <div className="flex justify-between gap-4 py-3 text-[12px]"><dt className="text-muted-foreground">{t("settings.billing.creditsTitle", lang)}</dt><dd className="font-semibold">{receipt.credits}</dd></div> : null}
        </dl>
      ) : null}
      <Button type="button" className="mt-6" onClick={onContinue}>{t("upgrade.continue", lang)}</Button>
    </Surface>
  );
}

export function BillingUpgradeFlow({ lang }: { lang: string }) {
  const [catalog, setCatalog] = React.useState<BillingCatalog | null>(null);
  const [mode, setMode] = React.useState<PurchaseMode>("plans");
  const [step, setStep] = React.useState<StepCode>("choose");
  const [cycle, setCycle] = React.useState("");
  const [preview, setPreview] = React.useState<BillingPurchasePreview | null>(null);
  const [receipt, setReceipt] = React.useState<BillingCheckoutResult | null>(null);
  const [checkoutStatus, setCheckoutStatus] = React.useState<BillingCatalogStatus | null>(null);
  const [pendingCode, setPendingCode] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const checkoutHandled = React.useRef(false);

  const loadCatalog = React.useCallback(async () => {
    const result = await getBillingCatalog();
    if (
      result.schema_version !== 2
      || !result.account
      || !result.purchase_flows
      || result.purchase_flows.subscription.length === 0
      || result.purchase_flows.credits.length === 0
    ) {
      throw new Error(t("upgrade.catalogUnavailable", lang));
    }
    const accountBillingCycle = result.account.billing_cycle;
    setCatalog(result);
    setCycle((current) => {
      if (result.cycles.some((candidate) => candidate.code === current)) return current;
      if (result.cycles.some((candidate) => candidate.code === accountBillingCycle)) {
        return accountBillingCycle;
      }
      return result.cycles[0]?.code ?? "";
    });
    return result;
  }, [lang]);

  React.useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("mode") === "credits") setMode("credits");
    setLoading(true);
    setError(null);
    void loadCatalog()
      .catch((err) => setError(getSafeApiErrorMessage(err, lang)))
      .finally(() => setLoading(false));
  }, [lang, loadCatalog]);

  React.useEffect(() => {
    if (!catalog || checkoutHandled.current) return;
    checkoutHandled.current = true;
    const params = new URLSearchParams(window.location.search);
    const checkout = params.get("checkout");
    const sessionId = params.get("session_id");
    if (!checkout) return;

    const clearCheckoutQuery = () => {
      params.delete("checkout");
      params.delete("session_id");
      const query = params.toString();
      window.history.replaceState({}, "", `${window.location.pathname}${query ? `?${query}` : ""}`);
    };

    if (checkout === "canceled") {
      const canceled = findStatus(catalog, "checkout", "canceled");
      if (canceled) setCheckoutStatus(canceled);
      clearCheckoutQuery();
      return;
    }
    if (checkout === "success" && sessionId) {
      setStep("checkout");
      setPendingCode("confirm");
      void confirmBillingCheckout(sessionId)
        .then(async (result) => {
          setReceipt(result);
          const refreshed = await loadCatalog();
          const completed = findStatus(refreshed, "checkout", result.status);
          if (completed) setCheckoutStatus(completed);
          setStep("complete");
        })
        .catch((err) => {
          setError(getSafeApiErrorMessage(err, lang));
          setStep("choose");
        })
        .finally(() => {
          setPendingCode(null);
          clearCheckoutQuery();
        });
    }
  }, [catalog, lang, loadCatalog]);

  function changeMode(next: string) {
    const normalized: PurchaseMode = next === "credits" ? "credits" : "plans";
    setMode(normalized);
    setStep("choose");
    setPreview(null);
    setCheckoutStatus(null);
    setError(null);
    const params = new URLSearchParams(window.location.search);
    params.set("mode", normalized);
    window.history.replaceState({}, "", `${window.location.pathname}?${params.toString()}`);
  }

  async function reviewPlan(tier: BillingTierOption) {
    if (!cycle) return;
    setPendingCode(`plan-${tier.code}`);
    setError(null);
    try {
      const result = await previewSubscriptionCheckout(tier.code, cycle);
      setPreview(result);
      setStep("review");
    } catch (err) {
      setError(getSafeApiErrorMessage(err, lang));
    } finally {
      setPendingCode(null);
    }
  }

  async function reviewCredits(pack: ComputeCreditPack) {
    setPendingCode(`credits-${pack.code}`);
    setError(null);
    try {
      const result = await previewCreditCheckout(pack.code);
      setPreview(result);
      setStep("review");
    } catch (err) {
      setError(getSafeApiErrorMessage(err, lang));
    } finally {
      setPendingCode(null);
    }
  }

  async function beginCheckout() {
    if (!preview?.action.can_checkout) return;
    setPendingCode("checkout");
    setError(null);
    setStep("checkout");
    try {
      const redirect = preview.kind === "subscription"
        ? await createSubscriptionCheckout(preview.product_code, preview.billing_cycle)
        : await createCreditCheckout(preview.product_code);
      window.location.assign(redirect.url);
    } catch (err) {
      setError(getSafeApiErrorMessage(err, lang));
      setStep("review");
      setPendingCode(null);
    }
  }

  if (loading && !catalog) {
    return <div className="async-stable-region min-h-80 rounded-2xl border border-border/65 bg-card" role="status" aria-busy="true" />;
  }

  if (!catalog) {
    return (
      <Surface className="mx-auto max-w-2xl text-center">
        <h2 className="text-[17px] font-semibold">{t("upgrade.catalogUnavailable", lang)}</h2>
        {error ? <p className="mt-2 text-[12px] text-destructive" role="alert">{error}</p> : null}
        <Button type="button" variant="outline" className="mt-5" onClick={() => window.location.reload()}>{t("common.retry", lang)}</Button>
      </Surface>
    );
  }

  const steps = mode === "plans"
    ? catalog.purchase_flows?.subscription ?? []
    : catalog.purchase_flows?.credits ?? [];
  const pricingCountry = catalog.countries.find((country) => country.code === catalog.pricing_country)?.name
    ?? catalog.pricing_country;
  const account = catalog.account;
  // Django returns a separate, rank-checked purchase list. Missing data fails
  // closed during a rolling deploy instead of exposing the unfiltered catalog.
  const upgradeOptions = catalog.upgrade_options ?? [];
  const currentTier = catalog.tiers.find((tier) => tier.is_current);

  return (
    <div className="space-y-5">
      <Surface className="space-y-4">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">{t("upgrade.account", lang)}</p>
            <p className="mt-1 text-[18px] font-semibold">{account?.current_tier_name ?? "—"}</p>
            <p className="mt-1 text-[12px] text-muted-foreground">{account?.subscription_status?.name ?? "—"}</p>
          </div>
          <div className="rounded-2xl bg-foreground px-4 py-3 text-background sm:min-w-48">
            <p className="text-[11px] font-medium text-background/65">{t("upgrade.currentBalance", lang)}</p>
            <p className="mt-1 text-2xl font-light tracking-[-0.025em]">
              {account?.credits.unlimited
                ? catalog.credit_balance_status?.name ?? "—"
                : account?.credits.spendable ?? "—"}
            </p>
          </div>
        </div>
        <ProviderState catalog={catalog} />
      </Surface>

      <Tabs value={mode} onValueChange={changeMode}>
        <TabsList className="grid w-full grid-cols-2 sm:w-auto">
          <TabsTrigger value="plans">{t("upgrade.plansTab", lang)}</TabsTrigger>
          <TabsTrigger value="credits">{t("upgrade.creditsTab", lang)}</TabsTrigger>
        </TabsList>
      </Tabs>

      <StepRail steps={steps} current={step} />

      {checkoutStatus && step !== "complete" ? <StatusNotice status={checkoutStatus} /> : null}
      {error ? <p className="rounded-xl border border-destructive/25 bg-destructive/5 px-3.5 py-3 text-[12px] text-destructive" role="alert">{error}</p> : null}

      {step === "choose" && mode === "plans" ? (
        <>
          <Surface>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <h2 className="text-[16px] font-semibold">{t("upgrade.plansTitle", lang)}</h2>
                <p className="mt-1.5 text-[12px] leading-relaxed text-muted-foreground">{t("upgrade.plansSubtitle", lang)}</p>
              </div>
              <Select value={cycle} onValueChange={setCycle}>
                <SelectTrigger className="w-full sm:w-44" aria-label={t("settings.billing.chooseCycle", lang)}><SelectValue /></SelectTrigger>
                <SelectContent>
                  {catalog.cycles.map((candidate) => <SelectItem key={candidate.code} value={candidate.code}>{candidate.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            {upgradeOptions.length > 0 ? (
              <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {upgradeOptions.map((tier) => (
                  <PlanCard
                    key={tier.code}
                    tier={tier}
                    cycle={cycle}
                    pending={pendingCode === `plan-${tier.code}`}
                    onReview={() => void reviewPlan(tier)}
                    lang={lang}
                  />
                ))}
              </div>
            ) : currentTier?.current_status ? (
              <div className="mt-5" data-testid="no-plan-upgrades">
                <StatusNotice status={currentTier.current_status} />
              </div>
            ) : null}
          </Surface>
          {upgradeOptions.length > 0 ? <PlanComparison tiers={catalog.tiers} lang={lang} /> : null}
        </>
      ) : null}

      {step === "choose" && mode === "credits" ? (
        <>
          <Surface>
            <h2 className="text-[16px] font-semibold">{t("upgrade.creditsTitle", lang)}</h2>
            <p className="mt-1.5 text-[12px] leading-relaxed text-muted-foreground">{t("upgrade.creditsSubtitle", lang)}</p>
            <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {catalog.credit_packs.map((pack) => (
                <CreditCard
                  key={pack.code}
                  pack={pack}
                  pending={pendingCode === `credits-${pack.code}`}
                  onReview={() => void reviewCredits(pack)}
                  lang={lang}
                />
              ))}
            </div>
          </Surface>
          <Surface>
            <h2 className="text-[16px] font-semibold">{t("settings.billing.creditCosts", lang)}</h2>
            <div className="mt-4 grid gap-2 sm:grid-cols-2">
              {catalog.compute_jobs.map((job) => (
                <div key={job.code} className="flex items-start justify-between gap-4 rounded-xl bg-muted/30 px-3.5 py-3">
                  <div><p className="text-[12px] font-semibold">{job.name}</p>{job.description ? <p className="mt-1 text-[11px] text-muted-foreground">{job.description}</p> : null}</div>
                  <p className="shrink-0 text-[12px] font-semibold">{job.credits_cost} {t("settings.billing.creditUnit", lang)}</p>
                </div>
              ))}
            </div>
          </Surface>
        </>
      ) : null}

      {step === "review" && preview ? (
        <PurchaseReview
          preview={preview}
          pricingCountry={pricingCountry}
          pending={pendingCode === "checkout"}
          onBack={() => { setStep("choose"); setPreview(null); setError(null); }}
          onCheckout={() => void beginCheckout()}
          lang={lang}
        />
      ) : null}

      {step === "checkout" ? (
        <Surface className="mx-auto max-w-2xl text-center" aria-live="polite">
          <span className="mx-auto block size-8 animate-spin rounded-full border-2 border-muted border-t-foreground" aria-hidden="true" />
          <h2 className="mt-4 text-[17px] font-semibold">{t("upgrade.checkoutStarting", lang)}</h2>
          <p className="mt-2 text-[12px] text-muted-foreground">{catalog.provider.name}</p>
        </Surface>
      ) : null}

      {step === "complete" && checkoutStatus ? (
        <PurchaseComplete
          receipt={receipt}
          status={checkoutStatus}
          onContinue={() => { setStep("choose"); setPreview(null); setReceipt(null); setCheckoutStatus(null); }}
          lang={lang}
        />
      ) : null}

      <div className="flex justify-center pb-2">
        <Button asChild variant="ghost" size="sm"><Link href="/settings#billing">{t("upgrade.billingSettings", lang)}</Link></Button>
      </div>
    </div>
  );
}
