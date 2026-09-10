"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "../lib/ui/button";
import { Checkbox } from "../lib/ui/checkbox";
import { Input } from "../lib/ui/input";
import { Label } from "../lib/ui/label";
import { Switch } from "../lib/ui/switch";
import { Textarea } from "../lib/ui/textarea";
import {
  grantReaiAgentConsent,
  grantReaiImprovementConsent,
  requestPhoneLinkOtp,
  resendVerification,
  revokeReaiImprovementConsent,
  updateAccountConsent,
  updateBilling,
  updatePersonalizedData,
  updateProfile,
  updateReaiToolPermissions,
  updateSellerProfile,
  verifyPhoneLinkOtp,
  type ReaiImprovementConsent,
  type UserProfile,
} from "../lib/api/client";
import { getReaiImprovementConsent } from "../lib/api/client";
import { getSafeApiErrorMessage } from "../lib/api/error-message";
import { t } from "../lib/i18n";
import type { LocaleKey } from "../lib/locales";
import { formatPhoneDisplay } from "../lib/phone";
import { cn } from "../lib/utils";
import {
  computeAccountSetupStatus,
  type AccountSetupStatus,
  type SetupBlockerKey,
  type SetupMissingKey,
  type SetupStepKey,
} from "../lib/account-setup";
import { AgentIcon, CheckIcon, DeviceMobileIcon, EditIcon, PriceIcon } from "./icons";
import { useAccountSetup } from "./hooks/use-account-setup";

/**
 * Guided account setup — the four things a new creator still owes after the
 * sign-up form: profile, seller details, billing details, and the Agent
 * permissions. Each step saves through the same endpoints Settings uses, so
 * nothing here is a second source of truth; Settings stays the place to edit
 * later. The rail on the left is the status, the card on the right is one
 * step's form.
 */

const STEPS: Array<{ key: SetupStepKey; label: LocaleKey; hint: LocaleKey; icon: React.ComponentType<{ size?: number; className?: string }> }> = [
  { key: "profile", label: "setup.step.profile", hint: "setup.step.profileHint", icon: EditIcon },
  { key: "seller", label: "setup.step.seller", hint: "setup.step.sellerHint", icon: DeviceMobileIcon },
  { key: "billing", label: "setup.step.billing", hint: "setup.step.billingHint", icon: PriceIcon },
  { key: "permissions", label: "setup.step.permissions", hint: "setup.step.permissionsHint", icon: AgentIcon },
];

const MISSING_LABELS: Record<SetupMissingKey, LocaleKey> = {
  first_name: "setup.missing.first_name",
  last_name: "setup.missing.last_name",
  username: "setup.missing.username",
  phone: "setup.missing.phone",
  phone_verified: "setup.missing.phone_verified",
  bio: "setup.missing.bio",
  city: "setup.missing.city",
  country: "setup.missing.country",
  billing_name: "setup.missing.billing_name",
  billing_email: "setup.missing.billing_email",
  billing_address: "setup.missing.billing_address",
  billing_city: "setup.missing.billing_city",
  billing_postal_code: "setup.missing.billing_postal_code",
  billing_country: "setup.missing.billing_country",
  agent_consent: "setup.missing.agent_consent",
  agent_tools: "setup.missing.agent_tools",
};

const BLOCKER_LABELS: Record<SetupBlockerKey, LocaleKey> = {
  email_verified: "setup.blocker.email_verified",
  reaigen_access: "setup.blocker.reaigen_access",
  account_disabled: "setup.blocker.account_disabled",
};

/** Sign-in opens the flow at most once per browser session (see dashboard). */
export const ACCOUNT_SETUP_PROMPTED_KEY = "reaigen:account-setup-prompted";

type StepView = SetupStepKey | "done";

function Field({ id, label, required, children }: { id: string; label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id} className="flex items-center gap-1.5">
        {label}
        {required ? <span aria-hidden="true" className="text-[11px] font-medium text-foreground/40">*</span> : null}
      </Label>
      {children}
    </div>
  );
}

function StepFooter({
  lang,
  canBack,
  onBack,
  saving,
  continueLabel,
  disabled,
}: {
  lang: string;
  canBack: boolean;
  onBack: () => void;
  saving: boolean;
  continueLabel?: string;
  disabled?: boolean;
}) {
  return (
    <div className="flex flex-col-reverse gap-2 border-t border-border/60 pt-5 sm:flex-row sm:items-center sm:justify-between">
      <div>
        {canBack ? (
          <Button type="button" variant="ghost" size="sm" onClick={onBack} disabled={saving}>
            {t("setup.back", lang)}
          </Button>
        ) : null}
      </div>
      <Button type="submit" size="sm" loading={saving} disabled={disabled} data-testid="setup-continue">
        {continueLabel ?? t("setup.continue", lang)}
      </Button>
    </div>
  );
}

