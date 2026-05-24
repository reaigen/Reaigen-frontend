"use client";

import * as React from "react";
import { Button } from "../lib/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "../lib/ui/card";
import { Input } from "../lib/ui/input";
import { Label } from "../lib/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../lib/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../lib/ui/select";
import { Separator } from "../lib/ui/separator";
import {
  ApiError,
  updateProfile,
  updateLocalization,
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
          <div className="grid grid-cols-2 gap-4">
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
            <Input id="email" value={user.email} disabled className="opacity-60" />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          {success && <p className="text-sm text-green-600">{t("settings.profile.saved", lang)}</p>}
          <Button type="submit" loading={loading}>{t("settings.profile.save", lang)}</Button>
        </form>
      </CardContent>
    </Card>
  );
}

// Common timezones for the selector
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

// Flatten grouped units {METRIC: [...], IMPERIAL: [...]} into a single array
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
          {success && <p className="text-sm text-green-600">{t("settings.localization.saved", lang)}</p>}
          <Button type="submit" loading={loading}>{t("settings.localization.save", lang)}</Button>
        </form>
      </CardContent>
    </Card>
  );
}

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
          {success && <p className="text-sm text-green-600">{t("settings.security.saved", lang)}</p>}
          <Button type="submit" loading={loading} disabled={!canSubmit || loading}>{t("settings.security.save", lang)}</Button>
        </form>
      </CardContent>
    </Card>
  );
}

export function SettingsForm({ user, onSaved }: { user: UserProfile; onSaved: () => void }) {
  const lang = getUserLanguage(user.localization);

  return (
    <Tabs defaultValue="profile" className="w-full">
      <TabsList>
        <TabsTrigger value="profile">{t("settings.tab.profile", lang)}</TabsTrigger>
        <TabsTrigger value="localization">{t("settings.tab.localization", lang)}</TabsTrigger>
        <TabsTrigger value="security">{t("settings.tab.security", lang)}</TabsTrigger>
      </TabsList>
      <TabsContent value="profile">
        <ProfileTab user={user} onSaved={onSaved} lang={lang} />
      </TabsContent>
      <TabsContent value="localization">
        <LocalizationTab user={user} onSaved={onSaved} lang={lang} />
      </TabsContent>
      <TabsContent value="security">
        <SecurityTab lang={lang} />
      </TabsContent>
    </Tabs>
  );
}
