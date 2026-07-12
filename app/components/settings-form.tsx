"use client";

import * as React from "react";
import { Button } from "../lib/ui/button";
import { Input } from "../lib/ui/input";
import { Label } from "../lib/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../lib/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../lib/ui/select";
import { Separator } from "../lib/ui/separator";
import { Switch } from "../lib/ui/switch";
import {
  updateProfile,
  updateSellerProfile,
  updateLocalization,
  updatePersonalizedData,
  changePassword,
  getAvailablePreferences,
  type UserProfile,
  type AvailablePreferences,
  type PreferenceOption,
} from "../lib/api/client";
import { getSafeApiErrorMessage } from "../lib/api/error-message";
import { t, getUserLanguage, formatDate as fmtDate } from "../lib/i18n";
import { cn } from "../lib/utils";
import { ManagedLegalDocuments } from "./content-documents";

function useAutoDismiss(value: boolean, setter: (v: boolean) => void, ms = 3000) {
  React.useEffect(() => {
    if (!value) return;
    const timer = setTimeout(() => setter(false), ms);
    return () => clearTimeout(timer);
  }, [value, setter, ms]);
}

function Card({ className, ...props }: React.HTMLAttributes<HTMLElement>) {
  return (
    <section
      className={cn("border-t border-border/70 pt-6 first:border-t-0 first:pt-0", className)}
      {...props}
    />
  );
}

function CardHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("pb-4", className)} {...props} />;
}

function CardTitle({ className, ...props }: React.HTMLAttributes<HTMLHeadingElement>) {
  return <h2 className={cn("text-[15px] font-semibold tracking-normal", className)} {...props} />;
}

function CardDescription({ className, ...props }: React.HTMLAttributes<HTMLParagraphElement>) {
  return <p className={cn("mt-1 text-[13px] leading-relaxed text-muted-foreground", className)} {...props} />;
}

function CardContent({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("max-w-2xl", className)} {...props} />;
}

function formatAccountDate(value: string | null | undefined, lang: string, dateFormat?: string | null) {
  if (!value) return t("common.notRecorded", lang);
  const result = fmtDate(value, dateFormat, lang);
  return result || t("common.notRecorded", lang);
}

function DataRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="grid grid-cols-1 gap-1 border-b border-border/60 py-3 last:border-b-0 sm:grid-cols-[12rem_minmax(0,1fr)] sm:gap-4">
      <dt className="text-[12px] text-muted-foreground">{label}</dt>
      <dd className="min-w-0 text-[13px] font-medium text-foreground/85">{value}</dd>
    </div>
  );
}

/* ── Profile Tab ─────────────────────────────────────────────────────── */