/* ── Step 1: profile ────────────────────────────────────────────────────── */

function ProfileStep({ user, lang, onSaved, onAdvance }: StepProps) {
  const [firstName, setFirstName] = React.useState(user.first_name ?? "");
  const [lastName, setLastName] = React.useState(user.last_name ?? "");
  const [username, setUsername] = React.useState(user.username ?? "");
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [resent, setResent] = React.useState(false);
  const canSubmit = firstName.trim().length > 0 && lastName.trim().length > 0 && username.trim().length > 0;

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!canSubmit || saving) return;
    setError(null);
    setSaving(true);
    try {
      const changed = firstName.trim() !== (user.first_name ?? "") || lastName.trim() !== (user.last_name ?? "") || username.trim() !== (user.username ?? "");
      if (changed) {
        await updateProfile({ first_name: firstName.trim(), last_name: lastName.trim(), username: username.trim() });
        await onSaved();
      }
      onAdvance();
    } catch (err) {
      setError(getSafeApiErrorMessage(err, lang));
    } finally {
      setSaving(false);
    }
  }

  async function handleResend() {
    setError(null);
    try {
      await resendVerification(user.email);
      setResent(true);
    } catch (err) {
      setError(getSafeApiErrorMessage(err, lang));
    }
  }

  return (
    <form className="space-y-5" onSubmit={handleSubmit} noValidate data-testid="setup-step-profile">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field id="setup-first-name" label={t("settings.profile.firstName", lang)} required>
          <Input id="setup-first-name" value={firstName} onChange={(e) => setFirstName(e.target.value)} autoComplete="given-name" />
        </Field>
        <Field id="setup-last-name" label={t("settings.profile.lastName", lang)} required>
          <Input id="setup-last-name" value={lastName} onChange={(e) => setLastName(e.target.value)} autoComplete="family-name" />
        </Field>
      </div>
      <Field id="setup-username" label={t("settings.profile.username", lang)} required>
        <Input id="setup-username" value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" />
      </Field>
      <div className="space-y-1.5">
        <Label>{t("settings.profile.email", lang)}</Label>
        <div className="flex min-h-11 flex-wrap items-center justify-between gap-3 rounded-xl border border-border/55 bg-surface-subtle px-3.5 py-2">
          <span className="min-w-0 truncate text-[14px] text-foreground/85">{user.email}</span>
          {user.email_verified ? (
            <span className="shrink-0 rounded-full bg-success/10 px-2.5 py-0.5 text-[11px] font-semibold text-success">{t("settings.profile.emailVerified", lang)}</span>
          ) : (
            <button type="button" onClick={handleResend} className="shrink-0 rounded-full px-2.5 py-0.5 text-[11px] font-semibold text-foreground/65 underline underline-offset-4 hover:text-foreground">
              {resent ? t("setup.blocker.resent", lang) : t("setup.blocker.resend", lang)}
            </button>
          )}
        </div>
      </div>
      {error ? <p role="alert" className="text-[12px] text-destructive">{error}</p> : null}
      <StepFooter lang={lang} canBack={false} onBack={() => {}} saving={saving} disabled={!canSubmit} />
    </form>
  );
}

/* ── Step 2: seller profile ─────────────────────────────────────────────── */

