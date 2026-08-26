"use client";

import * as React from "react";
import { Button } from "../lib/ui/button";
import { Input } from "../lib/ui/input";
import { Label } from "../lib/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../lib/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../lib/ui/select";
import { Separator } from "../lib/ui/separator";
import { Switch } from "../lib/ui/switch";
import { Checkbox } from "../lib/ui/checkbox";
import { Textarea } from "../lib/ui/textarea";
import { Avatar, AvatarFallback, AvatarImage } from "../lib/ui/avatar";
import { BottomSheet } from "../lib/ui/bottom-sheet";
import {
  updateProfile,
  updateAccountConsent,
  updateSellerProfile,
  updateLocalization,
  updatePersonalizedData,
  updateBilling,
  changePassword,
  getAvailablePreferences,
  presignAvatar,
  confirmAvatar,
  presignCover,
  confirmCover,
  resendVerification,
  getTotpStatus,
  setupTotp,
  confirmTotp,
  disableTotp,
  getLinkedAccounts,
  unlinkSocialAccount,
  requestPhoneLinkOtp,
  verifyPhoneLinkOtp,
  getReaiAgentConsent,
  grantReaiAgentConsent,
  revokeReaiAgentConsent,
  getReaiToolPermissions,
  updateReaiToolPermissions,
  getReaiImprovementConsent,
  grantReaiImprovementConsent,
  revokeReaiImprovementConsent,
  type UserProfile,
  type PersonalizedData,
  type AvailablePreferences,
  type PreferenceOption,
  type TotpStatus,
  type TotpSetupResponse,
  type LinkedAccountsResponse,
  type DeviceSession,
  getDeviceSessions,
  revokeDeviceSession,
  revokeOtherDeviceSessions,
  revokeAllDeviceSessions,
  logout as apiLogout,
  type ReaiAgentConsent,
  type ReaiToolCode,
  type ReaiToolPermissions,
  type ReaiImprovementConsent,
} from "../lib/api/client";
import { getSafeApiErrorMessage } from "../lib/api/error-message";
import {
  disableWebPushForUser,
  enableWebPushForUser,
  getWebPushStateForUser,
  type WebPushState,
} from "../lib/web-push";
import { DeviceDesktopIcon, DeviceMobileIcon, ImageIcon, LinkIcon } from "./icons";
import { formatPhoneDisplay } from "../lib/phone";
import { t, getUserLanguage, formatDate as fmtDate } from "../lib/i18n";
import type { LocaleKey } from "../lib/locales";
import { cn } from "../lib/utils";
import { ManagedLegalDocuments } from "./content-documents";

function useAutoDismiss(value: boolean, setter: (v: boolean) => void, ms = 3000) {
  React.useEffect(() => {
    if (!value) return;
    const timer = setTimeout(() => setter(false), ms);
    return () => clearTimeout(timer);
  }, [value, setter, ms]);
}

// Grouped card, mirroring the iOS app's Settings LiquidCard sections.
function Card({ className, ...props }: React.HTMLAttributes<HTMLElement>) {
  return (
    <section
      data-settings-card
      className={cn("rounded-[20px] border border-border/65 bg-card p-4 shadow-card sm:rounded-[22px] sm:p-5", className)}
      {...props}
    />
  );
}

function CardHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("pb-4", className)} {...props} />;
}

function CardTitle({ className, ...props }: React.HTMLAttributes<HTMLHeadingElement>) {
  return <h2 className={cn("text-[17px] font-semibold leading-tight tracking-[-0.02em]", className)} {...props} />;
}

function CardDescription({ className, ...props }: React.HTMLAttributes<HTMLParagraphElement>) {
  return <p className={cn("mt-1.5 text-[13px] leading-relaxed text-muted-foreground", className)} {...props} />;
}

function CardContent({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("w-full", className)} {...props} />;
}

function formatAccountDate(value: string | null | undefined, lang: string, dateFormat?: string | null) {
  if (!value) return t("common.notRecorded", lang);
  const result = fmtDate(value, dateFormat, lang);
  return result || t("common.notRecorded", lang);
}

function DataRow({ label, value }: { label: string; value: React.ReactNode }) {
  // One line, label left and value right — the way a native settings list
  // reads — instead of stacking into a tall label-over-value ladder on phones.
  return (
    <div className="flex min-h-11 items-baseline justify-between gap-6 border-b border-border/60 py-3 last:border-b-0">
      <dt className="shrink-0 text-[12px] text-muted-foreground">{label}</dt>
      <dd className="min-w-0 text-right text-[13px] font-medium text-foreground/85">{value}</dd>
    </div>
  );
}

/* ── Collapsible Section ─────────────────────────────────────────────── */

function CollapsibleSection({ title, defaultOpen, children }: {
  title: string;
  defaultOpen: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = React.useState(defaultOpen);
  return (
    <div>
      <button
        type="button"
        aria-expanded={open}
        className={cn("flex w-full items-center py-2 text-left text-[14px] font-semibold text-foreground/65 transition-colors hover:text-foreground", open && "text-foreground")}
        onClick={() => setOpen(!open)}
      >
        {title}
      </button>
      {open && <div className="pt-2 space-y-4">{children}</div>}
    </div>
  );
}

/* ── Image Upload Helper ─────────────────────────────────────────────── */

async function uploadPresigned(
  presignFn: (data: { filename: string; content_type: string }) => Promise<{ upload_key: string; presigned_url: string }>,
  confirmFn: (key: string) => Promise<unknown>,
  file: File,
) {
  const { upload_key, presigned_url } = await presignFn({
    filename: file.name,
    content_type: file.type,
  });
  await fetch(presigned_url, {
    method: "PUT",
    body: file,
    headers: { "Content-Type": file.type },
  });
  await confirmFn(upload_key);
}

type JsonObject = Record<string, unknown>;

function asJsonObject(value: unknown): JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as JsonObject
    : {};
}

function optionalString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function getSellerContactPreferences(preferences: unknown) {
  const root = asJsonObject(preferences);
  const canonical = asJsonObject(root.seller_contact);
  const legacy = asJsonObject(root.sellerContact);
  return {
    root,
    contact: { ...legacy, ...canonical },
    publicEmail: optionalString(canonical.public_email ?? legacy.publicEmail),
    secondaryPhone: optionalString(canonical.secondary_phone ?? legacy.secondaryPhone),
  };
}

function withSellerContactPreferences(
  preferences: unknown,
  publicEmail: string,
  secondaryPhone: string,
): JsonObject {
  const { root, contact } = getSellerContactPreferences(preferences);
  const canonicalRoot = { ...root };
  const canonicalContact = { ...contact };
  delete canonicalRoot.sellerContact;
  delete canonicalContact.publicEmail;
  delete canonicalContact.secondaryPhone;
  return {
    ...canonicalRoot,
    seller_contact: {
      ...canonicalContact,
      public_email: publicEmail,
      secondary_phone: secondaryPhone,
    },
  };
}

/* ── Profile Tab ─────────────────────────────────────────────────────── */

function ProfileTab({ user, onSaved, lang }: { user: UserProfile; onSaved: () => void; lang: string }) {
  const [firstName, setFirstName] = React.useState(user.first_name ?? "");
  const [lastName, setLastName] = React.useState(user.last_name ?? "");
  const [username, setUsername] = React.useState(user.username ?? "");
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [success, setSuccess] = React.useState(false);
  const [avatarUploading, setAvatarUploading] = React.useState(false);
  const [emailResending, setEmailResending] = React.useState(false);
  const [emailResent, setEmailResent] = React.useState(false);
  const avatarInputRef = React.useRef<HTMLInputElement>(null);
  useAutoDismiss(success, setSuccess);
  useAutoDismiss(emailResent, setEmailResent);

  React.useEffect(() => {
    setFirstName(user.first_name ?? "");
    setLastName(user.last_name ?? "");
    setUsername(user.username ?? "");
  }, [user.first_name, user.last_name, user.username]);

  async function handleAvatarChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      setAvatarUploading(true);
      await uploadPresigned(presignAvatar, confirmAvatar, file);
      onSaved();
    } catch (err) {
      setError(getSafeApiErrorMessage(err, lang));
    } finally {
      setAvatarUploading(false);
      if (avatarInputRef.current) avatarInputRef.current.value = "";
    }
  }

  async function handleResendVerification() {
    try {
      setEmailResending(true);
      await resendVerification(user.email);
      setEmailResent(true);
    } catch (err) {
      setError(getSafeApiErrorMessage(err, lang));
    } finally {
      setEmailResending(false);
    }
  }

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

  const initials = `${(user.first_name || "")[0] ?? ""}${(user.last_name || "")[0] ?? ""}`.toUpperCase() || "?";
  const avatarUrl = user.profile?.avatar_thumbnail_url || user.profile?.avatar_url;

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("settings.profile.title", lang)}</CardTitle>
        <CardDescription>{t("settings.profile.subtitle", lang)}</CardDescription>
      </CardHeader>
      <CardContent>
        <form className="space-y-4" onSubmit={handleSubmit}>
          {/* Avatar */}
          <div className="flex items-center gap-4">
            <Avatar size="xl">
              {avatarUrl && <AvatarImage src={avatarUrl} alt={t("settings.profile.avatar", lang)} />}
              <AvatarFallback>{initials}</AvatarFallback>
            </Avatar>
            <div>
              <input ref={avatarInputRef} type="file" accept="image/*" className="hidden" onChange={handleAvatarChange} />
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-11"
                loading={avatarUploading}
                onClick={() => avatarInputRef.current?.click()}
              >
                {avatarUploading ? t("settings.profile.avatarUploading", lang) : t("settings.profile.avatarChange", lang)}
              </Button>
            </div>
          </div>

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
          {/*
            The address is a fact, not a field — a disabled input reads as a
            broken form. A quiet row states it, and the chip carries the
            verification status the way the phone row does.
          */}
          <div className="space-y-1.5">
            <Label>{t("settings.profile.email", lang)}</Label>
            <div className="flex min-h-11 items-center justify-between gap-4 rounded-2xl bg-muted/30 px-4 py-2.5">
              <span className="min-w-0 truncate text-sm font-medium">{user.email}</span>
              {user.email_verified ? (
                <span className="shrink-0 rounded-full bg-success/10 px-2.5 py-0.5 text-[11px] font-semibold text-emerald-800">
                  {t("settings.profile.emailVerified", lang)}
                </span>
              ) : (
                <span className="flex shrink-0 items-center gap-2">
                  <span className="rounded-full bg-foreground/[0.07] px-2.5 py-0.5 text-[11px] font-semibold text-foreground/70">
                    {t("settings.profile.emailUnverified", lang)}
                  </span>
                  {emailResent ? (
                    <span className="text-[11px] text-success">{t("settings.profile.emailResent", lang)}</span>
                  ) : (
                    <button
                      type="button"
                      className="text-[11px] font-medium text-foreground underline underline-offset-2 hover:no-underline disabled:opacity-50"
                      onClick={handleResendVerification}
                      disabled={emailResending}
                    >
                      {t("settings.profile.emailResend", lang)}
                    </button>
                  )}
                </span>
              )}
            </div>
          </div>
          {error && <p className="text-[12px] text-destructive">{error}</p>}
          {success && <p className="text-[12px] text-success">{t("settings.profile.saved", lang)}</p>}
          <div className="pt-2">
            <Button type="submit" size="sm" className="h-11" loading={loading}>{t("settings.profile.save", lang)}</Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

/* ── Seller Profile Tab ──────────────────────────────────────────────── */

