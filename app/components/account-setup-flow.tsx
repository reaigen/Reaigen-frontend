"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "../lib/ui/button";
import { Checkbox } from "../lib/ui/checkbox";
import { FormField, focusFirstInvalidField, type FormControlState } from "../lib/ui/form-field";
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
import { countFormIssues, isEmailAddress, normalizeWebAddress } from "../lib/form-validation";
import { t } from "../lib/i18n";
import type { LocaleKey } from "../lib/locales";
import { formatPhoneDisplay, isPhoneCountry, isValidInternationalPhone } from "../lib/phone";
import { cn } from "../lib/utils";
import {
  computeAccountSetupStatus,
  type AccountSetupStatus,
  type SetupBlockerKey,
  type SetupMissingKey,
  type SetupStepKey,
} from "../lib/account-setup";
import { AgentIcon, CheckIcon, DeviceMobileIcon, EditIcon, PriceIcon } from "./icons";
import { CountrySelect } from "./country-select";
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
 * Composition follows Settings: one semantic application surface with a quiet
 * step rail on the left and the current step's form on the right (design
 * language: management pages cap reading width, a stable vertical section
 * rail on desktop). Phones get a connected, evenly centred stepper instead
 * of a clipped horizontal list. Steps are soft-rectangle rows, actions are
 * capsules, and fields keep their rounded-rectangle geometry.
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
function Field({
  id,
  label,
  optional,
  lang,
  hint,
  error,
  action,
  children,
}: {
  id: string;
  label: string;
  optional?: boolean;
  lang: string;
  hint?: string;
  error?: string | null;
  action?: React.ReactNode;
  children: (control: FormControlState) => React.ReactNode;
}) {
  return (
    <FormField
      id={id}
      label={label}
      optionalLabel={optional ? t("setup.optional", lang) : undefined}
      hint={hint}
      error={error}
      action={action}
    >
      {children}
    </FormField>
  );
}

function useTouchedFields<Key extends string>() {
  const [touched, setTouched] = React.useState<Set<Key>>(() => new Set());
  const touch = React.useCallback((key: Key) => {
    setTouched((current) => current.has(key) ? current : new Set(current).add(key));
  }, []);
  const touchAll = React.useCallback((keys: readonly Key[]) => {
    setTouched(new Set(keys));
  }, []);
  return { touched, touch, touchAll };
}

function requiredError(value: string, touched: boolean, lang: string): string | null {
  return touched && !value.trim() ? t("form.required", lang) : null;
}