function SellerStep({ user, lang, onSaved, onAdvance, onBack }: StepProps) {
  const p = user.profile;
  const [phone, setPhone] = React.useState(p?.phone ?? "");
  const [company, setCompany] = React.useState(p?.company ?? "");
  const [jobTitle, setJobTitle] = React.useState(p?.job_title ?? "");
  const [website, setWebsite] = React.useState(p?.website ?? "");
  const [bio, setBio] = React.useState(p?.bio ?? "");
  const [address, setAddress] = React.useState(p?.address ?? "");
  const [city, setCity] = React.useState(p?.city ?? "");
  const [state, setState] = React.useState(p?.state ?? "");
  const [postalCode, setPostalCode] = React.useState(p?.postal_code ?? "");
  const [country, setCountry] = React.useState(p?.country ?? "");
  const [isRePro, setIsRePro] = React.useState(p?.is_real_estate_professional ?? false);
  const [license, setLicense] = React.useState(p?.license_number ?? "");
  const [agency, setAgency] = React.useState(p?.agency_name ?? "");
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  // Phone verification. The OTP is sent to the number on the saved profile,
  // so a freshly typed number is saved first and verified second.
  const savedPhone = (p?.phone ?? "").trim();
  const phoneVerified = Boolean(savedPhone) && Boolean(user.phone_verified || p?.phone_verified);
  const phoneMatchesSaved = phone.trim() === savedPhone && savedPhone.length > 0;
  const [otpSent, setOtpSent] = React.useState(false);
  const [code, setCode] = React.useState("");
  const [otpBusy, setOtpBusy] = React.useState(false);
  const phoneDisplay = formatPhoneDisplay(savedPhone);

  const canSubmit = phone.trim().length > 0 && bio.trim().length > 0 && city.trim().length > 0 && country.trim().length > 0;

  async function save() {
    await updateSellerProfile({
      phone: phone.trim(),
      company: company.trim(),
      job_title: jobTitle.trim(),
      website: website.trim(),
      bio: bio.trim(),
      address: address.trim(),
      city: city.trim(),
      state: state.trim(),
      postal_code: postalCode.trim(),
      country: country.trim().toUpperCase(),
      is_real_estate_professional: isRePro,
      license_number: isRePro ? license.trim() : "",
      agency_name: isRePro ? agency.trim() : "",
    });
    await onSaved();
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!canSubmit || saving) return;
    setError(null);
    setSaving(true);
    try {
      await save();
      onAdvance();
    } catch (err) {
      setError(getSafeApiErrorMessage(err, lang));
    } finally {
      setSaving(false);
    }
  }

  async function handleRequestOtp() {
    setError(null);
    setOtpBusy(true);
    try {
      if (!phoneMatchesSaved) await save();
      await requestPhoneLinkOtp(phone.trim());
      setOtpSent(true);
    } catch (err) {
      setError(getSafeApiErrorMessage(err, lang));
    } finally {
      setOtpBusy(false);
    }
  }

  async function handleVerify() {
    if (code.length < 4) return;
    setError(null);
    setOtpBusy(true);
    try {
      await verifyPhoneLinkOtp({ phone: phone.trim(), code });
      setOtpSent(false);
      setCode("");
      await onSaved();
    } catch (err) {
      setError(getSafeApiErrorMessage(err, lang));
    } finally {
      setOtpBusy(false);
    }
  }

  return (
    <form className="space-y-5" onSubmit={handleSubmit} noValidate data-testid="setup-step-seller">
      <div className="space-y-1.5">
        <Label htmlFor="setup-phone" className="flex items-center gap-1.5">
          {t("settings.seller.phone", lang)}
          <span aria-hidden="true" className="text-[11px] font-medium text-foreground/40">*</span>
        </Label>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <Input id="setup-phone" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+421 900 123 456" inputMode="tel" autoComplete="tel" className="sm:max-w-[18rem]" />
          {phoneVerified && phoneMatchesSaved ? (
            <span className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full bg-success/10 px-3 text-[11px] font-semibold text-success">
              <CheckIcon size={12} /> {t("setup.seller.phoneVerified", lang)}
            </span>
          ) : phone.trim().length > 0 && !otpSent ? (
            <Button type="button" variant="outline" size="sm" className="shrink-0" loading={otpBusy} onClick={handleRequestOtp} data-testid="setup-verify-phone">
              {t("setup.seller.verifyPhone", lang)}
            </Button>
          ) : null}
        </div>
        <p className="text-[12px] text-muted-foreground">{t("setup.seller.phoneHint", lang)}</p>
        {otpSent ? (
          <div className="space-y-2 rounded-2xl border border-border/65 bg-muted/20 p-4">
            <Label htmlFor="setup-phone-code">{t("setup.seller.codeSent", lang)} {phoneDisplay.display || phone.trim()}</Label>
            <div className="flex items-center gap-2">
              <Input
                id="setup-phone-code"
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                placeholder={t("setup.seller.codePlaceholder", lang)}
                maxLength={6}
                inputMode="numeric"
                autoComplete="one-time-code"
                className="w-full max-w-[10.5rem] font-mono tracking-[0.2em]"
              />
              <Button type="button" size="sm" className="shrink-0" loading={otpBusy} disabled={code.length < 4} onClick={handleVerify}>
                {t("setup.seller.confirmCode", lang)}
              </Button>
            </div>
          </div>
        ) : null}
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field id="setup-company" label={t("settings.seller.company", lang)}>
          <Input id="setup-company" value={company} onChange={(e) => setCompany(e.target.value)} autoComplete="organization" />
        </Field>
        <Field id="setup-job-title" label={t("settings.seller.jobTitle", lang)}>
          <Input id="setup-job-title" value={jobTitle} onChange={(e) => setJobTitle(e.target.value)} autoComplete="organization-title" />
        </Field>
      </div>
      <Field id="setup-bio" label={t("settings.seller.bio", lang)} required>
        <Textarea id="setup-bio" value={bio} onChange={(e) => setBio(e.target.value)} rows={3} placeholder={t("setup.seller.bioPlaceholder", lang)} />
      </Field>
      <Field id="setup-website" label={t("settings.seller.website", lang)}>
        <Input id="setup-website" value={website} onChange={(e) => setWebsite(e.target.value)} placeholder="https://www.example.com" inputMode="url" autoComplete="url" />
      </Field>

      <div className="space-y-4 border-t border-border/60 pt-5">
        <p className="text-[13px] font-semibold text-foreground/80">{t("settings.seller.sectionAddress", lang)}</p>
        <Field id="setup-address" label={t("settings.seller.address", lang)}>
          <Input id="setup-address" value={address} onChange={(e) => setAddress(e.target.value)} autoComplete="street-address" />
        </Field>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field id="setup-city" label={t("settings.seller.city", lang)} required>
            <Input id="setup-city" value={city} onChange={(e) => setCity(e.target.value)} autoComplete="address-level2" />
          </Field>
          <Field id="setup-state" label={t("settings.seller.state", lang)}>
            <Input id="setup-state" value={state} onChange={(e) => setState(e.target.value)} autoComplete="address-level1" />
          </Field>
          <Field id="setup-postal" label={t("settings.seller.postalCode", lang)}>
            <Input id="setup-postal" value={postalCode} onChange={(e) => setPostalCode(e.target.value)} autoComplete="postal-code" />
          </Field>
          <Field id="setup-country" label={t("settings.seller.country", lang)} required>
            <Input id="setup-country" value={country} onChange={(e) => setCountry(e.target.value.toUpperCase())} maxLength={2} placeholder="SK" autoComplete="country" />
          </Field>
        </div>
      </div>

      <div className="space-y-4 border-t border-border/60 pt-5">
        <div className="flex items-start justify-between gap-4">
          <p className="text-sm font-medium">{t("settings.seller.reAgent", lang)}</p>
          <Switch aria-label={t("settings.seller.reAgent", lang)} checked={isRePro} onCheckedChange={setIsRePro} />
        </div>
        {isRePro ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field id="setup-license" label={t("settings.seller.license", lang)}>
              <Input id="setup-license" value={license} onChange={(e) => setLicense(e.target.value)} />
            </Field>
            <Field id="setup-agency" label={t("settings.seller.agency", lang)}>
              <Input id="setup-agency" value={agency} onChange={(e) => setAgency(e.target.value)} />
            </Field>
          </div>
        ) : null}
      </div>

      {error ? <p role="alert" className="text-[12px] text-destructive">{error}</p> : null}
      <StepFooter lang={lang} canBack onBack={onBack} saving={saving} disabled={!canSubmit} />
    </form>
  );
}

