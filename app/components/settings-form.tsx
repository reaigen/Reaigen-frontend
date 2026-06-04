"use client";

import * as React from "react";
import { Button } from "../lib/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "../lib/ui/card";
import { Input } from "../lib/ui/input";
import { Label } from "../lib/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../lib/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../lib/ui/select";
import { Separator } from "../lib/ui/separator";
import { Switch } from "../lib/ui/switch";
import {
  ApiError,
  updateProfile,
  updateSellerProfile,
  updateLocalization,
  updatePersonalizedData,
  updateBilling,
  changePassword,
  getAvailablePreferences,
  type UserProfile,
  type AvailablePreferences,
  type PreferenceOption,
} from "../lib/api/client";
import { t, getUserLanguage } from "../lib/i18n";

function parseError(err: unknown): string {
  if (err instanceof ApiError) {
    try {
      const body = JSON.parse(err.body);
      return body.detail ?? Object.values(body).flat().join(", ");
    } catch {
      return err.body || "Request failed";
    }
  }
  return err instanceof Error ? err.message : "Unknown error";
}

/* ── Profile Tab ─────────────────────────────────────────────────────── */

function ProfileTab({ user, onSaved, lang }: { user: UserProfile; onSaved: () => void; lang: string }) {
  const [firstName, setFirstName] = React.useState(user.first_name ?? "");
  const [lastName, setLastName] = React.useState(user.last_name ?? "");
  const [username, setUsername] = React.useState(user.username ?? "");
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [success, setSuccess] = React.useState(false);

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
      setError(parseError(err));
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
          {error && <p className="text-sm text-destructive">{error}</p>}
          {success && <p className="text-sm text-muted-foreground">{t("settings.profile.saved", lang)}</p>}
          <div className="pt-2">
            <Button type="submit" loading={loading}>{t("settings.profile.save", lang)}</Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

/* ── Seller Profile Tab ──────────────────────────────────────────────── */

function SellerTab({ user, onSaved, lang }: { user: UserProfile; onSaved: () => void; lang: string }) {
  const p = user.profile;
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
      setError(parseError(err));
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

          {error && <p className="text-sm text-destructive">{error}</p>}
          {success && <p className="text-sm text-muted-foreground">{t("settings.seller.saved", lang)}</p>}
          <div className="pt-2">
            <Button type="submit" loading={loading}>{t("settings.seller.save", lang)}</Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

/* ── Privacy Tab ─────────────────────────────────────────────────────── */

function PrivacyTab({ user, onSaved, lang }: { user: UserProfile; onSaved: () => void; lang: string }) {
  const p = user.profile;
  const [isPublic, setIsPublic] = React.useState(p?.is_public ?? true);
  const [showEmail, setShowEmail] = React.useState(p?.show_email ?? false);
  const [showPhone, setShowPhone] = React.useState(p?.show_phone ?? false);
  const [allowContact, setAllowContact] = React.useState(p?.allow_contact ?? true);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [success, setSuccess] = React.useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(false);
    try {
      setLoading(true);
      await updateSellerProfile({
        is_public: isPublic,
        show_email: showEmail,
        show_phone: showPhone,
        allow_contact: allowContact,
      });
      setSuccess(true);
      onSaved();
    } catch (err) {
      setError(parseError(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("settings.privacy.title", lang)}</CardTitle>
        <CardDescription>{t("settings.privacy.subtitle", lang)}</CardDescription>
      </CardHeader>
      <CardContent>
        <form className="space-y-1" onSubmit={handleSubmit}>
          <div className="divide-y divide-border">
            <ToggleRow
              label={t("settings.privacy.publicProfile", lang)}
              hint={t("settings.privacy.publicProfileHint", lang)}
              checked={isPublic}
              onChange={setIsPublic}
            />
            <ToggleRow
              label={t("settings.privacy.showEmail", lang)}
              hint={t("settings.privacy.showEmailHint", lang)}
              checked={showEmail}
              onChange={setShowEmail}
            />
            <ToggleRow
              label={t("settings.privacy.showPhone", lang)}
              hint={t("settings.privacy.showPhoneHint", lang)}
              checked={showPhone}
              onChange={setShowPhone}
            />
            <ToggleRow
              label={t("settings.privacy.allowContact", lang)}
              hint={t("settings.privacy.allowContactHint", lang)}
              checked={allowContact}
              onChange={setAllowContact}
            />
          </div>
          {error && <p className="text-sm text-destructive pt-3">{error}</p>}
          {success && <p className="text-sm text-muted-foreground pt-3">{t("settings.privacy.saved", lang)}</p>}
          <div className="pt-4">
            <Button type="submit" loading={loading}>{t("settings.privacy.save", lang)}</Button>
          </div>
        </form>
      </CardContent>
    </Card>
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
  const [billing, setBilling] = React.useState(pd?.notify_billing ?? true);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [success, setSuccess] = React.useState(false);

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
        notify_billing: billing,
      });
      setSuccess(true);
      onSaved();
    } catch (err) {
      setError(parseError(err));
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
                <ToggleRow
                  label={t("settings.notifications.billing", lang)}
                  checked={billing}
                  onChange={setBilling}
                />
              </>
            )}
          </div>
          {error && <p className="text-sm text-destructive pt-3">{error}</p>}
          {success && <p className="text-sm text-muted-foreground pt-3">{t("settings.notifications.saved", lang)}</p>}
          <div className="pt-4">
            <Button type="submit" loading={loading}>{t("settings.notifications.save", lang)}</Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

/* ── Toggle Row (reusable) ───────────────────────────────────────────── */

function ToggleRow({ label, hint, checked, onChange }: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-start justify-between gap-4 py-3.5">
      <div className="min-w-0 pr-2">
        <p className="text-sm font-medium">{label}</p>
        {hint && <p className="text-[11px] text-muted-foreground mt-0.5">{hint}</p>}
      </div>
      <Switch checked={checked} onCheckedChange={onChange} />
    </div>
  );
}

