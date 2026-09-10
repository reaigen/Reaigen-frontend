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
import { getApiErrorJson, getSafeApiErrorMessage } from "../lib/api/error-message";
import { t } from "../lib/i18n";
import type { LocaleKey } from "../lib/locales";
import { formatPhoneDisplay, isValidInternationalPhone } from "../lib/phone";
import { cn } from "../lib/utils";
import {
  computeAccountSetupStatus,
  type AccountSetupStatus,
  type SetupBlockerKey,
  type SetupMissingKey,
  type SetupStepKey,
} from "../lib/account-setup";
import { AgentIcon, CheckIcon, DeviceMobileIcon, EditIcon, PriceIcon } from "./icons";
import { PageHeader } from "./page-header";
import { StatusPill } from "./status-pill";
import { useAccountSetup } from "./hooks/use-account-setup";
import { InternationalPhoneInput } from "./international-phone-input";

/**
 * Guided account setup — the four things a new creator still owes after the
 * sign-up form: profile, seller details, billing details, and the Agent
 * permissions. Each step saves through the same endpoints Settings uses, so
 * nothing here is a second source of truth; Settings stays the place to edit
 * later.
 *
 * Composition follows Settings: one white application surface with a quiet
 * step rail on the left and the current step's form on the right (design
 * language: management pages cap reading width, a stable vertical section
 * rail on desktop). Phones get a four-cell step strip instead of a clipped
 * horizontal list. Steps are soft-rectangle rows, actions are capsules,
 * fields keep their rounded-rectangle geometry.
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

/**
 * Most fields in a setup step are required, so the exception is what gets
 * labelled: an "Optional" tag on the right of the label row, never an
 * asterisk (the label language is 11–13px medium text, not punctuation).
 */
function Field({ id, label, optional, lang, children }: { id: string; label: string; optional?: boolean; lang: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-3">
        <Label htmlFor={id}>{label}</Label>
        {optional ? <span className="text-[11px] font-medium text-foreground/45">{t("setup.optional", lang)}</span> : null}
      </div>
      {children}
    </div>
  );
}

/** Section heading inside a step: a hairline above, a quiet label, no card. */
function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-4 border-t border-border/60 pt-5">
      <p className="text-[13px] font-semibold text-foreground/80">{title}</p>
      {children}
    </div>
  );
}