/* ── Step 3: billing ────────────────────────────────────────────────────── */

function BillingStep({ user, lang, onSaved, onAdvance, onBack }: StepProps) {
  const ba = user.billing_account;
  const p = user.profile;
  const fullName = `${user.first_name ?? ""} ${user.last_name ?? ""}`.trim();
  const [billingName, setBillingName] = React.useState(ba?.billing_name || p?.company || fullName);
  const [billingEmail, setBillingEmail] = React.useState(ba?.billing_email || user.email);
  const [billingAddress, setBillingAddress] = React.useState(ba?.billing_address ?? "");
  const [billingCity, setBillingCity] = React.useState(ba?.billing_city ?? "");
  const [billingPostal, setBillingPostal] = React.useState(ba?.billing_postal_code ?? "");
  const [billingCountry, setBillingCountry] = React.useState(ba?.billing_country ?? "");
  const [vat, setVat] = React.useState(ba?.vat_number ?? "");
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const sellerAddressAvailable = Boolean(p && (p.address || p.city || p.postal_code || p.country));
  const canSubmit = [billingName, billingEmail, billingAddress, billingCity, billingPostal, billingCountry].every((value) => value.trim().length > 0);

  function useSellerAddress() {
    if (!p) return;
    setBillingAddress(p.address ?? "");
    setBillingCity(p.city ?? "");
    setBillingPostal(p.postal_code ?? "");
    setBillingCountry(p.country ?? "");
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!canSubmit || saving) return;
    setError(null);
    setSaving(true);
    try {
      await updateBilling({
        billing_name: billingName.trim(),
        billing_email: billingEmail.trim(),
        billing_address: billingAddress.trim(),
        billing_city: billingCity.trim(),
        billing_postal_code: billingPostal.trim(),
        billing_country: billingCountry.trim().toUpperCase(),
        vat_number: vat.trim(),
      });
      await onSaved();
      onAdvance();
    } catch (err) {
      setError(getSafeApiErrorMessage(err, lang));
    } finally {
      setSaving(false);
    }
  }

  const tier = ba?.subscription_tier_detail;

  return (
    <form className="space-y-5" onSubmit={handleSubmit} noValidate data-testid="setup-step-billing">
      {tier ? (
        <div className="flex items-center justify-between gap-4 rounded-xl border border-border/55 bg-surface-subtle px-3.5 py-2.5 text-[13px]">
          <span className="text-muted-foreground">{t("settings.billing.plan", lang)}</span>
          <span className="font-medium">{tier.name}{ba?.subscription_status ? ` · ${ba.subscription_status}` : ""}</span>
        </div>
      ) : null}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field id="setup-billing-name" label={t("settings.billing.name", lang)} required>
          <Input id="setup-billing-name" value={billingName} onChange={(e) => setBillingName(e.target.value)} autoComplete="name" />
        </Field>
        <Field id="setup-billing-email" label={t("settings.billing.email", lang)} required>
          <Input id="setup-billing-email" value={billingEmail} onChange={(e) => setBillingEmail(e.target.value)} type="email" autoComplete="email" />
        </Field>
      </div>
      <div className="space-y-1.5">
        <div className="flex items-center justify-between gap-3">
          <Label htmlFor="setup-billing-address" className="flex items-center gap-1.5">
            {t("settings.billing.address", lang)}
            <span aria-hidden="true" className="text-[11px] font-medium text-foreground/40">*</span>
          </Label>
          {sellerAddressAvailable ? (
            <button type="button" onClick={useSellerAddress} className="text-[12px] font-medium text-foreground/60 underline underline-offset-4 hover:text-foreground" data-testid="setup-billing-copy-address">
              {t("setup.billing.sameAsSeller", lang)}
            </button>
          ) : null}
        </div>
        <Input id="setup-billing-address" value={billingAddress} onChange={(e) => setBillingAddress(e.target.value)} autoComplete="street-address" />
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Field id="setup-billing-city" label={t("settings.billing.city", lang)} required>
          <Input id="setup-billing-city" value={billingCity} onChange={(e) => setBillingCity(e.target.value)} autoComplete="address-level2" />
        </Field>
        <Field id="setup-billing-postal" label={t("settings.billing.postalCode", lang)} required>
          <Input id="setup-billing-postal" value={billingPostal} onChange={(e) => setBillingPostal(e.target.value)} autoComplete="postal-code" />
        </Field>
        <Field id="setup-billing-country" label={t("settings.billing.country", lang)} required>
          <Input id="setup-billing-country" value={billingCountry} onChange={(e) => setBillingCountry(e.target.value.toUpperCase())} maxLength={2} placeholder="SK" autoComplete="country" />
        </Field>
        <Field id="setup-billing-vat" label={t("settings.billing.vat", lang)}>
          <Input id="setup-billing-vat" value={vat} onChange={(e) => setVat(e.target.value)} />
        </Field>
      </div>
      {error ? <p role="alert" className="text-[12px] text-destructive">{error}</p> : null}
      <StepFooter lang={lang} canBack onBack={onBack} saving={saving} disabled={!canSubmit} />
    </form>
  );
}