function ProfileTab({ user, onSaved, lang }: { user: UserProfile; onSaved: () => void; lang: string }) {
  const [firstName, setFirstName] = React.useState(user.first_name ?? "");
  const [lastName, setLastName] = React.useState(user.last_name ?? "");
  const [username, setUsername] = React.useState(user.username ?? "");
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [success, setSuccess] = React.useState(false);
  useAutoDismiss(success, setSuccess);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(false);
    try {
      setLoading(true);
      await updateProfile({ first_name: firstName.trim(), last_name: lastName.trim(), username: username.trim() });
      setSuccess(true);
      onSaved();
    } catch (err) {
      setError(getSafeApiErrorMessage(err, lang));
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("settings.profile.title", lang)}</CardTitle>
        <CardDescription>{t("settings.profile.subtitle", lang)}</CardDescription>
      </CardHeader>
      <CardContent>
        <form className="space-y-4" onSubmit={handleSubmit}>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="first-name">{t("settings.profile.firstName", lang)}</Label>
              <Input id="first-name" value={firstName} onChange={(e) => setFirstName(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="last-name">{t("settings.profile.lastName", lang)}</Label>
              <Input id="last-name" value={lastName} onChange={(e) => setLastName(e.target.value)} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="username">{t("settings.profile.username", lang)}</Label>
            <Input id="username" value={username} onChange={(e) => setUsername(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="email">{t("settings.profile.email", lang)}</Label>
            <Input id="email" value={user.email} disabled className="opacity-50 cursor-not-allowed" />
            <p className="text-[11px] text-muted-foreground">{t("settings.profile.emailHint", lang)}</p>
          </div>
          {error && <p className="text-[12px] text-destructive">{error}</p>}
          {success && <p className="text-[12px] text-emerald-600">{t("settings.profile.saved", lang)}</p>}
          <div className="pt-2">
            <Button type="submit" size="sm" loading={loading}>{t("settings.profile.save", lang)}</Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

/* ── Seller Profile Tab ──────────────────────────────────────────────── */

function SellerTab({ user, onSaved, lang }: { user: UserProfile; onSaved: () => void; lang: string }) {
  const p = user.profile ?? {} as Partial<NonNullable<typeof user.profile>>;
  const [phone, setPhone] = React.useState(p?.phone ?? "");
  const [company, setCompany] = React.useState(p?.company ?? "");
  const [website, setWebsite] = React.useState(p?.website ?? "");
  const [bio, setBio] = React.useState(p?.bio ?? "");
  const [jobTitle, setJobTitle] = React.useState(p?.job_title ?? "");
  const [linkedin, setLinkedin] = React.useState(p?.linkedin_url ?? "");
  const [twitter, setTwitter] = React.useState(p?.twitter_handle ?? "");
  const [instagram, setInstagram] = React.useState(p?.instagram_handle ?? "");
  const [isRePro, setIsRePro] = React.useState(p?.is_real_estate_professional ?? false);
  const [license, setLicense] = React.useState(p?.license_number ?? "");
  const [agency, setAgency] = React.useState(p?.agency_name ?? "");
  const [address, setAddress] = React.useState(p?.address ?? "");
  const [city, setCity] = React.useState(p?.city ?? "");
  const [state, setState] = React.useState(p?.state ?? "");
  const [country, setCountry] = React.useState(p?.country ?? "");
  const [postalCode, setPostalCode] = React.useState(p?.postal_code ?? "");
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [success, setSuccess] = React.useState(false);
  useAutoDismiss(success, setSuccess);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(false);
    try {
      setLoading(true);
      await updateSellerProfile({
        phone: phone.trim(),
        company: company.trim(),
        website: website.trim(),
        bio: bio.trim(),
        job_title: jobTitle.trim(),
        linkedin_url: linkedin.trim(),
        twitter_handle: twitter.trim(),
        instagram_handle: instagram.trim(),
        is_real_estate_professional: isRePro,
        license_number: license.trim(),
        agency_name: agency.trim(),
        address: address.trim(),
        city: city.trim(),
        state: state.trim(),
        country: country.trim(),
        postal_code: postalCode.trim(),
      });
      setSuccess(true);
      onSaved();
    } catch (err) {
      setError(getSafeApiErrorMessage(err, lang));
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("settings.seller.title", lang)}</CardTitle>
        <CardDescription>{t("settings.seller.subtitle", lang)}</CardDescription>
      </CardHeader>
      <CardContent>
        <form className="space-y-5" onSubmit={handleSubmit}>
          {/* Contact */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label>{t("settings.seller.phone", lang)}</Label>
              <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+421..." />
            </div>
            <div className="space-y-1.5">
              <Label>{t("settings.seller.company", lang)}</Label>
              <Input value={company} onChange={(e) => setCompany(e.target.value)} />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label>{t("settings.seller.jobTitle", lang)}</Label>
              <Input value={jobTitle} onChange={(e) => setJobTitle(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>{t("settings.seller.website", lang)}</Label>
              <Input value={website} onChange={(e) => setWebsite(e.target.value)} placeholder="https://..." />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>{t("settings.seller.bio", lang)}</Label>
            <textarea
              value={bio}
              onChange={(e) => setBio(e.target.value)}
              rows={3}
              className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
            />
          </div>

          <Separator />

          {/* Social */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="space-y-1.5">
              <Label>{t("settings.seller.linkedin", lang)}</Label>
              <Input value={linkedin} onChange={(e) => setLinkedin(e.target.value)} placeholder="https://linkedin.com/in/..." />
            </div>
            <div className="space-y-1.5">
              <Label>{t("settings.seller.twitter", lang)}</Label>
              <Input value={twitter} onChange={(e) => setTwitter(e.target.value)} placeholder="@handle" />
            </div>
            <div className="space-y-1.5">
              <Label>{t("settings.seller.instagram", lang)}</Label>
              <Input value={instagram} onChange={(e) => setInstagram(e.target.value)} placeholder="@handle" />
            </div>
          </div>

          <Separator />

          {/* RE Professional */}
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="text-sm font-medium">{t("settings.seller.reAgent", lang)}</p>
            </div>
            <Switch checked={isRePro} onCheckedChange={setIsRePro} />
          </div>

          {isRePro && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>{t("settings.seller.license", lang)}</Label>
                <Input value={license} onChange={(e) => setLicense(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>{t("settings.seller.agency", lang)}</Label>
                <Input value={agency} onChange={(e) => setAgency(e.target.value)} />
              </div>
            </div>
          )}

          <Separator />

          {/* Address */}
          <div className="space-y-1.5">
            <Label>{t("settings.seller.address", lang)}</Label>
            <Input value={address} onChange={(e) => setAddress(e.target.value)} />
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="space-y-1.5">
              <Label>{t("settings.seller.city", lang)}</Label>
              <Input value={city} onChange={(e) => setCity(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>{t("settings.seller.state", lang)}</Label>
              <Input value={state} onChange={(e) => setState(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>{t("settings.seller.country", lang)}</Label>
              <Input value={country} onChange={(e) => setCountry(e.target.value)} maxLength={2} placeholder="SK" />
            </div>
            <div className="space-y-1.5">
              <Label>{t("settings.seller.postalCode", lang)}</Label>
              <Input value={postalCode} onChange={(e) => setPostalCode(e.target.value)} />
            </div>
          </div>

          {error && <p className="text-[12px] text-destructive">{error}</p>}
          {success && <p className="text-[12px] text-emerald-600">{t("settings.seller.saved", lang)}</p>}
          <div className="pt-2">
            <Button type="submit" size="sm" loading={loading}>{t("settings.seller.save", lang)}</Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

/* ── Privacy Tab ─────────────────────────────────────────────────────── */

function PrivacyTab({ user, onSaved, lang }: { user: UserProfile; onSaved: () => void; lang: string }) {
  const p = user.profile ?? {} as Partial<NonNullable<typeof user.profile>>;
  const [isPublic, setIsPublic] = React.useState(p?.is_public ?? true);
  const [showEmail, setShowEmail] = React.useState(p?.show_email ?? false);
  const [showPhone, setShowPhone] = React.useState(p?.show_phone ?? false);
  const [allowContact, setAllowContact] = React.useState(p?.allow_contact ?? true);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [success, setSuccess] = React.useState(false);

  React.useEffect(() => {
    if (!isPublic) {
      setShowEmail(false);
      setShowPhone(false);
      setAllowContact(false);
    }
  }, [isPublic]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(false);
    try {
      setLoading(true);
      await updateSellerProfile({
        is_public: isPublic,
        show_email: isPublic ? showEmail : false,
        show_phone: isPublic ? showPhone : false,
        allow_contact: isPublic ? allowContact : false,
      });
      setSuccess(true);
      onSaved();
    } catch (err) {
      setError(getSafeApiErrorMessage(err, lang));
    } finally {
      setLoading(false);
    }
  }

  const visibleContactDetails = [showEmail, showPhone].filter(Boolean).length;
  const hasPublicContactDetails = isPublic && visibleContactDetails > 0;
  const statusLabel = !isPublic
    ? t("settings.privacy.statusPrivate", lang)
    : allowContact || hasPublicContactDetails
      ? t("settings.privacy.statusPublicContact", lang)
      : t("settings.privacy.statusPublicLimited", lang);
  const statusHint = !isPublic
    ? t("settings.privacy.statusPrivateHint", lang)
    : hasPublicContactDetails
      ? t("settings.privacy.statusPublicContactHint", lang)
      : t("settings.privacy.statusPublicLimitedHint", lang);

  const gdpr = user.gdpr;
  const licenseStatus = p?.is_real_estate_professional
    ? (p.license_number ? `${p.license_number}${p.agency_name ? ` · ${p.agency_name}` : ""}` : t("settings.privacy.legal.licenseEnabledMissing", lang))
    : t("settings.privacy.legal.notProfessional", lang);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>{t("settings.privacy.title", lang)}</CardTitle>
          <CardDescription>{t("settings.privacy.subtitle", lang)}</CardDescription>
        </CardHeader>
        <CardContent>
          <form className="space-y-4" onSubmit={handleSubmit} aria-describedby="privacy-status-summary">
          <div
            id="privacy-status-summary"
            role="status"
            aria-live="polite"
            className="rounded-lg border border-border bg-muted/25 px-4 py-3"
          >
            <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <p className="text-sm font-medium">{statusLabel}</p>
                <p className="text-[12px] text-muted-foreground mt-1 leading-relaxed">{statusHint}</p>
              </div>
              <span className="shrink-0 rounded-full bg-foreground/10 px-2.5 py-1 text-[11px] font-medium text-foreground/70">
                {isPublic ? t("settings.privacy.badgePublic", lang) : t("settings.privacy.badgePrivate", lang)}
              </span>
            </div>
          </div>

          <fieldset className="divide-y divide-border">
            <legend className="sr-only">{t("settings.privacy.title", lang)}</legend>
            <ToggleRow
              label={t("settings.privacy.publicProfile", lang)}
              hint={t("settings.privacy.publicProfileHint", lang)}
              checked={isPublic}
              onChange={setIsPublic}
            />
            <ToggleRow
              label={t("settings.privacy.showEmail", lang)}
              hint={isPublic ? t("settings.privacy.showEmailHint", lang) : t("settings.privacy.disabledByPrivate", lang)}
              checked={showEmail}
              onChange={setShowEmail}
              disabled={!isPublic}
            />
            <ToggleRow
              label={t("settings.privacy.showPhone", lang)}
              hint={isPublic ? t("settings.privacy.showPhoneHint", lang) : t("settings.privacy.disabledByPrivate", lang)}
              checked={showPhone}
              onChange={setShowPhone}
              disabled={!isPublic}
            />
            <ToggleRow
              label={t("settings.privacy.allowContact", lang)}
              hint={isPublic ? t("settings.privacy.allowContactHint", lang) : t("settings.privacy.disabledByPrivate", lang)}
              checked={allowContact}
              onChange={setAllowContact}
              disabled={!isPublic}
            />
          </fieldset>
          {hasPublicContactDetails && (
            <div className="rounded-lg border border-border bg-muted/25 px-3 py-2" role="note">
              <p className="text-[12px] text-muted-foreground">{t("settings.privacy.publicContactWarning", lang)}</p>
            </div>
          )}
          {error && <p className="text-[12px] text-destructive pt-3" role="alert">{error}</p>}
          {success && <p className="text-[12px] text-emerald-600 pt-3" role="status">{t("settings.privacy.saved", lang)}</p>}
            <div className="pt-1">
              <Button type="submit" size="sm" loading={loading}>{t("settings.privacy.save", lang)}</Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("settings.privacy.legal.title", lang)}</CardTitle>
          <CardDescription>
            {t("settings.privacy.legal.subtitle", lang)}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <dl className="rounded-lg border border-border/70 px-4">
            <DataRow
              label={t("settings.privacy.legal.dataProcessing", lang)}
              value={gdpr?.data_processing_consent ? t("common.allowed", lang) : t("common.notAllowed", lang)}
            />
            <DataRow
              label={t("settings.privacy.legal.gdprConsent", lang)}
              value={gdpr?.has_given_consent ? `${t("settings.privacy.legal.given", lang)} ${formatAccountDate(gdpr.consent_date, lang, user.localization?.date_format)}` : t("common.notRecorded", lang)}
            />
            <DataRow
              label={t("settings.privacy.legal.privacyVersion", lang)}
              value={gdpr?.consent_version || t("common.notRecorded", lang)}
            />
            <DataRow
              label={t("settings.privacy.legal.marketingConsent", lang)}
              value={gdpr?.marketing_consent ? t("common.allowed", lang) : t("common.notAllowed", lang)}
            />
            <DataRow
              label={t("settings.privacy.legal.terms", lang)}
              value={`${t("settings.privacy.legal.termsAcceptedOn", lang)} ${formatAccountDate(user.date_joined, lang, user.localization?.date_format)}`}
            />
            <DataRow
              label={t("settings.privacy.legal.license", lang)}
              value={licenseStatus}
            />
          </dl>
          <p className="mt-3 text-[12px] leading-relaxed text-muted-foreground">
            {t("settings.privacy.legal.hint", lang)}
          </p>
          <div className="mt-5">
            <ManagedLegalDocuments
              lang={lang}
              countryCode={p?.country}
              regionCode={p?.state}
              onAccepted={onSaved}
            />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

/* ── Notifications Tab ───────────────────────────────────────────────── */

function NotificationsTab({ user, onSaved, lang }: { user: UserProfile; onSaved: () => void; lang: string }) {
  const pd = user.personalized_data;
  const [enabled, setEnabled] = React.useState(pd?.notifications_enabled ?? true);
  const [email, setEmail] = React.useState(pd?.email_notifications ?? true);
  const [processing, setProcessing] = React.useState(pd?.notify_processing_complete ?? true);
  const [processingFailed, setProcessingFailed] = React.useState(pd?.notify_processing_failed ?? true);
  const [newFeatures, setNewFeatures] = React.useState(pd?.notify_new_features ?? true);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [success, setSuccess] = React.useState(false);
  useAutoDismiss(success, setSuccess);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(false);
    try {
      setLoading(true);
      await updatePersonalizedData({
        notifications_enabled: enabled,
        email_notifications: email,
        notify_processing_complete: processing,
        notify_processing_failed: processingFailed,
        notify_new_features: newFeatures,
      });
      setSuccess(true);
      onSaved();
    } catch (err) {
      setError(getSafeApiErrorMessage(err, lang));
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("settings.notifications.title", lang)}</CardTitle>
        <CardDescription>{t("settings.notifications.subtitle", lang)}</CardDescription>
      </CardHeader>
      <CardContent>
        <form className="space-y-1" onSubmit={handleSubmit}>
          <div className="divide-y divide-border">
            <ToggleRow
              label={t("settings.notifications.master", lang)}
              checked={enabled}
              onChange={setEnabled}
            />
            {enabled && (
              <>
                <ToggleRow
                  label={t("settings.notifications.email", lang)}
                  checked={email}
                  onChange={setEmail}
                />
                <ToggleRow
                  label={t("settings.notifications.processing", lang)}
                  checked={processing}
                  onChange={setProcessing}
                />
                <ToggleRow
                  label={t("settings.notifications.processingFailed", lang)}
                  checked={processingFailed}
                  onChange={setProcessingFailed}
                />
                <ToggleRow
                  label={t("settings.notifications.newFeatures", lang)}
                  checked={newFeatures}
                  onChange={setNewFeatures}
                />
              </>
            )}
          </div>
          {error && <p className="text-[12px] text-destructive pt-3">{error}</p>}
          {success && <p className="text-[12px] text-emerald-600 pt-3">{t("settings.notifications.saved", lang)}</p>}
          <div className="pt-4">
            <Button type="submit" size="sm" loading={loading}>{t("settings.notifications.save", lang)}</Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

/* ── Toggle Row (reusable) ───────────────────────────────────────────── */

function ToggleRow({ label, hint, checked, onChange, disabled = false }: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  const id = React.useId();
  const labelId = `${id}-label`;
  const hintId = hint ? `${id}-hint` : undefined;

  return (
    <div className={`flex items-start justify-between gap-4 py-3.5 ${disabled ? "opacity-60" : ""}`}>
      <div className="min-w-0 pr-2">
        <p id={labelId} className="text-sm font-medium">{label}</p>
        {hint && <p id={hintId} className="text-[11px] text-muted-foreground mt-0.5">{hint}</p>}
      </div>
      <Switch
        checked={checked}
        onCheckedChange={onChange}
        disabled={disabled}
        aria-labelledby={labelId}
        aria-describedby={hintId}
      />
    </div>
  );
}

/* ── Localization Tab ────────────────────────────────────────────────── */

const COMMON_TIMEZONES = [
  { code: "UTC", name: "UTC" },
  { code: "Europe/Bratislava", name: "Bratislava — Europe/Bratislava" },
  { code: "Europe/Prague", name: "Prague — Europe/Prague" },
  { code: "Europe/Vienna", name: "Vienna — Europe/Vienna" },
  { code: "Europe/Berlin", name: "Berlin — Europe/Berlin" },
  { code: "Europe/London", name: "London — Europe/London" },
  { code: "Europe/Paris", name: "Paris — Europe/Paris" },
  { code: "Europe/Warsaw", name: "Warsaw — Europe/Warsaw" },
  { code: "Europe/Budapest", name: "Budapest — Europe/Budapest" },
  { code: "America/New_York", name: "New York — America/New_York" },
  { code: "America/Los_Angeles", name: "Los Angeles — America/Los_Angeles" },
  { code: "Australia/Sydney", name: "Sydney — Australia/Sydney" },
];

function flattenUnits(grouped: { METRIC?: PreferenceOption[]; IMPERIAL?: PreferenceOption[] } | null | undefined): PreferenceOption[] {
  if (!grouped) return [];
  return [...(grouped.METRIC ?? []), ...(grouped.IMPERIAL ?? [])];
}

function optionName(options: PreferenceOption[], code: string): string {
  return options.find((option) => option.code === code)?.name ?? code;
}

function symbolFor(options: PreferenceOption[], code: string): string {
  return options.find((option) => option.code === code)?.symbol ?? code;
}

function stableOptionLabel(option: PreferenceOption): string {
  return option.symbol ? `${option.code} · ${option.name} (${option.symbol})` : `${option.code} · ${option.name}`;
}

function SettingsField({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      {children}
      {hint && <p className="text-[11px] leading-4 text-muted-foreground">{hint}</p>}
    </div>
  );
}

function LocalizationTab({ user, onSaved, lang }: { user: UserProfile; onSaved: () => void; lang: string }) {
  const loc = user.localization;
  const [language, setLanguage] = React.useState(loc?.language ?? "en");
  const [currency, setCurrency] = React.useState(loc?.currency ?? "EUR");
  const [areaUnit, setAreaUnit] = React.useState(loc?.area_unit ?? "SQM");
  const [distanceUnit, setDistanceUnit] = React.useState(loc?.distance_unit ?? "M");
  const [timezone, setTimezone] = React.useState(loc?.timezone ?? "UTC");
  const [dateFormat, setDateFormat] = React.useState(loc?.date_format ?? "EU");
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [success, setSuccess] = React.useState(false);
  const [prefs, setPrefs] = React.useState<AvailablePreferences | null>(null);

  React.useEffect(() => {
    getAvailablePreferences().then(setPrefs).catch(() => {});
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(false);
    try {
      setLoading(true);
      await updateLocalization({
        preferred_language: language,
        preferred_currency: currency,
        preferred_area_unit: areaUnit,
        preferred_distance_unit: distanceUnit,
        preferred_timezone: timezone,
        preferred_date_format_code: dateFormat,
      });
      // Localization changes affect all data (prices, units, language).
      // Full reload ensures every page fetches fresh data from the backend.
      window.location.reload();
    } catch (err) {
      setError(getSafeApiErrorMessage(err, lang));
    } finally {
      setLoading(false);
    }
  }

  const languages = prefs?.languages ?? [
    { code: "en", name: "English" },
    { code: "sk", name: "Slovencina" },
    { code: "cs", name: "Cestina" },
    { code: "de", name: "Deutsch" },
  ];
  const currencies = prefs?.currencies ?? [
    { code: "EUR", name: "Euro", symbol: "€" },
    { code: "USD", name: "US Dollar", symbol: "$" },
    { code: "CZK", name: "Czech Koruna", symbol: "Kč" },
    { code: "GBP", name: "British Pound", symbol: "£" },
  ];
  const areaUnits = prefs ? flattenUnits(prefs.area_units) : [
    { code: "SQM", name: "Square Meter", symbol: "m²" },
    { code: "SQFT", name: "Square Foot", symbol: "ft²" },
    { code: "HECTARE", name: "Hectare", symbol: "ha" },
    { code: "ACRE", name: "Acre", symbol: "ac" },
  ];
  const distanceUnits = prefs ? flattenUnits(prefs.distance_units) : [
    { code: "M", name: "Meter", symbol: "m" },
    { code: "KM", name: "Kilometer", symbol: "km" },
    { code: "FT", name: "Foot", symbol: "ft" },
    { code: "MI", name: "Mile", symbol: "mi" },
  ];
  const dateFormats = prefs?.date_formats ?? [
    { code: "EU", name: "EU (DD.MM.YYYY)" },
    { code: "US", name: "US (MM/DD/YYYY)" },
    { code: "ISO", name: "ISO 8601 (YYYY-MM-DD)" },
  ];
  const formattedDateSample = dateFormat === "US" ? "06/11/2026" : dateFormat === "ISO" ? "2026-06-11" : "11.06.2026";
  const formattedAreaSample = `82 ${symbolFor(areaUnits, areaUnit)}`;
  const formattedDistanceSample = `1.4 ${symbolFor(distanceUnits, distanceUnit)}`;

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("settings.localization.title", lang)}</CardTitle>
        <CardDescription>{t("settings.localization.subtitle", lang)}</CardDescription>
      </CardHeader>
      <CardContent>
        <form className="space-y-5" onSubmit={handleSubmit}>
          <div className="rounded-lg border border-border bg-muted/20 px-4 py-3">
            <p className="text-[13px] font-medium">{t("settings.localization.preview", lang)}</p>
            <div className="mt-2 grid grid-cols-1 gap-x-4 gap-y-1 text-[12px] sm:grid-cols-2">
              <p className="text-muted-foreground">{t("settings.localization.previewDate", lang)} <span className="font-medium text-foreground">{formattedDateSample}</span></p>
              <p className="text-muted-foreground">{t("settings.localization.previewCurrency", lang)} <span className="font-medium text-foreground">{currency}</span></p>
              <p className="text-muted-foreground">{t("settings.localization.previewArea", lang)} <span className="font-medium text-foreground">{formattedAreaSample}</span></p>
              <p className="text-muted-foreground">{t("settings.localization.previewDistance", lang)} <span className="font-medium text-foreground">{formattedDistanceSample}</span></p>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-x-4 gap-y-3 md:grid-cols-2">
            <SettingsField label={t("settings.localization.language", lang)} hint={optionName(languages, language)}>
              <Select value={language} onValueChange={setLanguage}>
                <SelectTrigger className="h-11 rounded-md shadow-none"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {languages.map((l) => (
                    <SelectItem key={l.code} value={l.code}>{stableOptionLabel(l)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </SettingsField>
            <SettingsField label={t("settings.localization.timezone", lang)} hint={timezone}>
              <Select value={timezone} onValueChange={setTimezone}>
                <SelectTrigger className="h-11 rounded-md shadow-none"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {COMMON_TIMEZONES.map((tz) => (
                    <SelectItem key={tz.code} value={tz.code}>{tz.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </SettingsField>
          </div>

          <Separator />

          <div className="grid grid-cols-1 gap-x-4 gap-y-3 md:grid-cols-2">
            <SettingsField label={t("settings.localization.currency", lang)} hint={optionName(currencies, currency)}>
              <Select value={currency} onValueChange={setCurrency}>
                <SelectTrigger className="h-11 rounded-md shadow-none"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {currencies.map((c) => (
                    <SelectItem key={c.code} value={c.code}>
                      {stableOptionLabel(c)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </SettingsField>
            <SettingsField label={t("settings.localization.dateFormat", lang)} hint={formattedDateSample}>
              <Select value={dateFormat} onValueChange={setDateFormat}>
                <SelectTrigger className="h-11 rounded-md shadow-none"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {dateFormats.map((d) => (
                    <SelectItem key={d.code} value={d.code}>{d.code} · {d.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </SettingsField>
          </div>

          <div className="grid grid-cols-1 gap-x-4 gap-y-3 md:grid-cols-2">
            <SettingsField label={t("settings.localization.areaUnit", lang)} hint={formattedAreaSample}>
              <Select value={areaUnit} onValueChange={setAreaUnit}>
                <SelectTrigger className="h-11 rounded-md shadow-none"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {areaUnits.map((u) => (
                    <SelectItem key={u.code} value={u.code}>
                      {stableOptionLabel(u)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </SettingsField>
            <SettingsField label={t("settings.localization.distanceUnit", lang)} hint={formattedDistanceSample}>
              <Select value={distanceUnit} onValueChange={setDistanceUnit}>
                <SelectTrigger className="h-11 rounded-md shadow-none"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {distanceUnits.map((u) => (
                    <SelectItem key={u.code} value={u.code}>
                      {stableOptionLabel(u)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </SettingsField>
          </div>

          {error && <p className="text-[12px] text-destructive">{error}</p>}
          {success && <p className="text-[12px] text-emerald-600">{t("settings.localization.saved", lang)}</p>}
          <div className="pt-2">
            <Button type="submit" size="sm" loading={loading}>{t("settings.localization.save", lang)}</Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

/* ── Security Tab ────────────────────────────────────────────────────── */

function SecurityTab({ lang }: { lang: string }) {
  const [currentPassword, setCurrentPassword] = React.useState("");
  const [newPassword, setNewPassword] = React.useState("");
  const [confirmPassword, setConfirmPassword] = React.useState("");
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [success, setSuccess] = React.useState(false);
  const canSubmit = currentPassword.length > 0 && newPassword.length >= 8 && newPassword === confirmPassword;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(false);
    if (!canSubmit) return;
    try {
      setLoading(true);
      await changePassword({ current_password: currentPassword, new_password: newPassword });
      setSuccess(true);
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    } catch (err) {
      setError(getSafeApiErrorMessage(err, lang));
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("settings.security.title", lang)}</CardTitle>
        <CardDescription>{t("settings.security.subtitle", lang)}</CardDescription>
      </CardHeader>
      <CardContent>
        <form className="space-y-4" onSubmit={handleSubmit}>
          <div className="space-y-1.5">
            <Label htmlFor="current-password">{t("settings.security.currentPassword", lang)}</Label>
            <Input id="current-password" type="password" value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)} autoComplete="current-password" />
          </div>
          <Separator />
          <div className="space-y-1.5">
            <Label htmlFor="new-password">{t("settings.security.newPassword", lang)}</Label>
            <Input id="new-password" type="password" value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)} autoComplete="new-password" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="confirm-new-password">{t("settings.security.confirmPassword", lang)}</Label>
            <Input id="confirm-new-password" type="password" value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)} autoComplete="new-password" />
          </div>
          {!canSubmit && confirmPassword.length > 0 && newPassword !== confirmPassword && (
            <p className="text-[11px] text-destructive">{t("settings.security.mismatch", lang)}</p>
          )}
          {error && <p className="text-[12px] text-destructive">{error}</p>}
          {success && <p className="text-[12px] text-emerald-600">{t("settings.security.saved", lang)}</p>}
          <div className="pt-2">
            <Button type="submit" size="sm" loading={loading} disabled={!canSubmit || loading}>{t("settings.security.save", lang)}</Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

/* ── Settings Form (main export) ─────────────────────────────────────── */

export function SettingsForm({ user, onSaved }: { user: UserProfile; onSaved: () => void }) {
  const lang = getUserLanguage(user.localization);
  const triggerClassName =
    "shrink-0 justify-start rounded-none border-b-2 border-transparent px-1.5 pb-3 pt-0 text-[13px] shadow-none data-[state=active]:border-foreground data-[state=active]:bg-transparent data-[state=active]:shadow-none";

  return (
    <Tabs defaultValue="profile" className="w-full">
      <TabsList className="mb-7 flex min-h-0 w-full gap-4 overflow-x-auto scroll-smooth rounded-none border-b border-border/70 bg-transparent p-0 text-muted-foreground [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
        <TabsTrigger value="profile" className={triggerClassName}>{t("settings.tab.profile", lang)}</TabsTrigger>
        <TabsTrigger value="seller" className={triggerClassName}>{t("settings.tab.seller", lang)}</TabsTrigger>
        <TabsTrigger value="privacy" className={triggerClassName}>{t("settings.tab.privacy", lang)}</TabsTrigger>
        <TabsTrigger value="localization" className={triggerClassName}>{t("settings.tab.localization", lang)}</TabsTrigger>
        <TabsTrigger value="notifications" className={triggerClassName}>{t("settings.tab.notifications", lang)}</TabsTrigger>
        <TabsTrigger value="security" className={triggerClassName}>{t("settings.tab.security", lang)}</TabsTrigger>
      </TabsList>
      <div className="min-w-0">
        <TabsContent value="profile" className="mt-0">
          <ProfileTab user={user} onSaved={onSaved} lang={lang} />
        </TabsContent>
        <TabsContent value="seller" className="mt-0">
          <SellerTab user={user} onSaved={onSaved} lang={lang} />
        </TabsContent>
        <TabsContent value="privacy" className="mt-0">
          <PrivacyTab user={user} onSaved={onSaved} lang={lang} />
        </TabsContent>
        <TabsContent value="localization" className="mt-0">
          <LocalizationTab user={user} onSaved={onSaved} lang={lang} />
        </TabsContent>
        <TabsContent value="notifications" className="mt-0">
          <NotificationsTab user={user} onSaved={onSaved} lang={lang} />
        </TabsContent>
        <TabsContent value="security" className="mt-0">
          <SecurityTab lang={lang} />
        </TabsContent>
      </div>
    </Tabs>
  );
}