function SellerTab({ user, onSaved, lang }: { user: UserProfile; onSaved: () => void; lang: string }) {
  const p = user.profile ?? {} as Partial<NonNullable<typeof user.profile>>;
  const sellerContact = getSellerContactPreferences(user.personalized_data?.preferences);
  const [phone, setPhone] = React.useState(p?.phone ?? "");
  const [publicEmail, setPublicEmail] = React.useState(sellerContact.publicEmail);
  const [secondaryPhone, setSecondaryPhone] = React.useState(sellerContact.secondaryPhone);
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
  const [coverUploading, setCoverUploading] = React.useState(false);
  const coverInputRef = React.useRef<HTMLInputElement>(null);
  useAutoDismiss(success, setSuccess);

  React.useEffect(() => {
    setPhone(p?.phone ?? "");
    setPublicEmail(sellerContact.publicEmail);
    setSecondaryPhone(sellerContact.secondaryPhone);
    setCompany(p?.company ?? "");
    setWebsite(p?.website ?? "");
    setBio(p?.bio ?? "");
    setJobTitle(p?.job_title ?? "");
    setLinkedin(p?.linkedin_url ?? "");
    setTwitter(p?.twitter_handle ?? "");
    setInstagram(p?.instagram_handle ?? "");
    setIsRePro(p?.is_real_estate_professional ?? false);
    setLicense(p?.license_number ?? "");
    setAgency(p?.agency_name ?? "");
    setAddress(p?.address ?? "");
    setCity(p?.city ?? "");
    setState(p?.state ?? "");
    setCountry(p?.country ?? "");
    setPostalCode(p?.postal_code ?? "");
  }, [
    p?.address,
    p?.agency_name,
    p?.bio,
    p?.city,
    p?.company,
    p?.country,
    p?.instagram_handle,
    p?.is_real_estate_professional,
    p?.job_title,
    p?.license_number,
    p?.linkedin_url,
    p?.phone,
    p?.postal_code,
    p?.state,
    p?.twitter_handle,
    p?.website,
    sellerContact.publicEmail,
    sellerContact.secondaryPhone,
  ]);

  async function handleCoverChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      setCoverUploading(true);
      await uploadPresigned(presignCover, confirmCover, file);
      onSaved();
    } catch (err) {
      setError(getSafeApiErrorMessage(err, lang));
    } finally {
      setCoverUploading(false);
      if (coverInputRef.current) coverInputRef.current.value = "";
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(false);
    try {
      setLoading(true);
      await Promise.all([
        updateSellerProfile({
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
        }),
        updatePersonalizedData({
          preferences: withSellerContactPreferences(
            user.personalized_data?.preferences,
            publicEmail.trim(),
            secondaryPhone.trim(),
          ),
        }),
      ]);
      setSuccess(true);
      onSaved();
    } catch (err) {
      setError(getSafeApiErrorMessage(err, lang));
    } finally {
      setLoading(false);
    }
  }

  const hasSocial = !!(linkedin || twitter || instagram);
  const hasAddress = !!(address || city || state || country || postalCode);
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("settings.seller.title", lang)}</CardTitle>
        <CardDescription>{t("settings.seller.subtitle", lang)}</CardDescription>
      </CardHeader>
      <CardContent>
        <form className="space-y-4" onSubmit={handleSubmit}>
          {/* Cover Image */}
          <div className="relative">
            <input ref={coverInputRef} type="file" accept="image/*" className="hidden" onChange={handleCoverChange} />
            {p?.cover_image_url ? (
              <>
                <div className="h-28 w-full overflow-hidden rounded-xl bg-muted sm:h-36">
                  {/* User-owned signed media URLs are not compatible with a fixed Next image host. */}
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={p.cover_image_url} alt={t("settings.seller.coverImage", lang)} className="h-full w-full object-cover" />
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  loading={coverUploading}
                  className="absolute bottom-2 right-2 bg-background/80 backdrop-blur-sm"
                  onClick={() => coverInputRef.current?.click()}
                >
                  {coverUploading ? t("settings.seller.coverUploading", lang) : t("settings.seller.coverChange", lang)}
                </Button>
              </>
            ) : (
              /*
                With no image there is nothing for a floating button to float
                over — it just collided with the placeholder label. The whole
                empty surface is the upload control instead.
              */
              <button
                type="button"
                disabled={coverUploading}
                onClick={() => coverInputRef.current?.click()}
                className="flex h-28 w-full flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border/70 bg-muted/30 px-4 text-center transition-colors hover:border-foreground/25 hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:opacity-60 sm:h-32"
              >
                <span className="flex h-9 w-9 items-center justify-center rounded-full bg-muted/80 text-foreground/40">
                  <ImageIcon size={17} />
                </span>
                <span className="text-[13px] font-medium text-foreground/70">
                  {coverUploading ? t("settings.seller.coverUploading", lang) : t("settings.seller.coverImage", lang)}
                </span>
              </button>
            )}
          </div>

          {/* Contact */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="seller-phone">{t("settings.seller.phone", lang)}</Label>
              <Input id="seller-phone" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+421 900 123 456" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="seller-company">{t("settings.seller.company", lang)}</Label>
              <Input id="seller-company" value={company} onChange={(e) => setCompany(e.target.value)} />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="seller-public-email">{t("settings.seller.publicEmail", lang)}</Label>
              <Input id="seller-public-email" value={publicEmail} onChange={(e) => setPublicEmail(e.target.value)} type="email" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="seller-secondary-phone">{t("settings.seller.secondaryPhone", lang)}</Label>
              <Input id="seller-secondary-phone" value={secondaryPhone} onChange={(e) => setSecondaryPhone(e.target.value)} placeholder="+421 900 123 456" />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="seller-job-title">{t("settings.seller.jobTitle", lang)}</Label>
              <Input id="seller-job-title" value={jobTitle} onChange={(e) => setJobTitle(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="seller-website">{t("settings.seller.website", lang)}</Label>
              <Input id="seller-website" value={website} onChange={(e) => setWebsite(e.target.value)} placeholder="https://www.example.com" />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="seller-bio">{t("settings.seller.bio", lang)}</Label>
            <Textarea
              id="seller-bio"
              value={bio}
              onChange={(e) => setBio(e.target.value)}
              rows={3}
              placeholder={t("settings.seller.bio", lang) + "…"}
            />
          </div>

          {/* Social — collapsible */}
          <Separator />
          <CollapsibleSection title={t("settings.seller.sectionSocial", lang)} defaultOpen={hasSocial}>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="seller-linkedin">{t("settings.seller.linkedin", lang)}</Label>
                <Input id="seller-linkedin" value={linkedin} onChange={(e) => setLinkedin(e.target.value)} placeholder="https://linkedin.com/in/your-name" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="seller-twitter">{t("settings.seller.twitter", lang)}</Label>
                <Input id="seller-twitter" value={twitter} onChange={(e) => setTwitter(e.target.value)} placeholder="@yourhandle" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="seller-instagram">{t("settings.seller.instagram", lang)}</Label>
                <Input id="seller-instagram" value={instagram} onChange={(e) => setInstagram(e.target.value)} placeholder="@yourhandle" />
              </div>
            </div>
          </CollapsibleSection>

          {/* RE Professional */}
          <Separator />
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="text-sm font-medium">{t("settings.seller.reAgent", lang)}</p>
            </div>
            <Switch aria-label={t("settings.seller.reAgent", lang)} checked={isRePro} onCheckedChange={setIsRePro} />
          </div>

          {isRePro && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="seller-license">{t("settings.seller.license", lang)}</Label>
                <Input id="seller-license" value={license} onChange={(e) => setLicense(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="seller-agency">{t("settings.seller.agency", lang)}</Label>
                <Input id="seller-agency" value={agency} onChange={(e) => setAgency(e.target.value)} />
              </div>
            </div>
          )}

          {/* Address — collapsible */}
          <Separator />
          <CollapsibleSection title={t("settings.seller.sectionAddress", lang)} defaultOpen={hasAddress}>
            <div className="space-y-1.5">
              <Label htmlFor="seller-address">{t("settings.seller.address", lang)}</Label>
              <Input id="seller-address" value={address} onChange={(e) => setAddress(e.target.value)} />
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <div className="space-y-1.5">
                <Label htmlFor="seller-city">{t("settings.seller.city", lang)}</Label>
                <Input id="seller-city" value={city} onChange={(e) => setCity(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="seller-state">{t("settings.seller.state", lang)}</Label>
                <Input id="seller-state" value={state} onChange={(e) => setState(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="seller-country">{t("settings.seller.country", lang)}</Label>
                <Input id="seller-country" value={country} onChange={(e) => setCountry(e.target.value)} maxLength={2} placeholder="SK" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="seller-postal-code">{t("settings.seller.postalCode", lang)}</Label>
                <Input id="seller-postal-code" value={postalCode} onChange={(e) => setPostalCode(e.target.value)} />
              </div>
            </div>
          </CollapsibleSection>

          {error && <p className="text-[12px] text-destructive">{error}</p>}
          {success && <p className="text-[12px] text-success">{t("settings.seller.saved", lang)}</p>}
          <div className="pt-2">
            <Button type="submit" size="sm" loading={loading}>{t("settings.seller.save", lang)}</Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

/* ── Reai Tab ───────────────────────────────────────────────────────── */

const REAI_BOUNDARY_KEYS: Record<string, LocaleKey> = {
  local_viewer_only: "settings.reai.boundary.local_viewer_only",
  local_deterministic: "settings.reai.boundary.local_deterministic",
  redacted_creation_context: "settings.reai.boundary.redacted_creation_context",
  redacted_creation_catalogue: "settings.reai.boundary.redacted_creation_catalogue",
  derived_floorplan_facts: "settings.reai.boundary.derived_floorplan_facts",
  approved_translation_service: "settings.reai.boundary.approved_translation_service",
  approved_media_processor: "settings.reai.boundary.approved_media_processor",
  approved_cloud_media_processor: "settings.reai.boundary.approved_cloud_media_processor",
  derived_media_metadata: "settings.reai.boundary.derived_media_metadata",
  approved_location_services: "settings.reai.boundary.approved_location_services",
  redacted_financial_scenario: "settings.reai.boundary.redacted_financial_scenario",
  local_tinyui_renderer: "settings.reai.boundary.local_tinyui_renderer",
};

function ReaiTab({ lang }: { lang: string }) {
  const [consent, setConsent] = React.useState<ReaiAgentConsent | null>(null);
  const [toolPermissions, setToolPermissions] = React.useState<ReaiToolPermissions | null>(null);
  const [improvementConsent, setImprovementConsent] = React.useState<ReaiImprovementConsent | null>(null);
  const [acknowledged, setAcknowledged] = React.useState(false);
  const [confirmingDisable, setConfirmingDisable] = React.useState(false);
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [success, setSuccess] = React.useState<string | null>(null);

  React.useEffect(() => {
    let active = true;
    Promise.all([getReaiAgentConsent(), getReaiImprovementConsent()])
      .then(async ([agentConsent, improvement]) => {
        if (!active) return;
        setConsent(agentConsent);
        setImprovementConsent(improvement);
        if (agentConsent.consented) setToolPermissions(await getReaiToolPermissions());
      })
      .catch((err) => {
        if (active) setError(getSafeApiErrorMessage(err, lang));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, [lang]);

  async function enableReai() {
    if (!consent || !acknowledged || saving) return;
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      setConsent(await grantReaiAgentConsent(consent.policy_version));
      setToolPermissions(await getReaiToolPermissions());
      setAcknowledged(false);
      setSuccess(t("settings.reai.enabled", lang));
      window.dispatchEvent(new CustomEvent("reai-consent-changed", { detail: { enabled: true } }));
    } catch (err) {
      setError(getSafeApiErrorMessage(err, lang));
    } finally {
      setSaving(false);
    }
  }

  async function disableReai() {
    if (!consent || saving) return;
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      setConsent(await revokeReaiAgentConsent());
      setConfirmingDisable(false);
      setSuccess(t("settings.reai.disabled", lang));
      window.dispatchEvent(new CustomEvent("reai-consent-changed", { detail: { enabled: false } }));
    } catch (err) {
      setError(getSafeApiErrorMessage(err, lang));
    } finally {
      setSaving(false);
    }
  }

  async function toggleImprovement() {
    if (!improvementConsent || saving) return;
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      if (improvementConsent.consented) {
        setImprovementConsent(await revokeReaiImprovementConsent());
        setSuccess(t("settings.reai.improvementDisabled", lang));
      } else {
        setImprovementConsent(await grantReaiImprovementConsent(improvementConsent.policy_version));
        setSuccess(t("settings.reai.improvementEnabled", lang));
      }
    } catch (err) {
      setError(getSafeApiErrorMessage(err, lang));
    } finally {
      setSaving(false);
    }
  }

  async function setAllTools(allowAll: boolean) {
    if (!toolPermissions || saving) return;
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      setToolPermissions(await updateReaiToolPermissions({ allow_all_tools: allowAll }));
      setSuccess(t("settings.reai.toolsSaved", lang));
    } catch (err) {
      setError(getSafeApiErrorMessage(err, lang));
    } finally {
      setSaving(false);
    }
  }

  async function setTool(code: ReaiToolCode, allowed: boolean) {
    if (!toolPermissions || toolPermissions.allow_all_tools || saving) return;
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      setToolPermissions(await updateReaiToolPermissions({ tools: { [code]: allowed } }));
      setSuccess(t("settings.reai.toolsSaved", lang));
    } catch (err) {
      setError(getSafeApiErrorMessage(err, lang));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>{t("settings.reai.title", lang)}</CardTitle>
          <CardDescription>{t("settings.reai.subtitle", lang)}</CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-[13px] text-muted-foreground">{t("reai.working", lang)}</p>
          ) : consent ? (
            <div className="space-y-4">
              <div className="flex flex-col gap-3 rounded-lg border border-border/60 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-[13px] font-medium">{t("settings.reai.access", lang)}</p>
                  <p className="mt-1 text-[12px] text-muted-foreground">
                    {consent.consented ? t("settings.reai.accessEnabled", lang) : t("settings.reai.accessDisabled", lang)}
                  </p>
                </div>
                <span className={cn(
                  "w-fit rounded-full px-2.5 py-0.5 text-[11px] font-medium",
                  consent.consented ? "bg-success/10 text-emerald-800" : "bg-foreground/10 text-foreground/60",
                )}>
                  {consent.consented ? t("common.allowed", lang) : t("common.notAllowed", lang)}
                </span>
              </div>

              <div className="rounded-lg bg-muted/25 p-4 text-[12px] leading-relaxed text-foreground/70">
                <p>{t("reai.consentData", lang)}</p>
                <p className="mt-1.5">{t("reai.consentNoData", lang)}</p>
                <p className="mt-1.5">{t("reai.consentStorage", lang)}</p>
                <p className="mt-1.5">{t("reai.consentMedia", lang)}</p>
              </div>

              {consent.consented ? (
                confirmingDisable ? (
                  <div className="space-y-3">
                    <p className="text-[12px] text-muted-foreground">{t("settings.reai.disableConfirmHint", lang)}</p>
                    <div className="flex items-center gap-2">
                      <Button type="button" size="sm" variant="destructive" loading={saving} onClick={disableReai}>
                        {t("settings.reai.disable", lang)}
                      </Button>
                      <Button type="button" size="sm" variant="outline" onClick={() => setConfirmingDisable(false)}>
                        {t("common.cancel", lang)}
                      </Button>
                    </div>
                  </div>
                ) : (
                  <Button type="button" size="sm" variant="outline" onClick={() => setConfirmingDisable(true)}>
                    {t("settings.reai.disable", lang)}
                  </Button>
                )
              ) : (
                <div className="space-y-3">
                  <label className="flex cursor-pointer items-start gap-2.5 text-[12px] leading-relaxed text-foreground/75">
                    <Checkbox
                      checked={acknowledged}
                      onCheckedChange={(checked) => setAcknowledged(checked === true)}
                      className="mt-0.5"
                    />
                    <span>{t("reai.consentLabel", lang)} · v{consent.policy_version}</span>
                  </label>
                  <Button type="button" size="sm" loading={saving} disabled={!acknowledged} onClick={enableReai}>
                    {t("reai.enable", lang)}
                  </Button>
                </div>
              )}
            </div>
          ) : null}
        </CardContent>
      </Card>

      {consent?.consented && toolPermissions && (
        <Card>
          <CardHeader>
            <CardTitle>{t("settings.reai.toolsTitle", lang)}</CardTitle>
            <CardDescription>{t("settings.reai.toolsSubtitle", lang)}</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              <div className="flex items-start justify-between gap-4 rounded-lg border border-border/60 px-4 py-3">
                <div className="min-w-0">
                  <p className="text-[13px] font-medium">{t("settings.reai.allTools", lang)}</p>
                  <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">{t("settings.reai.allToolsHelp", lang)}</p>
                </div>
                <Switch
                  checked={toolPermissions.allow_all_tools}
                  disabled={saving}
                  onCheckedChange={(checked) => void setAllTools(checked)}
                  aria-label={t("settings.reai.allTools", lang)}
                />
              </div>

              <div className="divide-y divide-border/60 rounded-lg border border-border/60 px-4">
                  {toolPermissions.available_tools.map((code) => {
                    // A tool the plan excludes can never be switched on: the
                    // backend keeps the preference but still reports it off,
                    // so an enabled switch would silently snap back.
                    const entitled = toolPermissions.tool_status?.[code]?.entitled ?? true;
                    const catalog = toolPermissions.tool_catalog?.[code];
                    const boundaryKey = catalog ? REAI_BOUNDARY_KEYS[catalog.data_boundary] : undefined;
                    return (
                      <div key={code} className="flex items-center justify-between gap-4 py-3">
                        <div className="min-w-0">
                          <p className="text-[13px] font-medium">{t(`settings.reai.tool.${code}`, lang)}</p>
                          <p className="mt-0.5 text-[12px] leading-relaxed text-muted-foreground">
                            {t(`settings.reai.tool.${code}.help`, lang)}
                          </p>
                          {boundaryKey && (
                            <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground/80">
                              {t(boundaryKey, lang)}
                              {catalog.persistent_change ? ` · ${t("settings.reai.persistentChange", lang)}` : ` · ${t("settings.reai.sessionOnly", lang)}`}
                            </p>
                          )}
                          {!entitled && (
                            <p className="mt-0.5 text-[12px] leading-relaxed text-muted-foreground/80">
                              {t("settings.reai.toolTierBlocked", lang)}
                            </p>
                          )}
                        </div>
                        <Switch
                          checked={toolPermissions.tools[code]}
                          disabled={saving || !entitled || toolPermissions.allow_all_tools}
                          onCheckedChange={(checked) => void setTool(code, checked)}
                          aria-label={t(`settings.reai.tool.${code}`, lang)}
                        />
                      </div>
                    );
                  })}
              </div>

              <p className="text-[12px] leading-relaxed text-muted-foreground">{t("settings.reai.toolsConfirmation", lang)}</p>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>{t("settings.reai.improvementTitle", lang)}</CardTitle>
          <CardDescription>{t("settings.reai.improvementSubtitle", lang)}</CardDescription>
        </CardHeader>
        <CardContent>
          {improvementConsent && (
            <div className="flex items-start justify-between gap-4 rounded-lg border border-border/60 px-4 py-3">
              <div className="min-w-0">
                <p className="text-[13px] font-medium">{t("settings.reai.improvementPermission", lang)}</p>
                <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">
                  {t("reai.improvementConsent", lang)} · {improvementConsent.retention_days} {t("reai.days", lang)} · v{improvementConsent.policy_version}
                </p>
              </div>
              <Switch
                checked={improvementConsent.consented}
                disabled={saving || (!consent?.consented && !improvementConsent.consented)}
                onCheckedChange={() => void toggleImprovement()}
                aria-label={t("settings.reai.improvementPermission", lang)}
              />
            </div>
          )}
        </CardContent>
      </Card>

      {error && <p className="text-[12px] text-destructive" role="alert">{error}</p>}
      {success && <p className="text-[12px] text-success" role="status">{success}</p>}
    </div>
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
  const [marketingConsent, setMarketingConsent] = React.useState(user.gdpr?.marketing_consent ?? false);
  const [marketingSaving, setMarketingSaving] = React.useState(false);
  const [marketingError, setMarketingError] = React.useState<string | null>(null);
  const [agentPrivacy, setAgentPrivacy] = React.useState<{
    consent: ReaiAgentConsent;
    tools: ReaiToolPermissions | null;
    improvement: ReaiImprovementConsent;
  } | null>(null);
  const [agentPrivacySaving, setAgentPrivacySaving] = React.useState(false);
  const [agentPrivacyError, setAgentPrivacyError] = React.useState<string | null>(null);
  useAutoDismiss(success, setSuccess);

  React.useEffect(() => {
    setIsPublic(p?.is_public ?? true);
    setShowEmail(p?.show_email ?? false);
    setShowPhone(p?.show_phone ?? false);
    setAllowContact(p?.allow_contact ?? true);
    setMarketingConsent(user.gdpr?.marketing_consent ?? false);
  }, [
    p?.allow_contact,
    p?.is_public,
    p?.show_email,
    p?.show_phone,
    user.gdpr?.marketing_consent,
  ]);

  React.useEffect(() => {
    let active = true;
    Promise.all([getReaiAgentConsent(), getReaiImprovementConsent()])
      .then(async ([consent, improvement]) => {
        const tools = consent.consented ? await getReaiToolPermissions() : null;
        if (active) setAgentPrivacy({ consent, tools, improvement });
      })
      .catch(() => {
        if (active) setAgentPrivacy(null);
      });
    return () => { active = false; };
  }, []);

  async function setPrivacyTools(payload: {
    allow_all_tools?: boolean;
    tools?: Partial<Record<ReaiToolCode, boolean>>;
  }) {
    if (!agentPrivacy?.tools || agentPrivacySaving) return;
    setAgentPrivacySaving(true);
    setAgentPrivacyError(null);
    try {
      const tools = await updateReaiToolPermissions(payload);
      setAgentPrivacy((current) => current ? { ...current, tools } : current);
    } catch (err) {
      setAgentPrivacyError(getSafeApiErrorMessage(err, lang));
    } finally {
      setAgentPrivacySaving(false);
    }
  }

  async function togglePrivacyImprovement() {
    if (!agentPrivacy || agentPrivacySaving) return;
    setAgentPrivacySaving(true);
    setAgentPrivacyError(null);
    try {
      const improvement = agentPrivacy.improvement.consented
        ? await revokeReaiImprovementConsent()
        : await grantReaiImprovementConsent(agentPrivacy.improvement.policy_version);
      setAgentPrivacy((current) => current ? { ...current, improvement } : current);
    } catch (err) {
      setAgentPrivacyError(getSafeApiErrorMessage(err, lang));
    } finally {
      setAgentPrivacySaving(false);
    }
  }

  async function handleMarketingConsent(nextValue: boolean) {
    const previous = marketingConsent;
    setMarketingConsent(nextValue);
    setMarketingSaving(true);
    setMarketingError(null);
    try {
      const saved = await updateAccountConsent({ marketing_consent: nextValue });
      setMarketingConsent(saved.marketing_consent);
      onSaved();
    } catch (err) {
      setMarketingConsent(previous);
      setMarketingError(getSafeApiErrorMessage(err, lang));
    } finally {
      setMarketingSaving(false);
    }
  }

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
            className="rounded-lg border border-border/60 bg-muted/25 px-4 py-3"
          >
            <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <p className="text-sm font-medium">{statusLabel}</p>
                <p className="text-[12px] text-muted-foreground mt-1 leading-relaxed">{statusHint}</p>
              </div>
              <span className="shrink-0 self-start rounded-full bg-foreground/10 px-2.5 py-0.5 text-[11px] font-medium text-foreground/70 sm:self-auto">
                {isPublic ? t("settings.privacy.badgePublic", lang) : t("settings.privacy.badgePrivate", lang)}
              </span>
            </div>
          </div>

          <fieldset className="divide-y divide-border/60">
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
            <div className="rounded-lg border border-border/60 bg-muted/25 px-3 py-2" role="note">
              <p className="text-[12px] text-muted-foreground">{t("settings.privacy.publicContactWarning", lang)}</p>
            </div>
          )}
          {error && <p className="text-[12px] text-destructive pt-3" role="alert">{error}</p>}
          {success && <p className="text-[12px] text-success pt-3" role="status">{t("settings.privacy.saved", lang)}</p>}
            <div className="pt-1">
              <Button type="submit" size="sm" loading={loading}>{t("settings.privacy.save", lang)}</Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("settings.privacy.agentTitle", lang)}</CardTitle>
          <CardDescription>{t("settings.privacy.agentSubtitle", lang)}</CardDescription>
        </CardHeader>
        <CardContent>
          <dl className="space-y-3 rounded-lg border border-border/60 px-4 py-3">
            <DataRow
              label={t("settings.privacy.agentAccess", lang)}
              value={agentPrivacy?.consent.consented ? t("common.allowed", lang) : t("common.notAllowed", lang)}
            />
            <DataRow
              label={t("settings.privacy.agentTools", lang)}
              value={agentPrivacy?.tools
                ? `${Object.values(agentPrivacy.tools.tools).filter(Boolean).length} / ${agentPrivacy.tools.available_tools.length}`
                : t("common.notRecorded", lang)}
            />
            <DataRow
              label={t("settings.privacy.agentImprovement", lang)}
              value={agentPrivacy?.improvement.consented ? t("common.allowed", lang) : t("common.notAllowed", lang)}
            />
          </dl>
          <p className="mt-3 text-[12px] leading-relaxed text-muted-foreground">
            {t("settings.privacy.agentViewerBoundary", lang)}
          </p>
          {agentPrivacy?.tools ? (
            <div className="mt-4 space-y-3">
              <div className="flex items-start justify-between gap-4 rounded-lg border border-border/60 px-3 py-2.5">
                <div>
                  <p className="text-[12px] font-medium">{t("settings.reai.allTools", lang)}</p>
                  <p className="mt-0.5 text-[11px] text-muted-foreground">{t("settings.reai.allToolsHelp", lang)}</p>
                </div>
                <Switch
                  checked={agentPrivacy.tools.allow_all_tools}
                  disabled={agentPrivacySaving}
                  onCheckedChange={(checked) => void setPrivacyTools({ allow_all_tools: checked })}
                  aria-label={t("settings.reai.allTools", lang)}
                />
              </div>
              <div className="divide-y divide-border/60 rounded-lg border border-border/60 px-3">
                  {agentPrivacy.tools.available_tools.map((code) => {
                    const entitled = agentPrivacy.tools?.tool_status[code]?.entitled ?? false;
                    const dataBoundary = agentPrivacy.tools?.tool_catalog[code]?.data_boundary;
                    const boundaryKey = dataBoundary
                      ? REAI_BOUNDARY_KEYS[dataBoundary]
                      : undefined;
                    return (
                      <div key={code} className="flex items-center justify-between gap-4 py-2.5">
                        <div className="min-w-0">
                          <p className="text-[12px] font-medium">{t(`settings.reai.tool.${code}`, lang)}</p>
                          <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">
                            {t(boundaryKey ?? "settings.reai.boundary.local_deterministic", lang)}
                          </p>
                        </div>
                        <Switch
                          checked={agentPrivacy.tools?.tools[code] ?? false}
                          disabled={agentPrivacySaving || !entitled || agentPrivacy.tools?.allow_all_tools}
                          onCheckedChange={(checked) => void setPrivacyTools({ tools: { [code]: checked } })}
                          aria-label={t(`settings.reai.tool.${code}`, lang)}
                        />
                      </div>
                    );
                  })}
              </div>
              <div className="flex items-start justify-between gap-4 rounded-lg border border-border/60 px-3 py-2.5">
                <div>
                  <p className="text-[12px] font-medium">{t("settings.reai.improvementPermission", lang)}</p>
                  <p className="mt-0.5 text-[11px] text-muted-foreground">{t("reai.improvementConsent", lang)}</p>
                </div>
                <Switch
                  checked={agentPrivacy.improvement.consented}
                  disabled={agentPrivacySaving}
                  onCheckedChange={() => void togglePrivacyImprovement()}
                  aria-label={t("settings.reai.improvementPermission", lang)}
                />
              </div>
            </div>
          ) : null}
          {agentPrivacyError ? <p className="mt-3 text-[12px] text-destructive" role="alert">{agentPrivacyError}</p> : null}
          <a
            href="#reai"
            className="mt-4 inline-flex min-h-9 items-center rounded-md border border-border bg-background px-3 text-[12px] font-medium text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            {t("settings.privacy.manageAgent", lang)}
          </a>
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
          <dl className="rounded-lg border border-border/60 px-4">
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
              label={t("settings.privacy.legal.terms", lang)}
              value={`${t("settings.privacy.legal.termsAcceptedOn", lang)} ${formatAccountDate(user.date_joined, lang, user.localization?.date_format)}`}
            />
            <DataRow
              label={t("settings.privacy.legal.license", lang)}
              value={licenseStatus}
            />
          </dl>
          <div className="mt-3 rounded-lg border border-border/60 px-4">
            <ToggleRow
              label={t("settings.privacy.legal.marketingConsent", lang)}
              hint={t("settings.privacy.legal.marketingConsentHint", lang)}
              checked={marketingConsent}
              onChange={handleMarketingConsent}
              disabled={marketingSaving}
            />
          </div>
          {marketingError && <p className="mt-2 text-[12px] text-destructive" role="alert">{marketingError}</p>}
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
  const [push, setPush] = React.useState(pd?.push_notifications ?? false);
  const [processing, setProcessing] = React.useState(pd?.notify_processing_complete ?? true);
  const [processingFailed, setProcessingFailed] = React.useState(pd?.notify_processing_failed ?? true);
  const [uploadLanded, setUploadLanded] = React.useState(pd?.notify_upload_landed ?? false);
  const [sound, setSound] = React.useState(pd?.notification_sound ?? true);
  const [quietHours, setQuietHours] = React.useState(Boolean(
    pd?.notification_quiet_hours_start
    && pd?.notification_quiet_hours_end,
  ));
  const [quietStart, setQuietStart] = React.useState(
    pd?.notification_quiet_hours_start?.slice(0, 5) ?? "22:00",
  );
  const [quietEnd, setQuietEnd] = React.useState(
    pd?.notification_quiet_hours_end?.slice(0, 5) ?? "08:00",
  );
  const [browserPushState, setBrowserPushState] = React.useState<WebPushState>("available");
  const [browserPushBusy, setBrowserPushBusy] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [success, setSuccess] = React.useState(false);
  const saveRevision = React.useRef(0);
  const confirmedSyncSignature = React.useRef<string | null>(null);
  useAutoDismiss(success, setSuccess);

  const applyConfirmedPreferences = React.useCallback((value: PersonalizedData | null | undefined) => {
    confirmedSyncSignature.current = JSON.stringify([
      value?.notifications_enabled ?? true,
      value?.email_notifications ?? true,
      value?.push_notifications ?? false,
      value?.notify_processing_complete ?? true,
      value?.notify_processing_failed ?? true,
      value?.notify_upload_landed ?? false,
      value?.notification_sound ?? true,
      Boolean(value?.notification_quiet_hours_start && value?.notification_quiet_hours_end),
      value?.notification_quiet_hours_start?.slice(0, 5) ?? "22:00",
      value?.notification_quiet_hours_end?.slice(0, 5) ?? "08:00",
    ]);
    setEnabled(value?.notifications_enabled ?? true);
    setEmail(value?.email_notifications ?? true);
    setPush(value?.push_notifications ?? false);
    setProcessing(value?.notify_processing_complete ?? true);
    setProcessingFailed(value?.notify_processing_failed ?? true);
    setUploadLanded(value?.notify_upload_landed ?? false);
    setSound(value?.notification_sound ?? true);
    setQuietHours(Boolean(
      value?.notification_quiet_hours_start
      && value?.notification_quiet_hours_end,
    ));
    setQuietStart(value?.notification_quiet_hours_start?.slice(0, 5) ?? "22:00");
    setQuietEnd(value?.notification_quiet_hours_end?.slice(0, 5) ?? "08:00");
  }, []);

  React.useEffect(() => {
    applyConfirmedPreferences(pd);
  }, [applyConfirmedPreferences, pd]);

  React.useEffect(() => {
    let active = true;
    void getWebPushStateForUser(user.id).then((state) => {
      if (active) setBrowserPushState(state);
    });
    return () => { active = false; };
  }, [user.id]);

  const toggleThisBrowser = React.useCallback(async (value: boolean) => {
    setBrowserPushBusy(true);
    setError(null);
    try {
      if (!value) {
        await disableWebPushForUser(user.id);
        setBrowserPushState("available");
        return;
      }
      const result = await enableWebPushForUser(user.id);
      if (result.status === "enabled") {
        setBrowserPushState("enabled");
        if (!push) setPush(true);
        setSuccess(true);
      } else if (result.status === "denied") {
        setBrowserPushState("denied");
        setError(t("settings.notifications.browserDenied", lang));
      } else if (result.status === "unsupported") {
        setBrowserPushState("unsupported");
        setError(t("settings.notifications.browserUnsupported", lang));
      } else if (result.status === "not_configured") {
        setError(t("settings.notifications.browserUnavailable", lang));
      } else {
        setError(t("settings.notifications.browserFailed", lang));
      }
    } finally {
      setBrowserPushBusy(false);
    }
  }, [lang, push, user.id]);

  // Auto-save on any change (debounced to avoid rapid fire)
  const isFirstRender = React.useRef(true);
  React.useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      confirmedSyncSignature.current = null;
      return;
    }
    const currentSignature = JSON.stringify([
      enabled,
      email,
      push,
      processing,
      processingFailed,
      uploadLanded,
      sound,
      quietHours,
      quietStart,
      quietEnd,
    ]);
    if (confirmedSyncSignature.current === currentSignature) {
      confirmedSyncSignature.current = null;
      return;
    }
    confirmedSyncSignature.current = null;
    const timeout = setTimeout(() => {
      const revision = ++saveRevision.current;
      setSaving(true);
      setError(null);
      updatePersonalizedData({
        notifications_enabled: enabled,
        email_notifications: email,
        push_notifications: push,
        notify_processing_complete: processing,
        notify_processing_failed: processingFailed,
        notify_upload_landed: uploadLanded,
        notification_sound: sound,
        notification_quiet_hours_start: quietHours
          ? `${quietStart || "22:00"}:00`
          : null,
        notification_quiet_hours_end: quietHours
          ? `${quietEnd || "08:00"}:00`
          : null,
        notification_timezone: Intl.DateTimeFormat()
          .resolvedOptions().timeZone || "UTC",
      })
        .then((saved) => {
          if (revision !== saveRevision.current) return;
          applyConfirmedPreferences(saved);
          setSuccess(true);
          onSaved();
        })
        .catch((err) => {
          if (revision !== saveRevision.current) return;
          applyConfirmedPreferences(pd);
          setError(getSafeApiErrorMessage(err, lang));
        })
        .finally(() => {
          if (revision === saveRevision.current) setSaving(false);
        });
    }, 400);
    return () => clearTimeout(timeout);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    enabled,
    email,
    push,
    processing,
    processingFailed,
    uploadLanded,
    sound,
    quietHours,
    quietStart,
    quietEnd,
  ]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("settings.notifications.title", lang)}</CardTitle>
        <CardDescription>{t("settings.notifications.subtitle", lang)}</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-1">
          <div className="divide-y divide-border/60">
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
                  label={t("settings.notifications.push", lang)}
                  hint={t("settings.notifications.pushHint", lang)}
                  checked={push}
                  onChange={setPush}
                />
                {push && (
                  <ToggleRow
                    label={t("settings.notifications.thisBrowser", lang)}
                    hint={
                      browserPushState === "denied"
                        ? t("settings.notifications.browserDenied", lang)
                        : browserPushState === "unsupported"
                          ? t("settings.notifications.browserUnsupported", lang)
                          : t("settings.notifications.thisBrowserHint", lang)
                    }
                    checked={browserPushState === "enabled"}
                    onChange={(value) => { void toggleThisBrowser(value); }}
                    disabled={
                      browserPushBusy
                      || browserPushState === "denied"
                      || browserPushState === "unsupported"
                    }
                  />
                )}
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
                  label={t("settings.notifications.uploadLanded", lang)}
                  hint={t("settings.notifications.uploadLandedHint", lang)}
                  checked={uploadLanded}
                  onChange={setUploadLanded}
                />
                <ToggleRow
                  label={t("settings.notifications.sound", lang)}
                  checked={sound}
                  onChange={setSound}
                />
                <ToggleRow
                  label={t("settings.notifications.quietHours", lang)}
                  hint={t("settings.notifications.quietHoursHint", lang)}
                  checked={quietHours}
                  onChange={setQuietHours}
                />
                {quietHours && (
                  <div className="grid grid-cols-2 gap-3 py-3.5">
                    <SettingsField label={t("settings.notifications.quietFrom", lang)}>
                      <Input
                        type="time"
                        value={quietStart}
                        onChange={(event) => setQuietStart(event.target.value)}
                      />
                    </SettingsField>
                    <SettingsField label={t("settings.notifications.quietUntil", lang)}>
                      <Input
                        type="time"
                        value={quietEnd}
                        onChange={(event) => setQuietEnd(event.target.value)}
                      />
                    </SettingsField>
                  </div>
                )}
              </>
            )}
          </div>

          {/* Status feedback */}
          <div className="min-h-6 pt-3">
            {saving && <p className="text-[12px] text-muted-foreground">{t("common.saving", lang)}</p>}
            {error && <p className="text-[12px] text-destructive">{error}</p>}
            {success && !saving && <p className="text-[12px] text-success">{t("settings.notifications.saved", lang)}</p>}
          </div>
        </div>
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
    <div className={`flex items-start justify-between gap-4 py-2.5 ${disabled ? "opacity-60" : ""}`}>
      <div className="min-w-0 pr-2">
        <p id={labelId} className="text-sm font-medium">{label}</p>
        {hint && <p id={hintId} className="text-[12px] text-muted-foreground mt-0.5">{hint}</p>}
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

function flattenUnits(grouped: { METRIC?: PreferenceOption[]; IMPERIAL?: PreferenceOption[] } | null | undefined): PreferenceOption[] {
  if (!grouped) return [];
  return [...(grouped.METRIC ?? []), ...(grouped.IMPERIAL ?? [])];
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
      {hint && <p className="text-[12px] leading-4 text-muted-foreground">{hint}</p>}
    </div>
  );
}