/* ── Localization Tab ────────────────────────────────────────────────── */

const COMMON_TIMEZONES = [
  { code: "UTC", name: "UTC" },
  { code: "Europe/Bratislava", name: "Europe/Bratislava (CET)" },
  { code: "Europe/Prague", name: "Europe/Prague (CET)" },
  { code: "Europe/Vienna", name: "Europe/Vienna (CET)" },
  { code: "Europe/Berlin", name: "Europe/Berlin (CET)" },
  { code: "Europe/London", name: "Europe/London (GMT)" },
  { code: "Europe/Paris", name: "Europe/Paris (CET)" },
  { code: "Europe/Warsaw", name: "Europe/Warsaw (CET)" },
  { code: "Europe/Budapest", name: "Europe/Budapest (CET)" },
  { code: "America/New_York", name: "America/New York (ET)" },
  { code: "America/Los_Angeles", name: "America/Los Angeles (PT)" },
  { code: "Australia/Sydney", name: "Australia/Sydney (AEST)" },
];

function flattenUnits(grouped: { METRIC?: PreferenceOption[]; IMPERIAL?: PreferenceOption[] } | null | undefined): PreferenceOption[] {
  if (!grouped) return [];
  return [...(grouped.METRIC ?? []), ...(grouped.IMPERIAL ?? [])];
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
      setSuccess(true);
      onSaved();
    } catch (err) {
      setError(parseError(err));
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

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("settings.localization.title", lang)}</CardTitle>
        <CardDescription>{t("settings.localization.subtitle", lang)}</CardDescription>
      </CardHeader>
      <CardContent>
        <form className="space-y-5" onSubmit={handleSubmit}>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label>{t("settings.localization.language", lang)}</Label>
              <Select value={language} onValueChange={setLanguage}>
                <SelectTrigger className="h-11"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {languages.map((l) => (
                    <SelectItem key={l.code} value={l.code}>{l.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>{t("settings.localization.timezone", lang)}</Label>
              <Select value={timezone} onValueChange={setTimezone}>
                <SelectTrigger className="h-11"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {COMMON_TIMEZONES.map((tz) => (
                    <SelectItem key={tz.code} value={tz.code}>{tz.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <Separator />

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label>{t("settings.localization.currency", lang)}</Label>
              <Select value={currency} onValueChange={setCurrency}>
                <SelectTrigger className="h-11"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {currencies.map((c) => (
                    <SelectItem key={c.code} value={c.code}>
                      {c.symbol ? `${c.code} — ${c.name} (${c.symbol})` : `${c.code} — ${c.name}`}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>{t("settings.localization.dateFormat", lang)}</Label>
              <Select value={dateFormat} onValueChange={setDateFormat}>
                <SelectTrigger className="h-11"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {dateFormats.map((d) => (
                    <SelectItem key={d.code} value={d.code}>{d.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label>{t("settings.localization.areaUnit", lang)}</Label>
              <Select value={areaUnit} onValueChange={setAreaUnit}>
                <SelectTrigger className="h-11"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {areaUnits.map((u) => (
                    <SelectItem key={u.code} value={u.code}>
                      {u.symbol ? `${u.name} (${u.symbol})` : u.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>{t("settings.localization.distanceUnit", lang)}</Label>
              <Select value={distanceUnit} onValueChange={setDistanceUnit}>
                <SelectTrigger className="h-11"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {distanceUnits.map((u) => (
                    <SelectItem key={u.code} value={u.code}>
                      {u.symbol ? `${u.name} (${u.symbol})` : u.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}
          {success && <p className="text-sm text-muted-foreground">{t("settings.localization.saved", lang)}</p>}
          <div className="pt-2">
            <Button type="submit" loading={loading}>{t("settings.localization.save", lang)}</Button>
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
  const canSubmit = currentPassword.length >= 6 && newPassword.length >= 8 && newPassword === confirmPassword;

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
      setError(parseError(err));
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
          {error && <p className="text-sm text-destructive">{error}</p>}
          {success && <p className="text-sm text-muted-foreground">{t("settings.security.saved", lang)}</p>}
          <div className="pt-2">
            <Button type="submit" loading={loading} disabled={!canSubmit || loading}>{t("settings.security.save", lang)}</Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

/* ── Billing Tab ──────────────────────────────────────────────────────── */

function BillingTab({ user, onSaved, lang }: { user: UserProfile; onSaved: () => void; lang: string }) {
  const b = user.billing_account;
  const [billingName, setBillingName] = React.useState(b?.billing_name ?? "");
  const [billingEmail, setBillingEmail] = React.useState(b?.billing_email ?? "");
  const [billingAddress, setBillingAddress] = React.useState(b?.billing_address ?? "");
  const [billingCity, setBillingCity] = React.useState(b?.billing_city ?? "");
  const [billingPostalCode, setBillingPostalCode] = React.useState(b?.billing_postal_code ?? "");
  const [billingCountry, setBillingCountry] = React.useState(b?.billing_country ?? "");
  const [vatNumber, setVatNumber] = React.useState(b?.vat_number ?? "");
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [success, setSuccess] = React.useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(false);
    try {
      setLoading(true);
      await updateBilling({
        billing_name: billingName.trim(),
        billing_email: billingEmail.trim(),
        billing_address: billingAddress.trim(),
        billing_city: billingCity.trim(),
        billing_postal_code: billingPostalCode.trim(),
        billing_country: billingCountry.trim(),
        vat_number: vatNumber.trim(),
      });
      setSuccess(true);
      onSaved();
    } catch (err) {
      setError(parseError(err));
    } finally {
      setLoading(false);
    }
  }

  if (!b) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-muted-foreground text-sm">
          No billing account found.
        </CardContent>
      </Card>
    );
  }

  const tier = b.subscription_tier_detail;

  return (
    <div className="space-y-6">
      {/* Subscription overview */}
      <Card>
        <CardHeader>
          <CardTitle>{t("settings.billing.title", lang)}</CardTitle>
          <CardDescription>{t("settings.billing.subtitle", lang)}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-1 gap-x-4 gap-y-2 text-sm sm:grid-cols-2">
            <span className="text-muted-foreground">{t("settings.billing.plan", lang)}</span>
            <span className="font-medium">{tier?.name ?? "—"}</span>
            <span className="text-muted-foreground">{t("settings.billing.status", lang)}</span>
            <span className="font-medium">{b.is_active ? t("settings.billing.active", lang) : t("settings.billing.inactive", lang)}</span>
            <span className="text-muted-foreground">{t("settings.billing.cycle", lang)}</span>
            <span className="font-medium capitalize">{b.billing_cycle || "—"}</span>
            <span className="text-muted-foreground">{t("settings.billing.storage", lang)}</span>
            <span className="font-medium">{b.current_storage_gb} / {tier?.max_storage_gb ?? "∞"} GB</span>
            <span className="text-muted-foreground">{t("settings.billing.posts", lang)}</span>
            <span className="font-medium">{b.current_posts_count} / {tier?.max_posts ?? "∞"}</span>
            {b.is_trial && (
              <>
                <span className="text-muted-foreground">{t("settings.billing.trial", lang)}</span>
                <span className="font-medium text-amber-600">{b.days_until_expiry != null ? `${b.days_until_expiry}d` : "—"}</span>
              </>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Editable billing details */}
      <Card>
        <CardHeader>
          <CardTitle>{t("settings.billing.detailsTitle", lang)}</CardTitle>
        </CardHeader>
        <CardContent>
          <form className="space-y-4" onSubmit={handleSubmit}>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>{t("settings.billing.name", lang)}</Label>
                <Input value={billingName} onChange={(e) => setBillingName(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>{t("settings.billing.email", lang)}</Label>
                <Input type="email" value={billingEmail} onChange={(e) => setBillingEmail(e.target.value)} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>{t("settings.billing.address", lang)}</Label>
              <Input value={billingAddress} onChange={(e) => setBillingAddress(e.target.value)} />
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <div className="space-y-1.5">
                <Label>{t("settings.billing.city", lang)}</Label>
                <Input value={billingCity} onChange={(e) => setBillingCity(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>{t("settings.billing.postalCode", lang)}</Label>
                <Input value={billingPostalCode} onChange={(e) => setBillingPostalCode(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>{t("settings.billing.country", lang)}</Label>
                <Input value={billingCountry} onChange={(e) => setBillingCountry(e.target.value)} maxLength={2} placeholder="SK" />
              </div>
              <div className="space-y-1.5">
                <Label>{t("settings.billing.vat", lang)}</Label>
                <Input value={vatNumber} onChange={(e) => setVatNumber(e.target.value)} placeholder="SK2020123456" />
              </div>
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            {success && <p className="text-sm text-muted-foreground">{t("settings.billing.saved", lang)}</p>}
            <div className="pt-2">
              <Button type="submit" loading={loading}>{t("settings.billing.save", lang)}</Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

/* ── Settings Form (main export) ─────────────────────────────────────── */

export function SettingsForm({ user, onSaved }: { user: UserProfile; onSaved: () => void }) {
  const lang = getUserLanguage(user.localization);

  return (
    <Tabs defaultValue="profile" className="w-full">
      <TabsList className="mb-5 flex w-full flex-wrap gap-1 sm:mb-6">
        <TabsTrigger value="profile">{t("settings.tab.profile", lang)}</TabsTrigger>
        <TabsTrigger value="seller">{t("settings.tab.seller", lang)}</TabsTrigger>
        <TabsTrigger value="privacy">{t("settings.tab.privacy", lang)}</TabsTrigger>
        <TabsTrigger value="localization">{t("settings.tab.localization", lang)}</TabsTrigger>
        <TabsTrigger value="notifications">{t("settings.tab.notifications", lang)}</TabsTrigger>
        <TabsTrigger value="billing">{t("settings.tab.billing", lang)}</TabsTrigger>
        <TabsTrigger value="security">{t("settings.tab.security", lang)}</TabsTrigger>
      </TabsList>
      <TabsContent value="profile">
        <ProfileTab user={user} onSaved={onSaved} lang={lang} />
      </TabsContent>
      <TabsContent value="seller">
        <SellerTab user={user} onSaved={onSaved} lang={lang} />
      </TabsContent>
      <TabsContent value="privacy">
        <PrivacyTab user={user} onSaved={onSaved} lang={lang} />
      </TabsContent>
      <TabsContent value="localization">
        <LocalizationTab user={user} onSaved={onSaved} lang={lang} />
      </TabsContent>
      <TabsContent value="notifications">
        <NotificationsTab user={user} onSaved={onSaved} lang={lang} />
      </TabsContent>
      <TabsContent value="billing">
        <BillingTab user={user} onSaved={onSaved} lang={lang} />
      </TabsContent>
      <TabsContent value="security">
        <SecurityTab lang={lang} />
      </TabsContent>
    </Tabs>
  );
}