function issueStatus(issueCount: number, lang: string): string {
  if (issueCount === 0) return t("setup.form.ready", lang);
  return `${issueCount} ${t(issueCount === 1 ? "setup.form.issue" : "setup.form.issues", lang)}`;
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
  validationStatus,
  ready,
}: {
  lang: string;
  canBack: boolean;
  onBack: () => void;
  saving: boolean;
  continueLabel?: string;
  disabled?: boolean;
  validationStatus?: string;
  ready?: boolean;
}) {
  return (
    <div className="mt-2 flex flex-col-reverse gap-2.5 border-t border-border/60 pt-5 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex min-h-9 min-w-0 flex-1 items-center justify-between gap-3 sm:min-h-11 sm:justify-start">
        {canBack ? (
          <Button type="button" variant="ghost" className="shrink-0" onClick={onBack} disabled={saving}>
            {t("setup.back", lang)}
          </Button>
        ) : null}
        {validationStatus ? (
          <p
            aria-live="polite"
            className={cn("min-w-0 text-[12px] font-medium", ready ? "text-success" : "text-muted-foreground")}
            data-testid="setup-validation-status"
          >
            {validationStatus}
          </p>
        ) : null}
      </div>
      <Button type="submit" className="w-full px-6 sm:w-auto" loading={saving} disabled={disabled} data-testid="setup-continue">
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
  const { touched, touch, touchAll } = useTouchedFields<"firstName" | "lastName" | "username">();
  const firstNameMissing = !firstName.trim();
  const lastNameMissing = !lastName.trim();
  const usernameMissing = !username.trim();
  const issueCount = countFormIssues([firstNameMissing, lastNameMissing, usernameMissing]);
  const canSubmit = issueCount === 0;

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (saving) return;
    if (!canSubmit) {
      touchAll(["firstName", "lastName", "username"]);
      focusFirstInvalidField([
        firstNameMissing && "setup-first-name",
        lastNameMissing && "setup-last-name",
        usernameMissing && "setup-username",
      ]);
      return;
    }
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
    <form className="space-y-6" onSubmit={handleSubmit} noValidate data-testid="setup-step-profile">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field id="setup-first-name" label={t("settings.profile.firstName", lang)} lang={lang} error={requiredError(firstName, touched.has("firstName"), lang)}>
          {(control) => <Input {...control} value={firstName} onChange={(e) => setFirstName(e.target.value)} onBlur={() => touch("firstName")} autoComplete="given-name" />}
        </Field>
        <Field id="setup-last-name" label={t("settings.profile.lastName", lang)} lang={lang} error={requiredError(lastName, touched.has("lastName"), lang)}>
          {(control) => <Input {...control} value={lastName} onChange={(e) => setLastName(e.target.value)} onBlur={() => touch("lastName")} autoComplete="family-name" />}
        </Field>
      </div>
      <Field id="setup-username" label={t("settings.profile.username", lang)} lang={lang} error={requiredError(username, touched.has("username"), lang)}>
        {(control) => <Input {...control} value={username} onChange={(e) => setUsername(e.target.value)} onBlur={() => touch("username")} autoComplete="username" />}
      </Field>
      <div className="space-y-1.5">
        <p className="text-[13px] font-medium leading-5 text-foreground/85">{t("settings.profile.email", lang)}</p>
        <div className="flex min-h-11 flex-wrap items-center justify-between gap-3 rounded-xl border border-border/55 bg-surface-subtle/75 px-4 py-2">
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
      <StepFooter
        lang={lang}
        canBack={false}
        onBack={() => {}}
        saving={saving}
        validationStatus={issueStatus(issueCount, lang)}
        ready={canSubmit}
      />
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
  const { touched, touch, touchAll } = useTouchedFields<"bio" | "website" | "city" | "country">();

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
  const bioMissing = !bio.trim();
  const cityMissing = !city.trim();
  const countryInvalid = !isPhoneCountry(country);
  const normalizedWebsite = normalizeWebAddress(website);
  const websiteInvalid = normalizedWebsite === null;
  const issueCount = countFormIssues([
    !phoneValid,
    bioMissing,
    cityMissing,
    countryInvalid,
    websiteInvalid,
  ]);
  const canSubmit = issueCount === 0;

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
      website: normalizedWebsite ?? website.trim(),
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

  async function savePhoneForOtp() {
    try {
      await updateSellerProfile({ phone: phone.trim() });
      setPhoneError(null);
      await onSaved();
    } catch (err) {
      if (!isPhoneConflict(err)) throw err;
      setPhoneError(t("setup.seller.phoneTaken", lang));
      throw PHONE_TAKEN;
    }
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (saving) return;
    if (!canSubmit) {
      setPhoneTouched(true);
      touchAll(["bio", "website", "city", "country"]);
      focusFirstInvalidField([
        !phoneValid && "setup-phone",
        bioMissing && "setup-bio",
        websiteInvalid && "setup-website",
        cityMissing && "setup-city",
        countryInvalid && "setup-country",
      ]);
      return;
    }
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
      if (!phoneMatchesSaved) await savePhoneForOtp();
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
    <form className="space-y-6" onSubmit={handleSubmit} noValidate data-testid="setup-step-seller">
      <div className="space-y-3">
        <Field
          id="setup-phone"
          label={t("settings.seller.phone", lang)}
          lang={lang}
          hint={t("setup.seller.phoneHint", lang)}
          error={phoneError ?? (phoneTouched && !phoneValid ? t("phone.invalid", lang) : null)}
        >
          {(control) => (
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <InternationalPhoneInput
                id={control.id}
                value={phone}
                onChange={(nextPhone) => { setPhone(nextPhone); if (phoneError) setPhoneError(null); }}
                onBlur={() => setPhoneTouched(true)}
                lang={lang}
                preferredCountry={country || p?.country}
                error={control.error}
                aria-describedby={control["aria-describedby"]}
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
          )}
        </Field>
        {otpSent ? (
          <div className="space-y-3 rounded-2xl border border-border/60 bg-surface-subtle/55 p-4 sm:p-5">
            <Label htmlFor="setup-phone-code" className="text-[13px] text-foreground/85">{t("setup.seller.codeSent", lang)} {phoneDisplay.display || phone.trim()}</Label>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <Input
                id="setup-phone-code"
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                placeholder={t("setup.seller.codePlaceholder", lang)}
                maxLength={6}
                inputMode="numeric"
                autoComplete="one-time-code"
                className="w-full text-center font-mono text-[15px] tracking-[0.24em] sm:max-w-[11rem]"
              />
              <Button type="button" className="w-full shrink-0 sm:w-auto" loading={otpBusy} disabled={code.length < 4} onClick={handleVerify}>
                {t("setup.seller.confirmCode", lang)}
              </Button>
            </div>
          </div>
        ) : null}
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field id="setup-company" label={t("settings.seller.company", lang)} optional lang={lang}>
          {(control) => <Input {...control} value={company} onChange={(e) => setCompany(e.target.value)} autoComplete="organization" />}
        </Field>
        <Field id="setup-job-title" label={t("settings.seller.jobTitle", lang)} optional lang={lang}>
          {(control) => <Input {...control} value={jobTitle} onChange={(e) => setJobTitle(e.target.value)} autoComplete="organization-title" />}
        </Field>
      </div>
      <Field id="setup-bio" label={t("settings.seller.bio", lang)} lang={lang} error={requiredError(bio, touched.has("bio"), lang)}>
        {(control) => <Textarea {...control} value={bio} onChange={(e) => setBio(e.target.value)} onBlur={() => touch("bio")} rows={3} placeholder={t("setup.seller.bioPlaceholder", lang)} />}
      </Field>
      <Field
        id="setup-website"
        label={t("settings.seller.website", lang)}
        optional
        lang={lang}
        hint={t("form.websiteHint", lang)}
        error={touched.has("website") && websiteInvalid ? t("form.invalidWebsite", lang) : null}
      >
        {(control) => (
          <Input
            {...control}
            value={website}
            onChange={(e) => setWebsite(e.target.value)}
            onBlur={() => {
              touch("website");
              if (normalizedWebsite !== null) setWebsite(normalizedWebsite);
            }}
            inputMode="url"
            autoComplete="url"
          />
        )}
      </Field>

      <Group title={t("settings.seller.sectionAddress", lang)}>
        <Field id="setup-address" label={t("settings.seller.address", lang)} optional lang={lang}>
          {(control) => <Input {...control} value={address} onChange={(e) => setAddress(e.target.value)} autoComplete="street-address" />}
        </Field>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field id="setup-city" label={t("settings.seller.city", lang)} lang={lang} error={requiredError(city, touched.has("city"), lang)}>
            {(control) => <Input {...control} value={city} onChange={(e) => setCity(e.target.value)} onBlur={() => touch("city")} autoComplete="address-level2" />}
          </Field>
          <Field id="setup-state" label={t("settings.seller.state", lang)} optional lang={lang}>
            {(control) => <Input {...control} value={state} onChange={(e) => setState(e.target.value)} autoComplete="address-level1" />}
          </Field>
          <Field id="setup-postal" label={t("settings.seller.postalCode", lang)} optional lang={lang}>
            {(control) => <Input {...control} value={postalCode} onChange={(e) => setPostalCode(e.target.value)} autoComplete="postal-code" />}
          </Field>
          <Field id="setup-country" label={t("settings.seller.country", lang)} lang={lang} error={touched.has("country") && countryInvalid ? t("form.required", lang) : null}>
            {(control) => (
              <CountrySelect
                id={control.id}
                value={country}
                onChange={(nextCountry) => { setCountry(nextCountry); touch("country"); }}
                lang={lang}
                error={control.error}
                aria-describedby={control["aria-describedby"]}
              />
            )}
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
              {(control) => <Input {...control} value={license} onChange={(e) => setLicense(e.target.value)} />}
            </Field>
            <Field id="setup-agency" label={t("settings.seller.agency", lang)} optional lang={lang}>
              {(control) => <Input {...control} value={agency} onChange={(e) => setAgency(e.target.value)} />}
            </Field>
          </div>
        ) : null}
      </div>

      {error ? <p role="alert" className="text-[12px] text-destructive">{error}</p> : null}
      <StepFooter
        lang={lang}
        canBack
        onBack={onBack}
        saving={saving}
        validationStatus={issueStatus(issueCount, lang)}
        ready={canSubmit}
      />
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
  const { touched, touch, touchAll } = useTouchedFields<"name" | "email" | "address" | "city" | "postal" | "country">();

  const sellerAddressAvailable = Boolean(p && (p.address || p.city || p.postal_code || p.country));
  const nameMissing = !billingName.trim();
  const emailInvalid = !billingEmail.trim() || !isEmailAddress(billingEmail);
  const addressMissing = !billingAddress.trim();
  const cityMissing = !billingCity.trim();
  const postalMissing = !billingPostal.trim();
  const countryInvalid = !isPhoneCountry(billingCountry);
  const issueCount = countFormIssues([
    nameMissing,
    emailInvalid,
    addressMissing,
    cityMissing,
    postalMissing,
    countryInvalid,
  ]);
  const canSubmit = issueCount === 0;

  function useSellerAddress() {
    if (!p) return;
    setBillingAddress(p.address ?? "");
    setBillingCity(p.city ?? "");
    setBillingPostal(p.postal_code ?? "");
    setBillingCountry((p.country ?? "").toUpperCase());
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (saving) return;
    if (!canSubmit) {
      touchAll(["name", "email", "address", "city", "postal", "country"]);
      focusFirstInvalidField([
        nameMissing && "setup-billing-name",
        emailInvalid && "setup-billing-email",
        addressMissing && "setup-billing-address",
        cityMissing && "setup-billing-city",
        postalMissing && "setup-billing-postal",
        countryInvalid && "setup-billing-country",
      ]);
      return;
    }
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
    <form className="space-y-6" onSubmit={handleSubmit} noValidate data-testid="setup-step-billing">
      {tier ? (
        <div className="flex min-h-11 items-center justify-between gap-4 rounded-xl border border-border/55 bg-surface-subtle/75 px-4 py-2 text-[13px]">
          <span className="text-muted-foreground">{t("settings.billing.plan", lang)}</span>
          <span className="flex items-center gap-2 font-medium">
            {tier.name}
            {ba?.subscription_status ? <StatusPill tone="neutral">{ba.subscription_status}</StatusPill> : null}
          </span>
        </div>
      ) : null}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field id="setup-billing-name" label={t("settings.billing.name", lang)} lang={lang} error={requiredError(billingName, touched.has("name"), lang)}>
          {(control) => <Input {...control} value={billingName} onChange={(e) => setBillingName(e.target.value)} onBlur={() => touch("name")} autoComplete="name" />}
        </Field>
        <Field
          id="setup-billing-email"
          label={t("settings.billing.email", lang)}
          lang={lang}
          error={touched.has("email")
            ? !billingEmail.trim()
              ? t("form.required", lang)
              : !isEmailAddress(billingEmail)
                ? t("form.invalidEmail", lang)
                : null
            : null}
        >
          {(control) => <Input {...control} value={billingEmail} onChange={(e) => setBillingEmail(e.target.value)} onBlur={() => touch("email")} type="email" autoComplete="email" />}
        </Field>
      </div>
      <Field
        id="setup-billing-address"
        label={t("settings.billing.address", lang)}
        lang={lang}
        error={requiredError(billingAddress, touched.has("address"), lang)}
        action={sellerAddressAvailable ? (
          <button type="button" onClick={useSellerAddress} className="text-[12px] font-medium text-foreground/60 underline underline-offset-4 transition-colors hover:text-foreground" data-testid="setup-billing-copy-address">
            {t("setup.billing.sameAsSeller", lang)}
          </button>
        ) : undefined}
      >
        {(control) => <Input {...control} value={billingAddress} onChange={(e) => setBillingAddress(e.target.value)} onBlur={() => touch("address")} autoComplete="street-address" />}
      </Field>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Field id="setup-billing-city" label={t("settings.billing.city", lang)} lang={lang} error={requiredError(billingCity, touched.has("city"), lang)}>
          {(control) => <Input {...control} value={billingCity} onChange={(e) => setBillingCity(e.target.value)} onBlur={() => touch("city")} autoComplete="address-level2" />}
        </Field>
        <Field id="setup-billing-postal" label={t("settings.billing.postalCode", lang)} lang={lang} error={requiredError(billingPostal, touched.has("postal"), lang)}>
          {(control) => <Input {...control} value={billingPostal} onChange={(e) => setBillingPostal(e.target.value)} onBlur={() => touch("postal")} autoComplete="postal-code" />}
        </Field>
        <Field id="setup-billing-country" label={t("settings.billing.country", lang)} lang={lang} error={touched.has("country") && countryInvalid ? t("form.required", lang) : null}>
          {(control) => (
            <CountrySelect
              id={control.id}
              value={billingCountry}
              onChange={(nextCountry) => { setBillingCountry(nextCountry); touch("country"); }}
              lang={lang}
              error={control.error}
              aria-describedby={control["aria-describedby"]}
            />
          )}
        </Field>
        <Field id="setup-billing-vat" label={t("settings.billing.vat", lang)} optional lang={lang}>
          {(control) => <Input {...control} value={vat} onChange={(e) => setVat(e.target.value)} />}
        </Field>
      </div>
      {error ? <p role="alert" className="text-[12px] text-destructive">{error}</p> : null}
      <StepFooter
        lang={lang}
        canBack
        onBack={onBack}
        saving={saving}
        validationStatus={issueStatus(issueCount, lang)}
        ready={canSubmit}
      />
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
    const previous = marketing;
    setMarketing(enabled);
    try {
      await updateAccountConsent({ marketing_consent: enabled });
    } catch (err) {
      setMarketing(previous);
      throw err;
    }
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
    <form className="space-y-6" onSubmit={handleSubmit} noValidate data-testid="setup-step-permissions">
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
              <Button type="button" loading={busy === "consent"} disabled={!acknowledged || busy !== null} onClick={enableAgent} data-testid="setup-enable-agent">
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
                disabled={!toolPermissions || busy !== null}
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
            control={<Switch aria-label={t("settings.reai.improvementPermission", lang)} checked={improvement.consented} disabled={busy !== null} onCheckedChange={toggleImprovement} />}
          />
        ) : null}

        <ControlRow
          title={t("settings.privacy.legal.marketingConsent", lang)}
          hint={t("settings.privacy.legal.marketingConsentHint", lang)}
          control={<Switch aria-label={t("settings.privacy.legal.marketingConsent", lang)} checked={marketing} disabled={busy !== null} onCheckedChange={toggleMarketing} />}
        />
      </div>

      {error ? <p role="alert" className="text-[12px] text-destructive">{error}</p> : null}
      <StepFooter lang={lang} canBack onBack={onBack} saving={busy === "finish"} continueLabel={t("setup.finish", lang)} disabled={busy !== null || (!ready && !blocked)} />
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
  const completionPercent = Math.round((completedCount / STEPS.length) * 100);

  const stepState = (key: SetupStepKey) => {
    const state = status?.steps.find((item) => item.key === key);
    return { complete: Boolean(state?.complete), missing: state?.missing ?? [] };
  };

  // Every indicator owns an exact square and line box. That keeps the number
  // or check optically centred instead of inheriting a nearby label's leading.
  // The current step wins over complete state when someone revisits a step.
  const Indicator = ({ stepKey, index, size = "md" }: { stepKey: SetupStepKey; index: number; size?: "sm" | "md" }) => {
    const { complete } = stepState(stepKey);
    const current = view === stepKey;
    return (
      <span
        aria-hidden="true"
        className={cn(
          "relative z-10 inline-flex shrink-0 items-center justify-center rounded-full border text-[11px] font-semibold leading-none tabular-nums transition-[background-color,border-color,color] duration-200",
          size === "md" ? "h-8 w-8" : "h-7 w-7",
          current
            ? "border-foreground bg-foreground text-background"
            : complete
              ? "border-success/20 bg-success/10 text-success"
              : "border-border/75 bg-card text-foreground/55",
        )}
      >
        {complete && !current ? <CheckIcon size={size === "md" ? 14 : 13} className="block" /> : index + 1}
      </span>
    );
  };

  const CurrentStepIcon = view === "done" ? CheckIcon : STEPS[Math.max(0, stepIndex)].icon;

  return (
    <div className="mx-auto w-full max-w-[1120px] pb-12" data-testid="account-setup">
      <header className="mb-5 sm:mb-6">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.09em] text-muted-foreground">
              {t("setup.headerTitle", lang)}
            </p>
            <h1
              className="text-balance text-[28px] font-normal leading-[1.08] tracking-[-0.025em] text-foreground sm:text-[32px]"
              style={{ fontFamily: "var(--font-brand), ui-serif, Georgia, serif" }}
            >
              {t("setup.title", lang)}
            </h1>
          </div>
          <span
            data-testid="setup-progress"
            className="mt-0.5 inline-flex h-8 shrink-0 items-center rounded-full border border-border/70 bg-card px-3 text-[11px] font-semibold tabular-nums text-foreground/65 shadow-control sm:mt-1 sm:text-[12px]"
          >
            {completedCount} / {STEPS.length}<span className="hidden sm:inline">&nbsp;{t("setup.stepsDone", lang)}</span>
          </span>
        </div>
        <p className="mt-2.5 max-w-[68ch] text-[13px] leading-relaxed text-muted-foreground sm:text-[14px]">
          {t("setup.subtitle", lang)}
        </p>
        <div aria-hidden="true" className="mt-4 h-1 overflow-hidden rounded-full bg-muted sm:mt-5">
          <span
            className="block h-full rounded-full bg-foreground transition-[width] duration-500"
            style={{ width: `${completionPercent}%` }}
          />
        </div>
      </header>

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

      {/* Phones: connected centres, equal columns, and full-width touch targets. */}
      <nav aria-label={t("setup.headerTitle", lang)} className="mb-4 lg:hidden">
        <ol className="grid grid-cols-4 rounded-[22px] border border-border/65 bg-card px-2 py-3 shadow-card">
          {STEPS.map((step, index) => {
            const { complete } = stepState(step.key);
            const current = view === step.key;
            return (
              <li key={step.key} className="relative min-w-0">
                {index < STEPS.length - 1 ? (
                  <span
                    aria-hidden="true"
                    className={cn(
                      "absolute left-1/2 top-[13px] h-px w-full",
                      complete ? "bg-success/25" : "bg-border/80",
                    )}
                  />
                ) : null}
                <button
                  type="button"
                  onClick={() => goTo(step.key)}
                  aria-current={current ? "step" : undefined}
                  data-testid={`setup-strip-${step.key}`}
                  data-complete={complete ? "true" : "false"}
                  className="relative flex min-h-[3.25rem] w-full flex-col items-center justify-start gap-1.5 rounded-xl px-1 text-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                >
                  <Indicator stepKey={step.key} index={index} size="sm" />
                  <span className="relative z-10 grid h-8 w-full place-items-center overflow-hidden text-center">
                    <span className={cn("line-clamp-2 text-[10.5px] leading-4 sm:text-[11px]", current ? "font-semibold text-foreground" : "font-medium text-foreground/55")}>
                      {t(step.label, lang)}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
      </nav>

      <div className="settings-surface w-full lg:grid lg:min-h-[38rem] lg:grid-cols-[276px_minmax(0,1fr)] lg:items-stretch lg:overflow-hidden lg:rounded-3xl lg:border lg:border-border/65 lg:bg-card lg:shadow-card">
        {/* Desktop: the stable vertical rail Settings uses, one row per step. */}
        <nav aria-label={t("setup.headerTitle", lang)} className="hidden lg:flex lg:flex-col lg:border-r lg:border-border/65 lg:bg-foreground/[0.015] lg:p-3">
          <ol className="flex flex-col gap-1.5" data-testid="setup-rail">
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
                      "flex min-h-[4.25rem] w-full items-center gap-3 rounded-2xl border px-3 py-2.5 text-left transition-[background-color,border-color] duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1",
                      current ? "border-foreground/[0.12] bg-card shadow-card" : "border-transparent hover:bg-foreground/[0.035]",
                    )}
                  >
                    <Indicator stepKey={step.key} index={index} />
                    <span className="min-w-0 flex-1">
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
          <div className="mt-auto px-3 pb-2 pt-6">
            <div className="mb-2 flex items-center justify-between text-[11px] font-medium tabular-nums text-muted-foreground">
              <span>{t("setup.stepsDone", lang)}</span>
              <span>{completedCount} / {STEPS.length}</span>
            </div>
            <div aria-hidden="true" className="h-1 overflow-hidden rounded-full bg-muted">
              <span className="block h-full rounded-full bg-foreground transition-[width] duration-500" style={{ width: `${completionPercent}%` }} />
            </div>
          </div>
        </nav>

        <section
          data-settings-card
          className="rounded-3xl border border-border/65 bg-card p-5 shadow-card sm:p-6 lg:p-8"
          data-testid="setup-panel"
        >
          {view === "done" ? (
            <div className="flex flex-col items-center py-8 text-center" data-testid="setup-done">
              <span className="flex h-14 w-14 items-center justify-center rounded-full border border-success/20 bg-success/10 text-success"><CheckIcon size={26} /></span>
              <h2 className="mt-5 text-[26px] font-normal leading-tight tracking-[-0.02em]" style={{ fontFamily: "var(--font-brand), ui-serif, Georgia, serif" }}>{t("setup.done.title", lang)}</h2>
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
              <div className="mb-6 flex flex-col gap-3 border-b border-border/60 pb-5 sm:flex-row sm:items-start sm:justify-between sm:gap-4 sm:pb-6">
                <div className="flex min-w-0 items-center gap-3.5">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-border/60 bg-surface-subtle/70 text-foreground/70 sm:h-11 sm:w-11">
                    <CurrentStepIcon size={18} className="block" />
                  </span>
                  <div className="min-w-0">
                    <p className="text-[11px] font-semibold uppercase leading-4 tracking-[0.08em] text-foreground/45 tabular-nums">
                      {t("setup.stepEyebrow", lang)} {stepIndex + 1} / {STEPS.length}
                    </p>
                    <h2 className="mt-0.5 text-[22px] font-normal leading-tight tracking-[-0.02em] sm:text-[24px]" style={{ fontFamily: "var(--font-brand), ui-serif, Georgia, serif" }}>{t(STEPS[stepIndex].label, lang)}</h2>
                    <p className="mt-0.5 line-clamp-2 text-[12px] leading-relaxed text-muted-foreground sm:text-[13px]">{t(STEPS[stepIndex].hint, lang)}</p>
                  </div>
                </div>
                <Button type="button" variant="ghost" size="sm" onClick={skip} disabled={skipping} className="h-9 shrink-0 self-end px-3 text-[12px] text-foreground/60 sm:self-auto" data-testid="setup-skip">
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