function LocalizationTab({ user, lang }: { user: UserProfile; lang: string }) {
  const loc = user.localization;
  const [language, setLanguage] = React.useState(loc?.language ?? "en");
  const [currency, setCurrency] = React.useState(loc?.currency ?? "");
  const [areaUnit, setAreaUnit] = React.useState(loc?.area_unit ?? "");
  const [distanceUnit, setDistanceUnit] = React.useState(loc?.distance_unit ?? "");
  const browserTz = typeof Intl !== "undefined" ? Intl.DateTimeFormat().resolvedOptions().timeZone : "UTC";
  const [timezone, setTimezone] = React.useState(loc?.timezone || browserTz);
  const [dateFormat, setDateFormat] = React.useState(loc?.date_format ?? "EU");
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [prefs, setPrefs] = React.useState<AvailablePreferences | null>(null);
  const [prefsLoading, setPrefsLoading] = React.useState(true);
  const [prefsError, setPrefsError] = React.useState(false);

  const loadPrefs = React.useCallback(() => {
    setPrefsLoading(true);
    setPrefsError(false);
    getAvailablePreferences()
      .then((available) => {
        setPrefs(available);
        setCurrency((current) => current || available.currencies[0]?.code || "");
        setAreaUnit((current) => current || flattenUnits(available.area_units)[0]?.code || "");
        setDistanceUnit((current) => current || flattenUnits(available.distance_units)[0]?.code || "");
      })
      .catch(() => setPrefsError(true))
      .finally(() => setPrefsLoading(false));
  }, []);

  React.useEffect(() => { loadPrefs(); }, [loadPrefs]);

  React.useEffect(() => {
    setLanguage(loc?.language ?? "en");
    setCurrency(loc?.currency ?? "");
    setAreaUnit(loc?.area_unit ?? "");
    setDistanceUnit(loc?.distance_unit ?? "");
    setTimezone(loc?.timezone || browserTz);
    setDateFormat(loc?.date_format ?? "EU");
  }, [loc, browserTz]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
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

  const languages = prefs?.languages ?? [];
  const currencies = prefs?.currencies ?? [];
  const areaUnits = prefs ? flattenUnits(prefs.area_units) : [];
  const distanceUnits = prefs ? flattenUnits(prefs.distance_units) : [];
  const dateFormats = prefs?.date_formats ?? [];
  const timezones = prefs?.timezones ?? [];
  const formattedDateSample = dateFormats.find((d) => d.code === dateFormat)?.name ?? dateFormat;
  const formattedAreaSample = `82 ${symbolFor(areaUnits, areaUnit)}`;
  const formattedDistanceSample = `1.4 ${symbolFor(distanceUnits, distanceUnit)}`;

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("settings.localization.title", lang)}</CardTitle>
        <CardDescription>{t("settings.localization.subtitle", lang)}</CardDescription>
      </CardHeader>
      <CardContent>
        {prefsLoading ? (
          <p className="py-8 text-center text-sm text-muted-foreground">{t("settings.localization.loading", lang)}</p>
        ) : prefsError ? (
          <div className="flex flex-col items-center gap-3 py-8">
            <p className="text-sm text-destructive">{t("settings.localization.loadError", lang)}</p>
            <Button type="button" variant="outline" size="sm" onClick={loadPrefs}>{t("settings.localization.retry", lang)}</Button>
          </div>
        ) : (
        <form className="space-y-4" onSubmit={handleSubmit}>
          <div className="rounded-lg border border-border/60 bg-muted/20 px-4 py-3">
            <p className="text-[13px] font-medium">{t("settings.localization.preview", lang)}</p>
            <div className="mt-2 grid grid-cols-1 gap-x-4 gap-y-1 text-[12px] sm:grid-cols-2">
              <p className="text-muted-foreground">{t("settings.localization.previewDate", lang)} <span className="font-medium text-foreground">{formattedDateSample}</span></p>
              <p className="text-muted-foreground">{t("settings.localization.previewCurrency", lang)} <span className="font-medium text-foreground">{currency}</span></p>
              <p className="text-muted-foreground">{t("settings.localization.previewArea", lang)} <span className="font-medium text-foreground">{formattedAreaSample}</span></p>
              <p className="text-muted-foreground">{t("settings.localization.previewDistance", lang)} <span className="font-medium text-foreground">{formattedDistanceSample}</span></p>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <SettingsField label={t("settings.localization.language", lang)}>
              <Select value={language} onValueChange={setLanguage}>
                <SelectTrigger aria-label={t("settings.localization.language", lang)}><SelectValue /></SelectTrigger>
                <SelectContent>
                  {languages.map((l) => (
                    <SelectItem key={l.code} value={l.code}>{stableOptionLabel(l)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </SettingsField>
            <SettingsField label={t("settings.localization.timezone", lang)}>
              <Select value={timezone} onValueChange={setTimezone}>
                <SelectTrigger aria-label={t("settings.localization.timezone", lang)}><SelectValue placeholder={timezone || "—"} /></SelectTrigger>
                <SelectContent>
                  {timezones.map((tz) => (
                    <SelectItem key={tz.code} value={tz.code}>{tz.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </SettingsField>
          </div>

          <Separator />

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <SettingsField label={t("settings.localization.currency", lang)}>
              <Select value={currency} onValueChange={setCurrency}>
                <SelectTrigger aria-label={t("settings.localization.currency", lang)}><SelectValue /></SelectTrigger>
                <SelectContent>
                  {currencies.map((c) => (
                    <SelectItem key={c.code} value={c.code}>
                      {stableOptionLabel(c)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </SettingsField>
            <SettingsField label={t("settings.localization.dateFormat", lang)}>
              <Select value={dateFormat} onValueChange={setDateFormat}>
                <SelectTrigger aria-label={t("settings.localization.dateFormat", lang)}><SelectValue /></SelectTrigger>
                <SelectContent>
                  {dateFormats.map((d) => (
                    <SelectItem key={d.code} value={d.code}>{d.code} · {d.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </SettingsField>
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <SettingsField label={t("settings.localization.areaUnit", lang)}>
              <Select value={areaUnit} onValueChange={setAreaUnit}>
                <SelectTrigger aria-label={t("settings.localization.areaUnit", lang)}><SelectValue /></SelectTrigger>
                <SelectContent>
                  {areaUnits.map((u) => (
                    <SelectItem key={u.code} value={u.code}>
                      {stableOptionLabel(u)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </SettingsField>
            <SettingsField label={t("settings.localization.distanceUnit", lang)}>
              <Select value={distanceUnit} onValueChange={setDistanceUnit}>
                <SelectTrigger aria-label={t("settings.localization.distanceUnit", lang)}><SelectValue /></SelectTrigger>
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
          <div className="pt-2">
            <Button type="submit" size="sm" loading={loading}>{t("settings.localization.save", lang)}</Button>
          </div>
        </form>
        )}
      </CardContent>
    </Card>
  );
}

/* ── Billing Tab ─────────────────────────────────────────────────────── */

function UsageBar({ current, max, label, unit }: { current: number; max: number; label: string; unit?: string }) {
  // 0 = not applicable and -1 = unlimited; neither draws a fill.
  const unlimited = max <= 0;
  const pct = unlimited ? 0 : Math.min((current / max) * 100, 100);
  const color = pct >= 100 ? "bg-destructive" : pct >= 75 ? "bg-foreground/60" : "bg-success";
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between text-[12px]">
        <span className="font-medium">{label}</span>
        <span className="text-muted-foreground">
          {current}{unit ? ` ${unit}` : ""} / {unlimited ? "∞" : `${max}${unit ? ` ${unit}` : ""}`}
        </span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
        <div className={cn("h-full rounded-full transition-all", color)} style={{ width: unlimited ? "0%" : `${pct}%` }} />
      </div>
    </div>
  );
}

const tierBadgeColors: Record<string, string> = {
  FREE: "bg-muted text-muted-foreground",
  STANDARD: "bg-foreground/[0.05] text-foreground/65",
  PRO: "bg-foreground/[0.07] text-foreground/72",
  ENTERPRISE: "bg-foreground/[0.09] text-foreground/80",
};

function tierBadgeKey(code: string, lang: string): string {
  const map: Record<string, string> = {
    FREE: t("settings.billing.badgeFree", lang),
    STANDARD: t("settings.billing.badgeStandard", lang),
    PRO: t("settings.billing.badgePro", lang),
    ENTERPRISE: t("settings.billing.badgeEnterprise", lang),
  };
  return map[code.toUpperCase()] ?? code;
}

function BillingTab({ user, onSaved, lang }: { user: UserProfile; onSaved: () => void; lang: string }) {
  const ba = user.billing_account;
  const tier = ba?.subscription_tier_detail;
  const tierCode = tier?.code?.toUpperCase() ?? "FREE";

  // Billing address form
  const [billingName, setBillingName] = React.useState(ba?.billing_name ?? "");
  const [billingEmail, setBillingEmail] = React.useState(ba?.billing_email ?? "");
  const [billingAddress, setBillingAddress] = React.useState(ba?.billing_address ?? "");
  const [billingCity, setBillingCity] = React.useState(ba?.billing_city ?? "");
  const [billingPostal, setBillingPostal] = React.useState(ba?.billing_postal_code ?? "");
  const [billingCountry, setBillingCountry] = React.useState(ba?.billing_country ?? "");
  const [vat, setVat] = React.useState(ba?.vat_number ?? "");
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [success, setSuccess] = React.useState(false);
  useAutoDismiss(success, setSuccess);

  React.useEffect(() => {
    setBillingName(ba?.billing_name ?? "");
    setBillingEmail(ba?.billing_email ?? "");
    setBillingAddress(ba?.billing_address ?? "");
    setBillingCity(ba?.billing_city ?? "");
    setBillingPostal(ba?.billing_postal_code ?? "");
    setBillingCountry(ba?.billing_country ?? "");
    setVat(ba?.vat_number ?? "");
  }, [ba]);

  const hasAddressData = !!(billingName || billingEmail || billingAddress || billingCity || billingPostal || billingCountry || vat);

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
        billing_postal_code: billingPostal.trim(),
        billing_country: billingCountry.trim(),
        vat_number: vat.trim(),
      });
      setSuccess(true);
      onSaved();
    } catch (err) {
      setError(getSafeApiErrorMessage(err, lang));
    } finally {
      setLoading(false);
    }
  }

  const cycleLabel = ba?.billing_cycle === "monthly"
    ? t("settings.billing.cycleMonthly", lang)
    : ba?.billing_cycle === "yearly"
      ? t("settings.billing.cycleYearly", lang)
      : t("settings.billing.cycleNa", lang);

  const maxPosts = tier?.max_posts ?? 0;
  const currentPosts = ba?.current_posts_count ?? 0;
  const credits = ba?.compute_credits ?? null;
  const trialActive = ba?.subscription_status === "trial" && !!ba?.trial_ends_at;
  const trialDaysLeft = trialActive
    ? Math.max(
        0,
        Math.ceil(
          (new Date(ba!.trial_ends_at as string).getTime() - Date.now()) /
            86_400_000,
        ),
      )
    : null;

  return (
    <div className="space-y-6">
      {/* Plan Info */}
      <Card>
        <CardHeader>
          <CardTitle>{t("settings.billing.title", lang)}</CardTitle>
          <CardDescription>{t("settings.billing.subtitle", lang)}</CardDescription>
        </CardHeader>
        <CardContent>
          <dl className="rounded-lg border border-border/60 px-4">
            <DataRow
              label={t("settings.billing.plan", lang)}
              value={
                <span className="flex items-center gap-2">
                  {tier?.name ?? "—"}
                  <span className={cn("rounded-full px-2.5 py-0.5 text-[11px] font-semibold", tierBadgeColors[tierCode] ?? tierBadgeColors.FREE)}>
                    {tierBadgeKey(tierCode, lang)}
                  </span>
                </span>
              }
            />
            <DataRow label={t("settings.billing.status", lang)} value={ba?.subscription_status ?? "—"} />
            <DataRow label={t("settings.billing.cycle", lang)} value={cycleLabel} />
            {trialActive && trialDaysLeft != null && (
              <DataRow label={t("settings.billing.trial", lang)} value={`${trialDaysLeft} ${t("settings.billing.trialDaysLeft", lang)}`} />
            )}
            {tier?.is_custom_pricing && (
              <DataRow label={t("settings.billing.pricing", lang)} value={t("settings.billing.customPricing", lang)} />
            )}
            <DataRow label={t("settings.billing.provider", lang)} value={ba?.payment_provider || t("common.none", lang)} />
          </dl>
        </CardContent>
      </Card>

      {/* Usage — storage is intentionally absent: it is counted internally
          but is not a tier limit. */}
      <Card>
        <CardHeader>
          <CardTitle>{t("settings.billing.usageTitle", lang)}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4 rounded-lg border border-border/60 p-4">
            <UsageBar current={currentPosts} max={maxPosts} label={t("settings.billing.posts", lang)} />
          </div>
        </CardContent>
      </Card>

      {/* Compute credits */}
      {credits && (
        <Card>
          <CardHeader>
            <CardTitle>{t("settings.billing.creditsTitle", lang)}</CardTitle>
            <CardDescription>{t("settings.billing.creditsSubtitle", lang)}</CardDescription>
          </CardHeader>
          <CardContent>
            <dl className="rounded-lg border border-border/60 px-4">
              <DataRow
                label={t("settings.billing.creditsTotal", lang)}
                value={
                  credits.unlimited
                    ? t("settings.billing.creditsUnlimited", lang)
                    : String(credits.total)
                }
              />
              {!credits.unlimited && (
                <>
                  <DataRow
                    label={t("settings.billing.creditsIncluded", lang)}
                    value={`${credits.included} / ${credits.monthly_allowance}`}
                  />
                  <DataRow
                    label={t("settings.billing.creditsPurchased", lang)}
                    value={String(credits.purchased)}
                  />
                </>
              )}
            </dl>
          </CardContent>
        </Card>
      )}

      {/* Billing Address */}
      <Card>
        <CardHeader>
          <CardTitle>{t("settings.billing.addressTitle", lang)}</CardTitle>
          <CardDescription>{t("settings.billing.addressSubtitle", lang)}</CardDescription>
        </CardHeader>
        <CardContent>
          <CollapsibleSection title={t("settings.billing.addressTitle", lang)} defaultOpen={hasAddressData}>
            <form className="space-y-4" onSubmit={handleSubmit}>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label>{t("settings.billing.name", lang)}</Label>
                  <Input value={billingName} onChange={(e) => setBillingName(e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label>{t("settings.billing.email", lang)}</Label>
                  <Input value={billingEmail} onChange={(e) => setBillingEmail(e.target.value)} type="email" />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>{t("settings.billing.address", lang)}</Label>
                <Input value={billingAddress} onChange={(e) => setBillingAddress(e.target.value)} />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                <div className="space-y-1.5">
                  <Label>{t("settings.billing.city", lang)}</Label>
                  <Input value={billingCity} onChange={(e) => setBillingCity(e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label>{t("settings.billing.postalCode", lang)}</Label>
                  <Input value={billingPostal} onChange={(e) => setBillingPostal(e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label>{t("settings.billing.country", lang)}</Label>
                  <Input value={billingCountry} onChange={(e) => setBillingCountry(e.target.value)} maxLength={2} placeholder="SK" />
                </div>
                <div className="space-y-1.5">
                  <Label>{t("settings.billing.vat", lang)}</Label>
                  <Input value={vat} onChange={(e) => setVat(e.target.value)} />
                </div>
              </div>
              {error && <p className="text-[12px] text-destructive">{error}</p>}
              {success && <p className="text-[12px] text-success">{t("settings.billing.saved", lang)}</p>}
              <div className="pt-2">
                <Button type="submit" size="sm" loading={loading}>{t("settings.billing.save", lang)}</Button>
              </div>
            </form>
          </CollapsibleSection>
        </CardContent>
      </Card>
    </div>
  );
}

/* ── Security Tab ────────────────────────────────────────────────────── */

function SecurityTab({ user, onSaved, lang }: { user: UserProfile; onSaved: () => void; lang: string }) {
  return (
    <div className="space-y-6">
      <PasswordSection hasExistingPassword={user.has_password} lang={lang} />
      <TwoFactorSection lang={lang} />
      <DevicesSection lang={lang} />
      <LinkedAccountsSection lang={lang} />
      <PhoneSection user={user} onSaved={onSaved} lang={lang} />
    </div>
  );
}

function PasswordSection({ hasExistingPassword, lang }: { hasExistingPassword: boolean; lang: string }) {
  const [sheetOpen, setSheetOpen] = React.useState(false);
  const [currentPassword, setCurrentPassword] = React.useState("");
  const [newPassword, setNewPassword] = React.useState("");
  const [confirmPassword, setConfirmPassword] = React.useState("");
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [success, setSuccess] = React.useState(false);
  useAutoDismiss(success, setSuccess);
  const passwordReused = hasExistingPassword && newPassword.length > 0 && newPassword === currentPassword;
  const canSubmit = (!hasExistingPassword || currentPassword.length > 0)
    && newPassword.length >= 8
    && newPassword === confirmPassword
    && !passwordReused;
  const actionLabel = t(hasExistingPassword ? "settings.security.save" : "settings.security.createPassword", lang);

  function handleSheetChange(open: boolean) {
    setSheetOpen(open);
    if (!open) {
      // Half-typed secrets must not survive a dismissed sheet.
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setError(null);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(false);
    if (!canSubmit) return;
    try {
      setLoading(true);
      await changePassword({
        old_password: currentPassword,
        new_password: newPassword,
        new_password_confirm: confirmPassword,
      });
      handleSheetChange(false);
      setSuccess(true);
    } catch (err) {
      setError(getSafeApiErrorMessage(err, lang));
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("settings.security.passwordTitle", lang)}</CardTitle>
        <CardDescription>{t(hasExistingPassword ? "settings.security.passwordSubtitle" : "settings.security.passwordCreateSubtitle", lang)}</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex min-h-11 items-center justify-between gap-4">
          {hasExistingPassword ? (
            <p aria-hidden="true" className="select-none text-[15px] font-medium leading-none tracking-[0.22em] text-foreground/70">
              ••••••••••
            </p>
          ) : (
            <span aria-hidden="true" />
          )}
          <Button type="button" variant="outline" size="sm" className="shrink-0" onClick={() => setSheetOpen(true)}>
            {actionLabel}
          </Button>
        </div>
        {success && <p className="mt-2 text-[12px] text-success" role="status">{t("settings.security.saved", lang)}</p>}
      </CardContent>

      <BottomSheet
        open={sheetOpen}
        onOpenChange={handleSheetChange}
        title={actionLabel}
        description={hasExistingPassword ? undefined : t("settings.security.passwordCreateSubtitle", lang)}
      >
        <form className="space-y-4" onSubmit={handleSubmit}>
          {hasExistingPassword && (
            <>
              <div className="space-y-1.5">
                <Label htmlFor="current-password">{t("settings.security.currentPassword", lang)}</Label>
                <Input id="current-password" type="password" value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)} autoComplete="current-password" />
              </div>
              <Separator />
            </>
          )}
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
            <p className="text-[12px] text-destructive">{t("settings.security.mismatch", lang)}</p>
          )}
          {passwordReused && (
            <p className="text-[12px] text-destructive">{t("settings.security.mustDiffer", lang)}</p>
          )}
          {error && <p className="text-[12px] text-destructive" role="alert">{error}</p>}
          <div className="pt-1">
            <Button type="submit" className="w-full" loading={loading} disabled={!canSubmit || loading}>
              {actionLabel}
            </Button>
          </div>
        </form>
      </BottomSheet>
    </Card>
  );
}

function DevicesSection({ lang }: { lang: string }) {
  const [sessions, setSessions] = React.useState<DeviceSession[] | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [busyId, setBusyId] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const load = React.useCallback(() => {
    setLoading(true);
    getDeviceSessions()
      .then((data) => {
        setSessions(data.sessions);
        setError(null);
      })
      .catch((err) => setError(getSafeApiErrorMessage(err, lang)))
      .finally(() => setLoading(false));
  }, [lang]);

  React.useEffect(() => { load(); }, [load]);

  async function handleRevoke(session: DeviceSession) {
    setError(null);
    try {
      setBusyId(session.id);
      const result = await revokeDeviceSession(session.id);
      if (result.was_current) {
        // We just signed ourselves out — clear local state and leave.
        try { await apiLogout(); } catch { /* cookies already dead */ }
        window.location.assign("/");
        return;
      }
      load();
    } catch (err) {
      setError(getSafeApiErrorMessage(err, lang));
    } finally {
      setBusyId(null);
    }
  }

  async function handleRevokeOthers() {
    setError(null);
    try {
      setBusyId("others");
      await revokeOtherDeviceSessions();
      load();
    } catch (err) {
      setError(getSafeApiErrorMessage(err, lang));
    } finally {
      setBusyId(null);
    }
  }

  async function handleRevokeAll() {
    setError(null);
    try {
      setBusyId("all");
      await revokeAllDeviceSessions();
    } catch (err) {
      setError(getSafeApiErrorMessage(err, lang));
      setBusyId(null);
      return;
    }
    // Everything is revoked server-side, this session included — clear
    // local cookies and leave.
    try { await apiLogout(); } catch { /* tokens already dead */ }
    window.location.assign("/");
  }

  if (loading && sessions === null) {
    return (
      <Card aria-busy="true">
        <CardHeader>
          <CardTitle>{t("settings.security.devicesTitle", lang)}</CardTitle>
          <CardDescription>{t("settings.security.devicesSubtitle", lang)}</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex min-h-11 items-center justify-between gap-4" aria-hidden="true">
            <div className="space-y-2">
              <div className="h-3 w-32 animate-pulse rounded-full bg-muted/70 motion-reduce:animate-none" />
              <div className="h-3 w-44 animate-pulse rounded-full bg-muted/45 motion-reduce:animate-none" />
            </div>
            <div className="h-9 w-24 animate-pulse rounded-full bg-muted/55 motion-reduce:animate-none" />
          </div>
        </CardContent>
      </Card>
    );
  }

  const rows = sessions ?? [];
  const others = rows.filter((row) => !row.current);

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("settings.security.devicesTitle", lang)}</CardTitle>
        <CardDescription>{t("settings.security.devicesSubtitle", lang)}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {error && (
          <div className="space-y-2">
            <p className="text-[13px] text-destructive" role="alert">{error}</p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={loading}
              onClick={load}
            >
              {loading ? t("common.loading", lang) : t("common.retry", lang)}
            </Button>
          </div>
        )}
        {!error && (
        <ul className="space-y-2.5">
          {rows.map((session) => (
            <li
              key={session.id}
              className="rounded-2xl border border-border/60 bg-background/60 p-4"
            >
              <div className="flex items-center justify-between gap-3">
                <div className="flex min-w-0 items-start gap-3">
                  <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-muted/70 text-foreground/70">
                    {session.platform === "ios" ? (
                      <DeviceMobileIcon size={16} />
                    ) : (
                      <DeviceDesktopIcon size={16} />
                    )}
                  </span>
                  <div className="min-w-0">
                    <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] font-medium">
                      <span className="truncate">{session.device_label}</span>
                      {session.current && (
                        <span className="whitespace-nowrap rounded-full bg-success/10 px-2.5 py-0.5 text-[11px] font-semibold text-emerald-800">
                          {t("settings.security.devicesThisDevice", lang)}
                        </span>
                      )}
                    </p>
                    <p className="mt-0.5 break-words text-[12px] leading-relaxed text-muted-foreground">
                      {session.ip_address ? `${session.ip_address} · ` : ""}
                      {t("settings.security.devicesLastActive", lang)}{" "}
                      {formatAccountDate(session.last_seen_at, lang)}
                    </p>
                  </div>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="shrink-0 whitespace-nowrap rounded-full"
                  disabled={busyId !== null}
                  onClick={() => handleRevoke(session)}
                >
                  {busyId === session.id
                    ? t("common.loading", lang)
                    : session.current
                      ? t("settings.security.devicesSignOut", lang)
                      : t("settings.security.devicesRevoke", lang)}
                </Button>
              </div>
            </li>
          ))}
          {rows.length === 0 && (
            <li className="rounded-2xl border border-border/60 bg-background/60 p-4 text-[13px] text-muted-foreground">
              {t("settings.security.devicesEmpty", lang)}
            </li>
          )}
        </ul>
        )}
        {!error && (
        <div className="flex flex-wrap gap-2 pt-1">
          {others.length > 0 && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="whitespace-nowrap rounded-full"
              disabled={busyId !== null}
              onClick={handleRevokeOthers}
            >
              {busyId === "others"
                ? t("common.loading", lang)
                : t("settings.security.devicesRevokeOthers", lang)}
            </Button>
          )}
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="whitespace-nowrap rounded-full"
            disabled={busyId !== null}
            onClick={handleRevokeAll}
          >
            {busyId === "all"
              ? t("common.loading", lang)
              : t("settings.security.devicesRevokeAll", lang)}
          </Button>
        </div>
        )}
      </CardContent>
    </Card>
  );
}

function TwoFactorSection({ lang }: { lang: string }) {
  const [status, setStatus] = React.useState<TotpStatus | null>(null);
  const [setup, setSetup] = React.useState<TotpSetupResponse | null>(null);
  const [backupCodes, setBackupCodes] = React.useState<string[] | null>(null);
  const [code, setCode] = React.useState("");
  const [loading, setLoading] = React.useState(false);
  const [fetchLoading, setFetchLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [disabling, setDisabling] = React.useState(false);

  const loadStatus = React.useCallback(() => {
    setFetchLoading(true);
    getTotpStatus()
      .then((nextStatus) => {
        setStatus(nextStatus);
        setError(null);
      })
      .catch((err) => setError(getSafeApiErrorMessage(err, lang)))
      .finally(() => setFetchLoading(false));
  }, [lang]);

  React.useEffect(() => { loadStatus(); }, [loadStatus]);

  async function handleEnable() {
    setError(null);
    try {
      setLoading(true);
      const result = await setupTotp();
      setSetup(result);
    } catch (err) {
      setError(getSafeApiErrorMessage(err, lang));
    } finally {
      setLoading(false);
    }
  }

  async function handleConfirm() {
    if (code.length < 6) return;
    setError(null);
    try {
      setLoading(true);
      const result = await confirmTotp(code);
      setBackupCodes(result.backup_codes ?? null);
      setSetup(null);
      setCode("");
      loadStatus();
    } catch (err) {
      setError(getSafeApiErrorMessage(err, lang));
    } finally {
      setLoading(false);
    }
  }

  async function handleDisable() {
    if (code.length < 6) return;
    setError(null);
    try {
      setLoading(true);
      await disableTotp(code);
      setDisabling(false);
      setCode("");
      loadStatus();
    } catch (err) {
      setError(getSafeApiErrorMessage(err, lang));
    } finally {
      setLoading(false);
    }
  }

  if (fetchLoading) {
    return (
      <Card aria-busy="true">
        <CardHeader>
          <CardTitle>{t("settings.security.twoFaTitle", lang)}</CardTitle>
          <CardDescription>{t("settings.security.twoFaSubtitle", lang)}</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex min-h-11 items-center justify-between gap-4" aria-hidden="true">
            <div className="h-7 w-24 animate-pulse rounded-full bg-muted/70 motion-reduce:animate-none" />
            <div className="h-9 w-28 animate-pulse rounded-full bg-muted/55 motion-reduce:animate-none" />
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!status && error) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{t("settings.security.twoFaTitle", lang)}</CardTitle>
          <CardDescription>{t("settings.security.twoFaSubtitle", lang)}</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between gap-4">
            <p className="text-[12px] text-destructive">{error}</p>
            <Button type="button" variant="outline" size="sm" onClick={loadStatus}>
              {t("common.retry", lang)}
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("settings.security.twoFaTitle", lang)}</CardTitle>
        <CardDescription>{t("settings.security.twoFaSubtitle", lang)}</CardDescription>
      </CardHeader>
      <CardContent>
        {/* Show backup codes after first-time setup */}
        {backupCodes && (
          <div className="space-y-3 mb-4">
            <p className="text-sm font-medium">{t("settings.security.twoFaBackupTitle", lang)}</p>
            <p className="text-[12px] text-muted-foreground">{t("settings.security.twoFaBackupHint", lang)}</p>
            {/* Recovery codes are worthless if they cannot be copied out. */}
            <div className="grid select-all grid-cols-2 gap-1 rounded-lg border border-border p-3 font-mono text-[13px]">
              {backupCodes.map((c) => <span key={c}>{c}</span>)}
            </div>
            <Button type="button" variant="outline" size="sm" onClick={() => setBackupCodes(null)}>
              {t("common.dismiss", lang)}
            </Button>
          </div>
        )}

        {/* Setup flow */}
        {setup && (
          <div className="space-y-4">
            <p className="text-[12px] text-muted-foreground">{t("settings.security.twoFaSetupHint", lang)}</p>
            <div className="space-y-2">
              <Label>{t("settings.security.twoFaSecret", lang)}</Label>
              <Input value={setup.secret} readOnly className="font-mono text-xs" onClick={(e) => (e.target as HTMLInputElement).select()} />
            </div>
            <div className="space-y-2">
              <Label>{t("settings.security.twoFaUri", lang)}</Label>
              <Input value={setup.provisioning_uri} readOnly className="font-mono text-xs" onClick={(e) => (e.target as HTMLInputElement).select()} />
            </div>
            <div className="space-y-2">
              <Label>{t("settings.security.twoFaCode", lang)}</Label>
              <Input
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                placeholder={t("settings.security.twoFaCodePlaceholder", lang)}
                maxLength={6}
                className="w-40 font-mono"
              />
            </div>
            {error && <p className="text-[12px] text-destructive">{error}</p>}
            <div className="flex gap-2">
              <Button type="button" size="sm" loading={loading} disabled={code.length < 6} onClick={handleConfirm}>
                {t("settings.security.twoFaConfirm", lang)}
              </Button>
              <Button type="button" variant="outline" size="sm" onClick={() => { setSetup(null); setCode(""); setError(null); }}>
                {t("settings.security.twoFaCancel", lang)}
              </Button>
            </div>
          </div>
        )}

        {/* Disable flow */}
        {!setup && disabling && (
          <div className="space-y-4">
            <p className="text-[12px] text-muted-foreground">{t("settings.security.twoFaDisableHint", lang)}</p>
            <div className="space-y-2">
              <Label>{t("settings.security.twoFaCode", lang)}</Label>
              <Input
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                placeholder={t("settings.security.twoFaCodePlaceholder", lang)}
                maxLength={6}
                className="w-40 font-mono"
              />
            </div>
            {error && <p className="text-[12px] text-destructive">{error}</p>}
            <div className="flex gap-2">
              <Button type="button" variant="destructive" size="sm" loading={loading} disabled={code.length < 6} onClick={handleDisable}>
                {t("settings.security.twoFaDisable", lang)}
              </Button>
              <Button type="button" variant="outline" size="sm" onClick={() => { setDisabling(false); setCode(""); setError(null); }}>
                {t("settings.security.twoFaCancel", lang)}
              </Button>
            </div>
          </div>
        )}

        {/* Idle state */}
        {!setup && !disabling && !backupCodes && (
          <div className="flex items-center justify-between">
            <span className={cn("rounded-full px-2.5 py-0.5 text-[11px] font-semibold",
              status?.enabled
                ? "bg-success/10 text-emerald-800"
                : "bg-muted text-muted-foreground"
            )}>
              {status?.enabled ? t("settings.security.twoFaEnabled", lang) : t("settings.security.twoFaDisabled", lang)}
            </span>
            {status?.enabled ? (
              <Button type="button" variant="outline" size="sm" onClick={() => setDisabling(true)}>
                {t("settings.security.twoFaDisable", lang)}
              </Button>
            ) : (
              <Button type="button" size="sm" loading={loading} onClick={handleEnable}>
                {t("settings.security.twoFaEnable", lang)}
              </Button>
            )}
          </div>
        )}
        {!setup && !disabling && !backupCodes && error && (
          <p className="mt-2 text-[12px] text-destructive">{error}</p>
        )}
      </CardContent>
    </Card>
  );
}

function LinkedAccountsSection({ lang }: { lang: string }) {
  const [data, setData] = React.useState<LinkedAccountsResponse | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [unlinking, setUnlinking] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const load = React.useCallback(() => {
    setLoading(true);
    getLinkedAccounts()
      .then((nextData) => {
        setData(nextData);
        setError(null);
      })
      .catch((err) => setError(getSafeApiErrorMessage(err, lang)))
      .finally(() => setLoading(false));
  }, [lang]);

  React.useEffect(() => { load(); }, [load]);

  async function handleUnlink(provider: string) {
    setError(null);
    try {
      setUnlinking(provider);
      await unlinkSocialAccount(provider);
      load();
    } catch (err) {
      setError(getSafeApiErrorMessage(err, lang));
    } finally {
      setUnlinking(null);
    }
  }

  if (loading) {
    return (
      <Card aria-busy="true">
        <CardHeader>
          <CardTitle>{t("settings.security.linkedTitle", lang)}</CardTitle>
          <CardDescription>{t("settings.security.linkedSubtitle", lang)}</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex min-h-11 items-center justify-between gap-4" aria-hidden="true">
            <div className="space-y-2">
              <div className="h-3 w-24 animate-pulse rounded-full bg-muted/70 motion-reduce:animate-none" />
              <div className="h-3 w-40 animate-pulse rounded-full bg-muted/45 motion-reduce:animate-none" />
            </div>
            <div className="h-9 w-24 animate-pulse rounded-full bg-muted/55 motion-reduce:animate-none" />
          </div>
        </CardContent>
      </Card>
    );
  }

  const accounts = data?.social_accounts ?? [];
  const canUnlink = data?.has_password || accounts.length > 1;

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("settings.security.linkedTitle", lang)}</CardTitle>
        <CardDescription>{t("settings.security.linkedSubtitle", lang)}</CardDescription>
      </CardHeader>
      <CardContent>
        {!data && error ? (
          <div className="flex items-center justify-between gap-4">
            <p className="text-[12px] text-destructive">{error}</p>
            <Button type="button" variant="outline" size="sm" onClick={load}>
              {t("common.retry", lang)}
            </Button>
          </div>
        ) : null}
        {data && accounts.length === 0 ? (
          <div className="flex items-center gap-3 rounded-2xl bg-muted/30 px-4 py-3.5">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-muted/70 text-foreground/55">
              <LinkIcon size={16} />
            </span>
            <p className="text-[13px] text-muted-foreground">{t("settings.security.linkedNone", lang)}</p>
          </div>
        ) : data ? (
          <div className="divide-y divide-border/60">
            {accounts.map((acc) => (
              <div key={acc.id} className="flex items-center justify-between py-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium capitalize">{acc.provider}</p>
                  <p className="text-[12px] text-muted-foreground truncate">{acc.email}</p>
                </div>
                <div className="shrink-0">
                  {canUnlink ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      loading={unlinking === acc.provider}
                      onClick={() => handleUnlink(acc.provider)}
                    >
                      {t("settings.security.linkedUnlink", lang)}
                    </Button>
                  ) : (
                    <p className="text-[11px] text-muted-foreground">{t("settings.security.linkedOnlyAuth", lang)}</p>
                  )}
                </div>
              </div>
            ))}
          </div>
        ) : null}
        {data && error && <p className="mt-2 text-[12px] text-destructive">{error}</p>}
      </CardContent>
    </Card>
  );
}

function PhoneSection({ user, onSaved, lang }: { user: UserProfile; onSaved: () => void; lang: string }) {
  const phone = user.profile?.phone;
  const phoneDisplay = formatPhoneDisplay(phone);
  const verified = user.phone_verified;
  const [otpSent, setOtpSent] = React.useState(false);
  const [code, setCode] = React.useState("");
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function handleRequestOtp() {
    if (!phone) return;
    setError(null);
    try {
      setLoading(true);
      await requestPhoneLinkOtp(phone);
      setOtpSent(true);
    } catch (err) {
      setError(getSafeApiErrorMessage(err, lang));
    } finally {
      setLoading(false);
    }
  }

  async function handleVerify() {
    if (!phone || !code) return;
    setError(null);
    try {
      setLoading(true);
      await verifyPhoneLinkOtp({ phone, code });
      setOtpSent(false);
      setCode("");
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
        <CardTitle>{t("settings.security.phoneTitle", lang)}</CardTitle>
        <CardDescription>{t("settings.security.phoneSubtitle", lang)}</CardDescription>
      </CardHeader>
      <CardContent>
        {!phone ? (
          <div className="flex items-center gap-3 rounded-2xl bg-muted/30 px-4 py-3.5">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-muted/70 text-foreground/55">
              <DeviceMobileIcon size={16} />
            </span>
            <p className="text-[13px] text-muted-foreground">{t("settings.security.phoneNoPhone", lang)}</p>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex min-h-11 items-center justify-between gap-4">
              <div className="flex min-w-0 items-center gap-3">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-muted/70 text-foreground/70">
                  {phoneDisplay.flag ? (
                    <span aria-hidden="true" className="text-[17px] leading-none">{phoneDisplay.flag}</span>
                  ) : (
                    <DeviceMobileIcon size={16} />
                  )}
                </span>
                <span className="min-w-0 truncate text-sm font-medium tabular-nums">{phoneDisplay.display}</span>
              </div>
              {verified ? (
                <span className="shrink-0 rounded-full bg-success/10 px-2.5 py-0.5 text-[11px] font-semibold text-emerald-800">
                  {t("settings.security.phoneVerified", lang)}
                </span>
              ) : otpSent ? (
                <span className="shrink-0 rounded-full bg-foreground/[0.07] px-2.5 py-0.5 text-[11px] font-semibold text-foreground/70">
                  {t("settings.security.phoneUnverified", lang)}
                </span>
              ) : (
                <Button type="button" variant="outline" size="sm" className="shrink-0" loading={loading} onClick={handleRequestOtp}>
                  {t("settings.security.phoneVerify", lang)}
                </Button>
              )}
            </div>

            {otpSent && (
              <div className="space-y-2 rounded-2xl border border-border/60 bg-muted/20 p-4">
                <Label htmlFor="phone-otp-code">{t("settings.security.phoneOtpSent", lang)}</Label>
                <div className="flex items-center gap-2">
                  <Input
                    id="phone-otp-code"
                    value={code}
                    onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                    placeholder={t("settings.security.phoneOtpPlaceholder", lang)}
                    maxLength={6}
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    className="w-full max-w-[10.5rem] font-mono tracking-[0.2em]"
                  />
                  <Button type="button" size="sm" className="shrink-0" loading={loading} disabled={code.length < 4} onClick={handleVerify}>
                    {t("settings.security.phoneOtpConfirm", lang)}
                  </Button>
                </div>
              </div>
            )}

            {error && <p className="text-[12px] text-destructive" role="alert">{error}</p>}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/* ── Settings Form (main export) ─────────────────────────────────────── */

export function SettingsForm({ user, onSaved }: { user: UserProfile; onSaved: () => void }) {
  const lang = getUserLanguage(user.localization);
  const [activeTab, setActiveTab] = React.useState("profile");
  React.useEffect(() => {
    const sections = ["profile", "seller", "privacy", "reai", "localization", "notifications", "billing", "security"];
    const selectSection = (section: string) => {
      if (!sections.includes(section)) return;
      setActiveTab(section);
      window.history.replaceState(null, "", `#${section}`);
    };
    const selectHashTab = () => {
      selectSection(window.location.hash.slice(1));
    };
    const navigateFromAgent = (event: Event) => {
      const section = (event as CustomEvent<{ section?: string }>).detail?.section;
      if (section) selectSection(section);
    };
    selectHashTab();
    window.addEventListener("hashchange", selectHashTab);
    window.addEventListener("reai-settings-navigate", navigateFromAgent);
    return () => {
      window.removeEventListener("hashchange", selectHashTab);
      window.removeEventListener("reai-settings-navigate", navigateFromAgent);
    };
  }, []);
  // Desktop settings navigation is a stable vertical list. Compact layouts
  // use the selector below instead of hiding destinations in a chip carousel.
  const triggerClassName =
    "h-11 w-full justify-start rounded-full border border-transparent bg-transparent px-4 py-0 text-left text-[13px] font-medium text-foreground/58 shadow-none transition-all hover:bg-foreground/[0.035] hover:text-foreground/80 data-[state=active]:border-foreground/15 data-[state=active]:bg-muted/70 data-[state=active]:text-foreground data-[state=active]:shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_5px_14px_rgba(32,29,25,0.09)] data-[state=active]:backdrop-blur-xl";
  const settingsTabs = [
    { value: "profile", label: "settings.tab.profile" },
    { value: "seller", label: "settings.tab.seller" },
    { value: "privacy", label: "settings.tab.privacy" },
    { value: "reai", label: "settings.tab.reai" },
    { value: "localization", label: "settings.tab.localization" },
    { value: "notifications", label: "settings.tab.notifications" },
    { value: "billing", label: "settings.tab.billing" },
    { value: "security", label: "settings.tab.security" },
  ] as const;

  return (
    <Tabs
      value={activeTab}
      onValueChange={(value) => {
        setActiveTab(value);
        window.history.replaceState(null, "", `#${value}`);
      }}
      className="settings-surface w-full lg:grid lg:grid-cols-[210px_minmax(0,1fr)] lg:items-stretch lg:overflow-hidden lg:rounded-[26px] lg:border lg:border-border/65 lg:bg-card lg:shadow-card"
    >
      <div className="mb-5 lg:mb-0 lg:h-full lg:border-r lg:border-border/60 lg:bg-card lg:p-3">
        <div className="lg:hidden">
          <Select
            value={activeTab}
            onValueChange={(value) => {
              setActiveTab(value);
              window.history.replaceState(null, "", `#${value}`);
            }}
          >
            <SelectTrigger
              aria-label={t("settings.title", lang)}
              className="h-12 rounded-2xl border-border/65 bg-card px-4 font-medium shadow-card"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {settingsTabs.map((tab) => (
                <SelectItem key={tab.value} value={tab.value}>
                  {t(tab.label, lang)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <TabsList
          className="hidden min-h-0 w-full flex-col items-stretch justify-start gap-1 rounded-none border-0 bg-transparent p-0 text-muted-foreground shadow-none lg:flex lg:h-auto"
        >
          {settingsTabs.map((tab) => (
            <TabsTrigger key={tab.value} value={tab.value} className={triggerClassName}>
              <span className="min-w-0 truncate">{t(tab.label, lang)}</span>
            </TabsTrigger>
          ))}
        </TabsList>
      </div>
      <div className="min-w-0 max-lg:[&_button]:min-h-11 lg:p-3">
        <TabsContent value="profile" className="mt-0">
          <ProfileTab user={user} onSaved={onSaved} lang={lang} />
        </TabsContent>
        <TabsContent value="seller" className="mt-0">
          <SellerTab user={user} onSaved={onSaved} lang={lang} />
        </TabsContent>
        <TabsContent value="privacy" className="mt-0">
          <PrivacyTab user={user} onSaved={onSaved} lang={lang} />
        </TabsContent>
        <TabsContent value="reai" className="mt-0">
          <ReaiTab lang={lang} />
        </TabsContent>
        <TabsContent value="localization" className="mt-0">
          <LocalizationTab user={user} lang={lang} />
        </TabsContent>
        <TabsContent value="notifications" className="mt-0">
          <NotificationsTab user={user} onSaved={onSaved} lang={lang} />
        </TabsContent>
        <TabsContent value="billing" className="mt-0">
          <BillingTab user={user} onSaved={onSaved} lang={lang} />
        </TabsContent>
        <TabsContent value="security" className="mt-0">
          <SecurityTab user={user} onSaved={onSaved} lang={lang} />
        </TabsContent>
      </div>
    </Tabs>
  );
}