/** One row of the permissions list: text on the left, a control on the right. */
function ControlRow({ title, hint, control, children }: { title: string; hint?: string; control?: React.ReactNode; children?: React.ReactNode }) {
  return (
    <div className="py-4 first:pt-0 last:pb-0">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-[13px] font-semibold">{title}</p>
          {hint ? <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">{hint}</p> : null}
        </div>
        {control ? <div className="shrink-0">{control}</div> : null}
      </div>
      {children ? <div className="mt-3">{children}</div> : null}
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
    <div className="mt-2 flex flex-col-reverse gap-2 border-t border-border/60 pt-5 sm:flex-row sm:items-center sm:justify-between">
      <div>
        {canBack ? (
          <Button type="button" variant="ghost" className="w-full sm:w-auto" onClick={onBack} disabled={saving}>
            {t("setup.back", lang)}
          </Button>
        ) : null}
      </div>
      <Button type="submit" className="w-full sm:w-auto" loading={saving} disabled={disabled} data-testid="setup-continue">
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
        <Field id="setup-first-name" label={t("settings.profile.firstName", lang)} lang={lang}>
          <Input id="setup-first-name" value={firstName} onChange={(e) => setFirstName(e.target.value)} autoComplete="given-name" />
        </Field>
        <Field id="setup-last-name" label={t("settings.profile.lastName", lang)} lang={lang}>
          <Input id="setup-last-name" value={lastName} onChange={(e) => setLastName(e.target.value)} autoComplete="family-name" />
        </Field>
      </div>
      <Field id="setup-username" label={t("settings.profile.username", lang)} lang={lang}>
        <Input id="setup-username" value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" />
      </Field>
      <div className="space-y-1.5">
        <Label>{t("settings.profile.email", lang)}</Label>
        <div className="flex min-h-11 flex-wrap items-center justify-between gap-3 rounded-xl border border-border/55 bg-surface-subtle px-3.5 py-2">
          <span className="min-w-0 truncate text-[14px] text-foreground/85">{user.email}</span>
          {user.email_verified ? (
            <StatusPill tone="success" dot>{t("settings.profile.emailVerified", lang)}</StatusPill>
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
  // Phone uniqueness is a backend policy switch. If it is enabled later, a
  // taken number must not sink the whole step: the other fields still save,
  // the phone field carries the explanation, and the user can change it.
  const [phoneError, setPhoneError] = React.useState<string | null>(null);
  const [phoneTouched, setPhoneTouched] = React.useState(false);

  // Phone verification. The OTP is sent to the number on the saved profile,
  // so a freshly typed number is saved first and verified second.
  const savedPhone = (p?.phone ?? "").trim();
  const phoneVerified = Boolean(savedPhone) && Boolean(user.phone_verified || p?.phone_verified);
  const phoneMatchesSaved = phone.trim() === savedPhone && savedPhone.length > 0;
  const [otpSent, setOtpSent] = React.useState(false);
  const [code, setCode] = React.useState("");
  const [otpBusy, setOtpBusy] = React.useState(false);
  const phoneDisplay = formatPhoneDisplay(savedPhone);

  const phoneValid = isValidInternationalPhone(phone);
  const phoneInvalid = phone.trim().length > 0 && !phoneValid;
  const canSubmit = phoneValid && bio.trim().length > 0 && city.trim().length > 0 && country.trim().length > 0;

  const PHONE_TAKEN = Symbol("phone-taken");

  function isPhoneConflict(err: unknown): boolean {
    const payload = getApiErrorJson(err);
    if (payload && "phone" in payload) return true;
    const text = (payload ? JSON.stringify(payload) : err instanceof Error ? err.message : "").toLowerCase();
    return text.includes("phone") && (text.includes("exist") || text.includes("taken") || text.includes("already"));
  }

  async function save() {
    const fields = {
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
    };
    try {
      await updateSellerProfile({ phone: phone.trim(), ...fields });
      setPhoneError(null);
    } catch (err) {
      if (!isPhoneConflict(err)) throw err;
      // Keep everything else; only the number is refused.
      await updateSellerProfile(fields);
      setPhoneError(t("setup.seller.phoneTaken", lang));
      await onSaved();
      throw PHONE_TAKEN;
    }
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
      if (err !== PHONE_TAKEN) setError(getSafeApiErrorMessage(err, lang));
    } finally {
      setSaving(false);
    }
  }

  async function handleRequestOtp() {
    setPhoneTouched(true);
    if (!phoneValid) return;
    setError(null);
    setOtpBusy(true);
    try {
      if (!phoneMatchesSaved) await save();
      await requestPhoneLinkOtp(phone.trim());
      setOtpSent(true);
    } catch (err) {
      if (err !== PHONE_TAKEN) setError(getSafeApiErrorMessage(err, lang));
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
        <Label htmlFor="setup-phone">{t("settings.seller.phone", lang)}</Label>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <InternationalPhoneInput
            id="setup-phone"
            value={phone}
            onChange={(nextPhone) => { setPhone(nextPhone); if (phoneError) setPhoneError(null); }}
            onBlur={() => setPhoneTouched(true)}
            lang={lang}
            preferredCountry={country || p?.country}
            error={Boolean(phoneError) || (phoneTouched && phoneInvalid)}
            aria-describedby={(phoneError || (phoneTouched && phoneInvalid)) ? "setup-phone-error" : "setup-phone-hint"}
            className="sm:max-w-[22rem]"
          />
          {phoneVerified && phoneMatchesSaved ? (
            <StatusPill tone="success" dot className="self-start sm:self-auto">{t("setup.seller.phoneVerified", lang)}</StatusPill>
          ) : phone.trim().length > 0 && !otpSent ? (
            <Button type="button" variant="outline" className="shrink-0" loading={otpBusy} disabled={!phoneValid} onClick={handleRequestOtp} data-testid="setup-verify-phone">
              {t("setup.seller.verifyPhone", lang)}
            </Button>
          ) : null}
        </div>
        {phoneError ? (
          <p id="setup-phone-error" role="alert" className="text-[12px] leading-relaxed text-destructive" data-testid="setup-phone-error">{phoneError}</p>
        ) : phoneTouched && phoneInvalid ? (
          <p id="setup-phone-error" role="alert" className="text-[12px] leading-relaxed text-destructive">{t("phone.invalid", lang)}</p>
        ) : (
          <p id="setup-phone-hint" className="text-[12px] text-muted-foreground">{t("setup.seller.phoneHint", lang)}</p>
        )}
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
              <Button type="button" className="shrink-0" loading={otpBusy} disabled={code.length < 4} onClick={handleVerify}>
                {t("setup.seller.confirmCode", lang)}
              </Button>
            </div>
          </div>
        ) : null}
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field id="setup-company" label={t("settings.seller.company", lang)} optional lang={lang}>
          <Input id="setup-company" value={company} onChange={(e) => setCompany(e.target.value)} autoComplete="organization" />
        </Field>
        <Field id="setup-job-title" label={t("settings.seller.jobTitle", lang)} optional lang={lang}>
          <Input id="setup-job-title" value={jobTitle} onChange={(e) => setJobTitle(e.target.value)} autoComplete="organization-title" />
        </Field>
      </div>
      <Field id="setup-bio" label={t("settings.seller.bio", lang)} lang={lang}>
        <Textarea id="setup-bio" value={bio} onChange={(e) => setBio(e.target.value)} rows={3} placeholder={t("setup.seller.bioPlaceholder", lang)} />
      </Field>
      <Field id="setup-website" label={t("settings.seller.website", lang)} optional lang={lang}>
        <Input id="setup-website" value={website} onChange={(e) => setWebsite(e.target.value)} placeholder="https://www.example.com" inputMode="url" autoComplete="url" />
      </Field>

      <Group title={t("settings.seller.sectionAddress", lang)}>
        <Field id="setup-address" label={t("settings.seller.address", lang)} optional lang={lang}>
          <Input id="setup-address" value={address} onChange={(e) => setAddress(e.target.value)} autoComplete="street-address" />
        </Field>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field id="setup-city" label={t("settings.seller.city", lang)} lang={lang}>
            <Input id="setup-city" value={city} onChange={(e) => setCity(e.target.value)} autoComplete="address-level2" />
          </Field>
          <Field id="setup-state" label={t("settings.seller.state", lang)} optional lang={lang}>
            <Input id="setup-state" value={state} onChange={(e) => setState(e.target.value)} autoComplete="address-level1" />
          </Field>
          <Field id="setup-postal" label={t("settings.seller.postalCode", lang)} optional lang={lang}>
            <Input id="setup-postal" value={postalCode} onChange={(e) => setPostalCode(e.target.value)} autoComplete="postal-code" />
          </Field>
          <Field id="setup-country" label={t("settings.seller.country", lang)} lang={lang}>
            <Input id="setup-country" value={country} onChange={(e) => setCountry(e.target.value.toUpperCase())} maxLength={2} placeholder="SK" autoComplete="country" />
          </Field>
        </div>
      </Group>

      <div className="border-t border-border/60 pt-5">
        <div className="flex items-start justify-between gap-4">
          <p className="text-[13px] font-semibold text-foreground/80">{t("settings.seller.reAgent", lang)}</p>
          <Switch aria-label={t("settings.seller.reAgent", lang)} checked={isRePro} onCheckedChange={setIsRePro} />
        </div>
        {isRePro ? (
          <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field id="setup-license" label={t("settings.seller.license", lang)} optional lang={lang}>
              <Input id="setup-license" value={license} onChange={(e) => setLicense(e.target.value)} />
            </Field>
            <Field id="setup-agency" label={t("settings.seller.agency", lang)} optional lang={lang}>
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
        <div className="flex min-h-11 items-center justify-between gap-4 rounded-xl border border-border/55 bg-surface-subtle px-3.5 py-2 text-[13px]">
          <span className="text-muted-foreground">{t("settings.billing.plan", lang)}</span>
          <span className="flex items-center gap-2 font-medium">
            {tier.name}
            {ba?.subscription_status ? <StatusPill tone="neutral">{ba.subscription_status}</StatusPill> : null}
          </span>
        </div>
      ) : null}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field id="setup-billing-name" label={t("settings.billing.name", lang)} lang={lang}>
          <Input id="setup-billing-name" value={billingName} onChange={(e) => setBillingName(e.target.value)} autoComplete="name" />
        </Field>
        <Field id="setup-billing-email" label={t("settings.billing.email", lang)} lang={lang}>
          <Input id="setup-billing-email" value={billingEmail} onChange={(e) => setBillingEmail(e.target.value)} type="email" autoComplete="email" />
        </Field>
      </div>
      <div className="space-y-1.5">
        <div className="flex items-baseline justify-between gap-3">
          <Label htmlFor="setup-billing-address">{t("settings.billing.address", lang)}</Label>
          {sellerAddressAvailable ? (
            <button type="button" onClick={useSellerAddress} className="text-[12px] font-medium text-foreground/60 underline underline-offset-4 transition-colors hover:text-foreground" data-testid="setup-billing-copy-address">
              {t("setup.billing.sameAsSeller", lang)}
            </button>
          ) : null}
        </div>
        <Input id="setup-billing-address" value={billingAddress} onChange={(e) => setBillingAddress(e.target.value)} autoComplete="street-address" />
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Field id="setup-billing-city" label={t("settings.billing.city", lang)} lang={lang}>
          <Input id="setup-billing-city" value={billingCity} onChange={(e) => setBillingCity(e.target.value)} autoComplete="address-level2" />
        </Field>
        <Field id="setup-billing-postal" label={t("settings.billing.postalCode", lang)} lang={lang}>
          <Input id="setup-billing-postal" value={billingPostal} onChange={(e) => setBillingPostal(e.target.value)} autoComplete="postal-code" />
        </Field>
        <Field id="setup-billing-country" label={t("settings.billing.country", lang)} lang={lang}>
          <Input id="setup-billing-country" value={billingCountry} onChange={(e) => setBillingCountry(e.target.value.toUpperCase())} maxLength={2} placeholder="SK" autoComplete="country" />
        </Field>
        <Field id="setup-billing-vat" label={t("settings.billing.vat", lang)} optional lang={lang}>
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
      <div className="divide-y divide-border/60">
        <ControlRow
          title={t("settings.reai.access", lang)}
          hint={consented ? t("settings.reai.accessEnabled", lang) : t("settings.reai.accessDisabled", lang)}
          control={
            <StatusPill tone={consented ? "success" : "neutral"} dot>
              {consented ? t("common.allowed", lang) : t("common.notAllowed", lang)}
            </StatusPill>
          }
        >
          {blocked ? (
            <p className="rounded-xl bg-muted/25 p-4 text-[12px] leading-relaxed text-foreground/70">{t("setup.blocker.reaigen_access", lang)}</p>
          ) : consent === null ? (
            <p className="text-[12px] text-muted-foreground">{t("common.loading", lang)}</p>
          ) : consented ? null : (
            <div className="space-y-3">
              <div className="rounded-xl bg-muted/25 p-4 text-[12px] leading-relaxed text-foreground/70">
                <p>{t("reai.consentData", lang)}</p>
                <p className="mt-1.5">{t("reai.consentNoData", lang)}</p>
                <p className="mt-1.5">{t("reai.consentStorage", lang)}</p>
                <p className="mt-1.5">{t("reai.consentMedia", lang)}</p>
              </div>
              <label className="flex cursor-pointer items-start gap-2.5 text-[12px] leading-relaxed text-foreground/75">
                <Checkbox checked={acknowledged} onCheckedChange={(checked) => setAcknowledged(checked === true)} className="mt-0.5" data-testid="setup-consent-ack" />
                <span>{t("reai.consentLabel", lang)} · v{consentKnown ? consent.policy_version : ""}</span>
              </label>
              <Button type="button" loading={busy === "consent"} disabled={!acknowledged} onClick={enableAgent} data-testid="setup-enable-agent">
                {t("reai.enable", lang)}
              </Button>
            </div>
          )}
        </ControlRow>

        {consented ? (
          <ControlRow
            title={t("settings.reai.allTools", lang)}
            hint={t("settings.reai.allToolsHelp", lang)}
            control={
              <Switch
                aria-label={t("settings.reai.allTools", lang)}
                checked={Boolean(toolPermissions?.allow_all_tools)}
                disabled={!toolPermissions || busy === "tools"}
                onCheckedChange={setAllTools}
                data-testid="setup-all-tools"
              />
            }
          >
            {toolPermissions && !anyTool ? (
              <p className="text-[12px] text-foreground/65">{t("setup.permissions.noTools", lang)}</p>
            ) : (
              <p className="text-[12px] leading-relaxed text-muted-foreground">{t("settings.reai.toolsConfirmation", lang)}</p>
            )}
          </ControlRow>
        ) : null}

        {consented && improvement ? (
          <ControlRow
            title={t("settings.reai.improvementPermission", lang)}
            hint={t("settings.reai.improvementSubtitle", lang)}
            control={<Switch aria-label={t("settings.reai.improvementPermission", lang)} checked={improvement.consented} disabled={busy === "improvement"} onCheckedChange={toggleImprovement} />}
          />
        ) : null}

        <ControlRow
          title={t("settings.privacy.legal.marketingConsent", lang)}
          hint={t("settings.privacy.legal.marketingConsentHint", lang)}
          control={<Switch aria-label={t("settings.privacy.legal.marketingConsent", lang)} checked={marketing} disabled={busy === "marketing"} onCheckedChange={toggleMarketing} />}
        />
      </div>

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
  const completedCount = status?.completedCount ?? 0;
  const progressText = `${completedCount} / ${STEPS.length} ${t("setup.stepsDone", lang)}`;

  const stepState = (key: SetupStepKey) => {
    const state = status?.steps.find((item) => item.key === key);
    return { complete: Boolean(state?.complete), missing: state?.missing ?? [] };
  };

  // The rail indicator: check when done, the step number otherwise. Current
  // step is the one dark circle on the page; done steps use the semantic
  // green as a small status mark, never as a fill.
  const Indicator = ({ stepKey, index, size = "md" }: { stepKey: SetupStepKey; index: number; size?: "sm" | "md" }) => {
    const { complete } = stepState(stepKey);
    const current = view === stepKey;
    return (
      <span
        aria-hidden="true"
        className={cn(
          "flex shrink-0 items-center justify-center rounded-full text-[11px] font-semibold tabular-nums transition-colors duration-200",
          size === "md" ? "h-7 w-7" : "h-6 w-6",
          complete ? "bg-success/12 text-success" : current ? "bg-foreground text-background" : "bg-muted text-foreground/55",
        )}
      >
        {complete ? <CheckIcon size={size === "md" ? 13 : 12} /> : index + 1}
      </span>
    );
  };

  return (
    <div className="mx-auto w-full max-w-[1120px] pb-12" data-testid="account-setup">
      <PageHeader
        title={t("setup.title", lang)}
        meta={<span data-testid="setup-progress">{progressText}</span>}
        description={t("setup.subtitle", lang)}
        className="mb-4 sm:mb-5"
      />

      {status && status.blockers.length > 0 ? (
        <div role="alert" className="mb-4 space-y-2 rounded-2xl border border-destructive/20 bg-destructive/[0.045] px-4 py-3.5 sm:mb-5" data-testid="setup-blockers">
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

      {/* Phones: one four-cell strip, every cell a touch target. */}
      <nav aria-label={t("setup.headerTitle", lang)} className="mb-4 lg:hidden">
        <ol className="grid grid-cols-4 gap-1 rounded-2xl border border-border/65 bg-card p-1 shadow-card">
          {STEPS.map((step, index) => {
            const current = view === step.key;
            return (
              <li key={step.key} className="min-w-0">
                <button
                  type="button"
                  onClick={() => goTo(step.key)}
                  aria-current={current ? "step" : undefined}
                  data-testid={`setup-strip-${step.key}`}
                  className={cn(
                    "flex min-h-11 w-full flex-col items-center justify-center gap-1 rounded-xl px-1 py-1.5 transition-colors duration-200",
                    current ? "bg-muted/70" : "hover:bg-foreground/[0.035]",
                  )}
                >
                  <Indicator stepKey={step.key} index={index} size="sm" />
                  <span className={cn("w-full truncate text-center text-[11px] font-medium", current ? "text-foreground" : "text-foreground/60")}>
                    {t(step.label, lang)}
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
      </nav>

      <div className="settings-surface w-full lg:grid lg:grid-cols-[264px_minmax(0,1fr)] lg:items-stretch lg:overflow-hidden lg:rounded-3xl lg:border lg:border-border/65 lg:bg-card lg:shadow-card">
        {/* Desktop: the stable vertical rail Settings uses, one row per step. */}
        <nav aria-label={t("setup.headerTitle", lang)} className="hidden lg:flex lg:flex-col lg:border-r lg:border-border/65 lg:p-3">
          <ol className="flex flex-col gap-1" data-testid="setup-rail">
            {STEPS.map((step, index) => {
              const { complete, missing } = stepState(step.key);
              const current = view === step.key;
              return (
                <li key={step.key}>
                  <button
                    type="button"
                    onClick={() => goTo(step.key)}
                    aria-current={current ? "step" : undefined}
                    data-testid={`setup-rail-${step.key}`}
                    data-complete={complete ? "true" : "false"}
                    className={cn(
                      "flex w-full items-start gap-3 rounded-2xl border px-3 py-2.5 text-left transition-[background-color,border-color] duration-200",
                      current ? "border-foreground/15 bg-muted/70" : "border-transparent hover:bg-foreground/[0.035]",
                    )}
                  >
                    <Indicator stepKey={step.key} index={index} />
                    <span className="min-w-0 pt-0.5">
                      <span className={cn("block truncate text-[13px] font-semibold", current ? "text-foreground" : "text-foreground/80")}>{t(step.label, lang)}</span>
                      <span className="mt-0.5 line-clamp-2 text-[11px] leading-snug text-muted-foreground">
                        {complete
                          ? t("setup.status.done", lang)
                          : missing.length > 0
                            ? missing.map((key) => t(MISSING_LABELS[key], lang)).join(" · ")
                            : t(step.hint, lang)}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ol>
        </nav>

        <section
          data-settings-card
          className="rounded-2xl border border-border/65 bg-card p-4 shadow-card sm:p-5 lg:p-6"
          data-testid="setup-panel"
        >
          {view === "done" ? (
            <div className="flex flex-col items-center py-8 text-center" data-testid="setup-done">
              <span className="flex h-14 w-14 items-center justify-center rounded-full bg-success/12 text-success"><CheckIcon size={26} /></span>
              <h2 className="mt-5 text-[22px] font-semibold tracking-[-0.02em]">{t("setup.done.title", lang)}</h2>
              <p className="mt-2 max-w-[46ch] text-[14px] leading-relaxed text-muted-foreground">
                {status?.complete ? t("setup.done.subtitle", lang) : t("setup.done.subtitleIncomplete", lang)}
              </p>
              <div className="mt-6 flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
                <Button asChild className="w-full sm:w-auto"><Link href="/dashboard">{t("setup.openDashboard", lang)}</Link></Button>
                <Button asChild variant="outline" className="w-full sm:w-auto"><Link href="/settings">{t("setup.editInSettings", lang)}</Link></Button>
              </div>
            </div>
          ) : (
            <>
              <div className="mb-5 flex items-start justify-between gap-4 border-b border-border/60 pb-5">
                <div className="min-w-0">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-foreground/45 tabular-nums">
                    {t("setup.stepEyebrow", lang)} {stepIndex + 1} / {STEPS.length}
                  </p>
                  <h2 className="mt-1 text-[18px] font-semibold tracking-[-0.02em]">{t(STEPS[stepIndex].label, lang)}</h2>
                  <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">{t(STEPS[stepIndex].hint, lang)}</p>
                </div>
                <Button type="button" variant="ghost" size="sm" onClick={skip} disabled={skipping} className="shrink-0 text-foreground/60 max-lg:h-11" data-testid="setup-skip">
                  {t("setup.skip", lang)}
                </Button>
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