/* ── Step 4: permissions ────────────────────────────────────────────────── */

function PermissionsStep({
  user,
  lang,
  onSaved,
  onAdvance,
  onBack,
  signals,
  refreshSignals,
  blocked,
}: StepProps & {
  signals: ReturnType<typeof useAccountSetup>["signals"];
  refreshSignals: () => void;
  blocked: boolean;
}) {
  const consent = signals?.consent ?? null;
  const consentKnown = consent !== null && consent !== "blocked";
  const consented = consentKnown && consent.consented;
  const toolPermissions = signals?.toolPermissions ?? null;
  const [acknowledged, setAcknowledged] = React.useState(false);
  const [improvement, setImprovement] = React.useState<ReaiImprovementConsent | null>(null);
  const [marketing, setMarketing] = React.useState(Boolean(user.gdpr?.marketing_consent));
  const [busy, setBusy] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!consented) return;
    let active = true;
    getReaiImprovementConsent()
      .then((value) => { if (active) setImprovement(value); })
      .catch(() => { if (active) setImprovement(null); });
    return () => { active = false; };
  }, [consented]);

  async function run(key: string, action: () => Promise<void>) {
    if (busy) return;
    setBusy(key);
    setError(null);
    try {
      await action();
    } catch (err) {
      setError(getSafeApiErrorMessage(err, lang));
    } finally {
      setBusy(null);
    }
  }

  const enableAgent = () => run("consent", async () => {
    if (!consentKnown) return;
    await grantReaiAgentConsent(consent.policy_version);
    setAcknowledged(false);
    window.dispatchEvent(new CustomEvent("reai-consent-changed", { detail: { enabled: true } }));
    refreshSignals();
  });

  const setAllTools = (allowAll: boolean) => run("tools", async () => {
    await updateReaiToolPermissions({ allow_all_tools: allowAll });
    refreshSignals();
  });

  const toggleImprovement = (enabled: boolean) => run("improvement", async () => {
    if (!improvement) return;
    setImprovement(enabled ? await grantReaiImprovementConsent(improvement.policy_version) : await revokeReaiImprovementConsent());
  });

  const toggleMarketing = (enabled: boolean) => run("marketing", async () => {
    setMarketing(enabled);
    await updateAccountConsent({ marketing_consent: enabled });
  });

  const anyTool = Boolean(toolPermissions && (toolPermissions.allow_all_tools || Object.values(toolPermissions.tools).some(Boolean)));
  const ready = consented && anyTool;

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    await run("finish", async () => {
      await updatePersonalizedData({ onboarding_completed: true, onboarding_skipped: false, onboarding_step: STEPS.length });
      await onSaved();
      onAdvance();
    });
  }

  return (
    <form className="space-y-5" onSubmit={handleSubmit} noValidate data-testid="setup-step-permissions">
      <section className="space-y-3 rounded-2xl border border-border/60 p-4">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-[13px] font-semibold">{t("settings.reai.access", lang)}</p>
            <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">
              {consented ? t("settings.reai.accessEnabled", lang) : t("settings.reai.accessDisabled", lang)}
            </p>
          </div>
          <span className={cn("shrink-0 rounded-full px-2.5 py-0.5 text-[11px] font-semibold", consented ? "bg-success/10 text-success" : "bg-foreground/[0.07] text-foreground/70")}>
            {consented ? t("common.allowed", lang) : t("common.notAllowed", lang)}
          </span>
        </div>
        {blocked ? (
          <p className="rounded-lg bg-muted/25 p-3 text-[12px] leading-relaxed text-foreground/70">{t("setup.blocker.reaigen_access", lang)}</p>
        ) : consent === null ? (
          <p className="text-[12px] text-muted-foreground">{t("common.loading", lang)}</p>
        ) : consented ? null : (
          <div className="space-y-3">
            <div className="rounded-lg bg-muted/25 p-4 text-[12px] leading-relaxed text-foreground/70">
              <p>{t("reai.consentData", lang)}</p>
              <p className="mt-1.5">{t("reai.consentNoData", lang)}</p>
              <p className="mt-1.5">{t("reai.consentStorage", lang)}</p>
              <p className="mt-1.5">{t("reai.consentMedia", lang)}</p>
            </div>
            <label className="flex cursor-pointer items-start gap-2.5 text-[12px] leading-relaxed text-foreground/75">
              <Checkbox checked={acknowledged} onCheckedChange={(checked) => setAcknowledged(checked === true)} className="mt-0.5" data-testid="setup-consent-ack" />
              <span>{t("reai.consentLabel", lang)} · v{consentKnown ? consent.policy_version : ""}</span>
            </label>
            <Button type="button" size="sm" loading={busy === "consent"} disabled={!acknowledged} onClick={enableAgent} data-testid="setup-enable-agent">
              {t("reai.enable", lang)}
            </Button>
          </div>
        )}
      </section>

      {consented ? (
        <section className="space-y-3 rounded-2xl border border-border/60 p-4">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="text-[13px] font-semibold">{t("settings.reai.allTools", lang)}</p>
              <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">{t("settings.reai.allToolsHelp", lang)}</p>
            </div>
            <Switch
              aria-label={t("settings.reai.allTools", lang)}
              checked={Boolean(toolPermissions?.allow_all_tools)}
              disabled={!toolPermissions || busy === "tools"}
              onCheckedChange={setAllTools}
              data-testid="setup-all-tools"
            />
          </div>
          {toolPermissions && !anyTool ? (
            <p className="text-[12px] text-foreground/65">{t("setup.permissions.noTools", lang)}</p>
          ) : null}
          <p className="text-[12px] leading-relaxed text-muted-foreground">{t("settings.reai.toolsConfirmation", lang)}</p>
        </section>
      ) : null}

      {consented && improvement ? (
        <section className="flex items-start justify-between gap-4 rounded-2xl border border-border/60 p-4">
          <div className="min-w-0">
            <p className="text-[13px] font-semibold">{t("settings.reai.improvementPermission", lang)}</p>
            <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">{t("settings.reai.improvementSubtitle", lang)}</p>
          </div>
          <Switch aria-label={t("settings.reai.improvementPermission", lang)} checked={improvement.consented} disabled={busy === "improvement"} onCheckedChange={toggleImprovement} />
        </section>
      ) : null}

      <section className="flex items-start justify-between gap-4 rounded-2xl border border-border/60 p-4">
        <div className="min-w-0">
          <p className="text-[13px] font-semibold">{t("settings.privacy.legal.marketingConsent", lang)}</p>
          <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">{t("settings.privacy.legal.marketingConsentHint", lang)}</p>
        </div>
        <Switch aria-label={t("settings.privacy.legal.marketingConsent", lang)} checked={marketing} disabled={busy === "marketing"} onCheckedChange={toggleMarketing} />
      </section>

      {error ? <p role="alert" className="text-[12px] text-destructive">{error}</p> : null}
      <StepFooter lang={lang} canBack onBack={onBack} saving={busy === "finish"} continueLabel={t("setup.finish", lang)} disabled={!ready && !blocked} />
    </form>
  );
}

/* ── Flow ───────────────────────────────────────────────────────────────── */

interface StepProps {
  user: UserProfile;
  lang: string;
  onSaved: () => Promise<unknown>;
  onAdvance: () => void;
  onBack: () => void;
}

export function AccountSetupFlow({
  user,
  lang,
  onSaved,
}: {
  user: UserProfile;
  lang: string;
  onSaved: () => Promise<unknown>;
}) {
  const router = useRouter();
  const { status, signals, refresh } = useAccountSetup(user);
  // Opens on the first gap known from the profile alone; the user moves from
  // there. Later status changes never yank the view to a different step.
  const [view, setView] = React.useState<StepView>(() => {
    const first = computeAccountSetupStatus({ user, consent: null });
    return first.nextStep ?? "permissions";
  });
  const [skipping, setSkipping] = React.useState(false);
  const [resent, setResent] = React.useState(false);
  const [resendError, setResendError] = React.useState<string | null>(null);

  const stepIndex = view === "done" ? STEPS.length : STEPS.findIndex((step) => step.key === view);
  const goTo = (key: StepView) => {
    setView(key);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };
  const advance = () => goTo(stepIndex + 1 < STEPS.length ? STEPS[stepIndex + 1].key : "done");
  const back = () => goTo(STEPS[Math.max(0, stepIndex - 1)].key);

  async function skip() {
    if (skipping) return;
    setSkipping(true);
    try {
      await updatePersonalizedData({ onboarding_skipped: true });
      await onSaved();
    } catch {
      // A failed flag is not worth trapping the user here for.
    } finally {
      try { window.sessionStorage.setItem(ACCOUNT_SETUP_PROMPTED_KEY, "1"); } catch {}
      router.push("/dashboard");
    }
  }

  async function resend() {
    setResendError(null);
    try {
      await resendVerification(user.email);
      setResent(true);
    } catch (err) {
      setResendError(getSafeApiErrorMessage(err, lang));
    }
  }

  const blocked = Boolean(status?.blockers.includes("reaigen_access") || status?.blockers.includes("account_disabled"));

  return (
    <div className="mx-auto w-full max-w-[1120px] pb-12" data-testid="account-setup">
      <header className="mb-5 sm:mb-6">
        <h1 className="text-[26px] font-semibold leading-[1.08] tracking-[-0.03em] sm:text-[32px]">{t("setup.title", lang)}</h1>
        <p className="mt-2 max-w-[60ch] text-[14px] leading-relaxed text-muted-foreground">{t("setup.subtitle", lang)}</p>
      </header>

      {status && status.blockers.length > 0 ? (
        <div role="alert" className="mb-5 space-y-2 rounded-2xl border border-destructive/20 bg-destructive/[0.045] px-4 py-3.5" data-testid="setup-blockers">
          <p className="text-[13px] font-semibold text-destructive">{t("setup.blocker.title", lang)}</p>
          <ul className="space-y-1.5 text-[12px] leading-relaxed text-foreground/75">
            {status.blockers.map((blocker) => (
              <li key={blocker} className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span>{t(BLOCKER_LABELS[blocker], lang)}</span>
                {blocker === "email_verified" ? (
                  <button type="button" onClick={resend} className="font-semibold text-foreground underline underline-offset-4">
                    {resent ? t("setup.blocker.resent", lang) : t("setup.blocker.resend", lang)}
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
          {resendError ? <p className="text-[12px] text-destructive">{resendError}</p> : null}
        </div>
      ) : null}

      <div className="lg:grid lg:grid-cols-[264px_minmax(0,1fr)] lg:items-start lg:gap-6">
        <nav aria-label={t("setup.headerTitle", lang)} className="mb-4 lg:mb-0">
          <ol className="flex gap-2 overflow-x-auto pb-1 scrollbar-hide lg:flex-col lg:gap-1.5 lg:overflow-visible lg:pb-0" data-testid="setup-rail">
            {STEPS.map((step, index) => {
              const state = status?.steps.find((item) => item.key === step.key);
              const complete = Boolean(state?.complete);
              const current = view === step.key;
              const Icon = step.icon;
              return (
                <li key={step.key} className="shrink-0 lg:shrink">
                  <button
                    type="button"
                    onClick={() => goTo(step.key)}
                    aria-current={current ? "step" : undefined}
                    data-testid={`setup-rail-${step.key}`}
                    data-complete={complete ? "true" : "false"}
                    className={cn(
                      "flex w-full items-center gap-3 rounded-full border px-3 py-2 text-left transition-colors lg:rounded-2xl lg:px-3.5 lg:py-3",
                      current ? "border-foreground/15 bg-card shadow-control" : "border-transparent hover:bg-foreground/[0.035]",
                    )}
                  >
                    <span className={cn(
                      "flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[12px] font-semibold",
                      complete ? "bg-success/12 text-success" : current ? "bg-foreground text-background" : "bg-foreground/[0.06] text-foreground/60",
                    )}>
                      {complete ? <CheckIcon size={14} /> : index + 1}
                    </span>
                    <span className="min-w-0">
                      <span className="flex items-center gap-1.5 text-[13px] font-semibold text-foreground">
                        <Icon size={14} className="hidden text-foreground/45 lg:block" />
                        <span className="truncate">{t(step.label, lang)}</span>
                      </span>
                      <span className="hidden text-[11px] text-muted-foreground lg:block">
                        {complete
                          ? t("setup.status.done", lang)
                          : state && state.missing.length > 0
                            ? state.missing.map((key) => t(MISSING_LABELS[key], lang)).join(" · ")
                            : t(step.hint, lang)}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ol>
          {status ? (
            <p className="mt-3 hidden text-[12px] text-muted-foreground lg:block" data-testid="setup-progress">
              {status.completedCount} / {STEPS.length} {t("setup.stepsDone", lang)}
            </p>
          ) : null}
        </nav>

        <section className="detail-card-lg p-5 sm:p-6" data-testid="setup-panel">
          {view === "done" ? (
            <div className="flex flex-col items-center py-6 text-center" data-testid="setup-done">
              <span className="flex h-14 w-14 items-center justify-center rounded-full bg-success/12 text-success"><CheckIcon size={26} /></span>
              <h2 className="mt-5 text-[22px] font-semibold tracking-[-0.02em]">{t("setup.done.title", lang)}</h2>
              <p className="mt-2 max-w-[46ch] text-[14px] leading-relaxed text-muted-foreground">
                {status?.complete ? t("setup.done.subtitle", lang) : t("setup.done.subtitleIncomplete", lang)}
              </p>
              <div className="mt-6 flex flex-col gap-2 sm:flex-row">
                <Button asChild size="sm"><Link href="/dashboard">{t("setup.openDashboard", lang)}</Link></Button>
                <Button asChild variant="outline" size="sm"><Link href="/settings">{t("setup.editInSettings", lang)}</Link></Button>
              </div>
            </div>
          ) : (
            <>
              <div className="mb-5 flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-foreground/45">
                    {stepIndex + 1} / {STEPS.length}
                  </p>
                  <h2 className="mt-1 text-[19px] font-semibold tracking-[-0.02em]">{t(STEPS[stepIndex].label, lang)}</h2>
                  <p className="mt-1 text-[13px] text-muted-foreground">{t(STEPS[stepIndex].hint, lang)}</p>
                </div>
                <button type="button" onClick={skip} disabled={skipping} className="shrink-0 rounded-full px-3 py-1.5 text-[12px] font-medium text-foreground/55 transition-colors hover:bg-foreground/[0.04] hover:text-foreground disabled:opacity-50" data-testid="setup-skip">
                  {t("setup.skip", lang)}
                </button>
              </div>
              {view === "profile" ? <ProfileStep key="profile" user={user} lang={lang} onSaved={onSaved} onAdvance={advance} onBack={back} /> : null}
              {view === "seller" ? <SellerStep key="seller" user={user} lang={lang} onSaved={onSaved} onAdvance={advance} onBack={back} /> : null}
              {view === "billing" ? <BillingStep key="billing" user={user} lang={lang} onSaved={onSaved} onAdvance={advance} onBack={back} /> : null}
              {view === "permissions" ? (
                <PermissionsStep key="permissions" user={user} lang={lang} onSaved={onSaved} onAdvance={advance} onBack={back} signals={signals} refreshSignals={refresh} blocked={blocked} />
              ) : null}
            </>
          )}
        </section>
      </div>
    </div>
  );
}

/* ── Dashboard reminder ─────────────────────────────────────────────────── */

export function AccountSetupReminder({ user, lang, status }: { user: UserProfile; lang: string; status: AccountSetupStatus | null }) {
  if (!status || status.complete) return null;
  void user;
  return (
    <div className="floating-panel mb-4 flex flex-col gap-3 border-border/65 bg-card px-4 py-3.5 sm:flex-row sm:items-center" data-testid="account-setup-reminder">
      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-semibold">{t("setup.reminder.title", lang)}</p>
        <p className="mt-0.5 text-[12px] leading-relaxed text-foreground/65">
          {status.completedCount} / {STEPS.length} {t("setup.stepsDone", lang)} · {t("setup.reminder.body", lang)}
        </p>
      </div>
      <Button asChild size="sm" className="shrink-0">
        <Link href="/setup">{t("setup.reminder.action", lang)}</Link>
      </Button>
    </div>
  );
}
