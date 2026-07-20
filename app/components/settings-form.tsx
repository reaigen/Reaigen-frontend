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
import {
  updateProfile,
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
  type AvailablePreferences,
  type PreferenceOption,
  type TotpStatus,
  type TotpSetupResponse,
  type LinkedAccountsResponse,
  type ReaiAgentConsent,
  type ReaiToolCode,
  type ReaiToolPermissions,
  type ReaiImprovementConsent,
} from "../lib/api/client";
import { getSafeApiErrorMessage } from "../lib/api/error-message";
import type { LocaleKey } from "../lib/locales";
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

// Grouped card, mirroring the iOS app's Settings LiquidCard sections.
function Card({ className, ...props }: React.HTMLAttributes<HTMLElement>) {
  return (
    <section
      className={cn("mt-4 rounded-xl border border-border/60 bg-surface p-5 shadow-card first:mt-0", className)}
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
        className="flex w-full items-center justify-between py-2 text-[14px] font-semibold text-foreground/80 hover:text-foreground"
        onClick={() => setOpen(!open)}
      >
        {title}
        <svg
          className={cn("h-4 w-4 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")}
          fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
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
          <div className="space-y-1.5">
            <Label htmlFor="email">{t("settings.profile.email", lang)}</Label>
            <div className="flex items-center gap-2">
              <Input id="email" value={user.email} disabled />
              {user.email_verified ? (
                <span className="shrink-0 text-[12px] font-medium text-success">{t("settings.profile.emailVerified", lang)}</span>
              ) : (
                <span className="flex shrink-0 items-center gap-1.5">
                  <span className="text-[12px] font-medium text-amber-600">{t("settings.profile.emailUnverified", lang)}</span>
                  {emailResent ? (
                    <span className="text-[11px] text-success">{t("settings.profile.emailResent", lang)}</span>
                  ) : (
                    <button
                      type="button"
                      className="text-[11px] font-medium text-primary underline underline-offset-2 hover:no-underline disabled:opacity-50"
                      onClick={handleResendVerification}
                      disabled={emailResending}
                    >
                      {t("settings.profile.emailResend", lang)}
                    </button>
                  )}
                </span>
              )}
            </div>
            <p className="text-[12px] text-muted-foreground">{t("settings.profile.emailHint", lang)}</p>
          </div>
          {error && <p className="text-[12px] text-destructive">{error}</p>}
          {success && <p className="text-[12px] text-success">{t("settings.profile.saved", lang)}</p>}
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
  const [portfolioVis, setPortfolioVis] = React.useState(p?.portfolio_visibility ?? "private");
  const [portfolioSlug, setPortfolioSlug] = React.useState(p?.portfolio_slug ?? "");
  const [portfolioTitle, setPortfolioTitle] = React.useState(p?.portfolio_title ?? "");
  const [portfolioHeadline, setPortfolioHeadline] = React.useState(p?.portfolio_headline ?? "");
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [success, setSuccess] = React.useState(false);
  const [coverUploading, setCoverUploading] = React.useState(false);
  const [portfolioCopied, setPortfolioCopied] = React.useState(false);
  const coverInputRef = React.useRef<HTMLInputElement>(null);
  useAutoDismiss(success, setSuccess);
  useAutoDismiss(portfolioCopied, setPortfolioCopied);

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
        portfolio_visibility: portfolioVis,
        portfolio_slug: portfolioSlug.trim(),
        portfolio_title: portfolioTitle.trim(),
        portfolio_headline: portfolioHeadline.trim(),
      });
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
  const hasPortfolio = !!(portfolioSlug || portfolioTitle || portfolioHeadline) || portfolioVis !== "private";

  const portfolioLink = portfolioSlug ? `https://reaigen.com/p/${portfolioSlug}` : "";

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
            <div className="h-28 w-full overflow-hidden rounded-lg bg-muted sm:h-36">
              {p?.cover_image_url ? (
                // User-owned signed media URLs are not compatible with a fixed Next image host.
                // eslint-disable-next-line @next/next/no-img-element
                <img src={p.cover_image_url} alt={t("settings.seller.coverImage", lang)} className="h-full w-full object-cover" />
              ) : (
                <div className="flex h-full w-full items-center justify-center text-sm text-muted-foreground">{t("settings.seller.coverImage", lang)}</div>
              )}
            </div>
            <input ref={coverInputRef} type="file" accept="image/*" className="hidden" onChange={handleCoverChange} />
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
          </div>

          {/* Contact */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label>{t("settings.seller.phone", lang)}</Label>
              <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+421 900 123 456" />
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
              <Input value={website} onChange={(e) => setWebsite(e.target.value)} placeholder="https://www.example.com" />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>{t("settings.seller.bio", lang)}</Label>
            <Textarea
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
                <Label>{t("settings.seller.linkedin", lang)}</Label>
                <Input value={linkedin} onChange={(e) => setLinkedin(e.target.value)} placeholder="https://linkedin.com/in/your-name" />
              </div>
              <div className="space-y-1.5">
                <Label>{t("settings.seller.twitter", lang)}</Label>
                <Input value={twitter} onChange={(e) => setTwitter(e.target.value)} placeholder="@yourhandle" />
              </div>
              <div className="space-y-1.5">
                <Label>{t("settings.seller.instagram", lang)}</Label>
                <Input value={instagram} onChange={(e) => setInstagram(e.target.value)} placeholder="@yourhandle" />
              </div>
            </div>
          </CollapsibleSection>

          {/* RE Professional */}
          <Separator />
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

          {/* Address — collapsible */}
          <Separator />
          <CollapsibleSection title={t("settings.seller.sectionAddress", lang)} defaultOpen={hasAddress}>
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
          </CollapsibleSection>

          {/* Portfolio — collapsible */}
          <Separator />
          <CollapsibleSection title={t("settings.seller.sectionPortfolio", lang)} defaultOpen={hasPortfolio}>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>{t("settings.seller.portfolioVisibility", lang)}</Label>
                <Select value={portfolioVis} onValueChange={setPortfolioVis}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="private">{t("settings.seller.portfolioPrivate", lang)}</SelectItem>
                    <SelectItem value="unlisted">{t("settings.seller.portfolioUnlisted", lang)}</SelectItem>
                    <SelectItem value="public">{t("settings.seller.portfolioPublic", lang)}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>{t("settings.seller.portfolioSlug", lang)}</Label>
                <div className="flex items-stretch">
                  <span className="flex shrink-0 items-center rounded-l-xl border border-r-0 border-input bg-muted px-2.5 text-xs text-muted-foreground">
                    {t("settings.seller.portfolioSlugPrefix", lang)}
                  </span>
                  <Input
                    value={portfolioSlug}
                    onChange={(e) => setPortfolioSlug(e.target.value)}
                    className="rounded-l-none"
                  />
                </div>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>{t("settings.seller.portfolioTitleLabel", lang)}</Label>
              <Input value={portfolioTitle} onChange={(e) => setPortfolioTitle(e.target.value)} maxLength={120} />
            </div>
            <div className="space-y-1.5">
              <Label>{t("settings.seller.portfolioHeadline", lang)}</Label>
              <Input value={portfolioHeadline} onChange={(e) => setPortfolioHeadline(e.target.value)} maxLength={200} />
            </div>
            {portfolioVis !== "private" && portfolioLink && (
              <div className="space-y-1.5">
                <Label>{t("settings.seller.portfolioLink", lang)}</Label>
                <div className="flex items-center gap-2">
                  <Input value={portfolioLink} readOnly className="opacity-70" />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => { navigator.clipboard.writeText(portfolioLink); setPortfolioCopied(true); }}
                  >
                    {portfolioCopied ? t("settings.seller.portfolioCopied", lang) : t("shares.copyLink", lang)}
                  </Button>
                </div>
              </div>
            )}
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
      const payload = allowAll
        ? { allow_all_tools: true }
        : { allow_all_tools: false, tools: toolPermissions.tools };
      setToolPermissions(await updateReaiToolPermissions(payload));
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
                  consent.consented ? "bg-success/10 text-success" : "bg-foreground/10 text-foreground/60",
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

              {!toolPermissions.allow_all_tools && (
                <div className="divide-y divide-border/60 rounded-lg border border-border/60 px-4">
                  {toolPermissions.available_tools.map((code) => (
                    <div key={code} className="flex items-center justify-between gap-4 py-3">
                      <div className="min-w-0">
                        <p className="text-[13px] font-medium">{t(`settings.reai.tool.${code}`, lang)}</p>
                        <p className="mt-0.5 text-[12px] leading-relaxed text-muted-foreground">
                          {t(`settings.reai.tool.${code}.help`, lang)}
                        </p>
                      </div>
                      <Switch
                        checked={toolPermissions.tools[code]}
                        disabled={saving}
                        onCheckedChange={(checked) => void setTool(code, checked)}
                        aria-label={t(`settings.reai.tool.${code}`, lang)}
                      />
                    </div>
                  ))}
                </div>
              )}

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
                disabled={saving}
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
  useAutoDismiss(success, setSuccess);

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
            className="rounded-lg border border-border/60 bg-muted/25 px-4 py-3"
          >
            <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <p className="text-sm font-medium">{statusLabel}</p>
                <p className="text-[12px] text-muted-foreground mt-1 leading-relaxed">{statusHint}</p>
              </div>
              <span className="shrink-0 rounded-full bg-foreground/10 px-2.5 py-0.5 text-[11px] font-medium text-foreground/70">
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
  const [systemUpdates, setSystemUpdates] = React.useState(pd?.notify_system_updates ?? true);
  const [billing, setBilling] = React.useState(pd?.notify_billing ?? true);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [success, setSuccess] = React.useState(false);
  useAutoDismiss(success, setSuccess);

  // Auto-save on any change (debounced to avoid rapid fire)
  const isFirstRender = React.useRef(true);
  React.useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    const timeout = setTimeout(() => {
      setSaving(true);
      setError(null);
      updatePersonalizedData({
        notifications_enabled: enabled,
        email_notifications: email,
        notify_processing_complete: processing,
        notify_processing_failed: processingFailed,
        notify_new_features: newFeatures,
        notify_system_updates: systemUpdates,
        notify_billing: billing,
      })
        .then(() => { setSuccess(true); onSaved(); })
        .catch((err) => setError(getSafeApiErrorMessage(err, lang)))
        .finally(() => setSaving(false));
    }, 400);
    return () => clearTimeout(timeout);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, email, processing, processingFailed, newFeatures, systemUpdates, billing]);

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
                  label={t("settings.notifications.systemUpdates", lang)}
                  checked={systemUpdates}
                  onChange={setSystemUpdates}
                />
                <ToggleRow
                  label={t("settings.notifications.billing", lang)}
                  checked={billing}
                  onChange={setBilling}
                />
              </>
            )}
          </div>

          {/* Status feedback */}
          <div className="h-6 pt-3">
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
    <div className={`flex items-start justify-between gap-4 py-3.5 ${disabled ? "opacity-60" : ""}`}>
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
      {hint && <p className="text-[12px] leading-4 text-muted-foreground">{hint}</p>}
    </div>
  );
}

function LocalizationTab({ user, lang }: { user: UserProfile; lang: string }) {
  const loc = user.localization;
  const [language, setLanguage] = React.useState(loc?.language ?? "en");
  const [currency, setCurrency] = React.useState(loc?.currency ?? "EUR");
  const [areaUnit, setAreaUnit] = React.useState(loc?.area_unit ?? "SQM");
  const [distanceUnit, setDistanceUnit] = React.useState(loc?.distance_unit ?? "M");
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
      .then(setPrefs)
      .catch(() => setPrefsError(true))
      .finally(() => setPrefsLoading(false));
  }, []);

  React.useEffect(() => { loadPrefs(); }, [loadPrefs]);

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
            <SettingsField label={t("settings.localization.language", lang)} hint={optionName(languages, language)}>
              <Select value={language} onValueChange={setLanguage}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {languages.map((l) => (
                    <SelectItem key={l.code} value={l.code}>{stableOptionLabel(l)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </SettingsField>
            <SettingsField label={t("settings.localization.timezone", lang)} hint={timezone}>
              <Select value={timezone} onValueChange={setTimezone}>
                <SelectTrigger><SelectValue placeholder={timezone || "—"} /></SelectTrigger>
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
            <SettingsField label={t("settings.localization.currency", lang)} hint={optionName(currencies, currency)}>
              <Select value={currency} onValueChange={setCurrency}>
                <SelectTrigger><SelectValue /></SelectTrigger>
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
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {dateFormats.map((d) => (
                    <SelectItem key={d.code} value={d.code}>{d.code} · {d.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </SettingsField>
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <SettingsField label={t("settings.localization.areaUnit", lang)} hint={formattedAreaSample}>
              <Select value={areaUnit} onValueChange={setAreaUnit}>
                <SelectTrigger><SelectValue /></SelectTrigger>
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
                <SelectTrigger><SelectValue /></SelectTrigger>
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
  const unlimited = max === 0;
  const pct = unlimited ? 0 : Math.min((current / max) * 100, 100);
  const color = pct >= 100 ? "bg-destructive" : pct >= 75 ? "bg-amber-500" : "bg-success";
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
  TRIAL: "bg-blue-100 text-blue-700",
  LITE: "bg-success/10 text-success",
  PRO: "bg-purple-100 text-purple-700",
  ENTERPRISE: "bg-amber-100 text-amber-700",
};

function tierBadgeKey(code: string, lang: string): string {
  const map: Record<string, string> = {
    FREE: t("settings.billing.badgeFree", lang),
    TRIAL: t("settings.billing.badgeTrial", lang),
    LITE: t("settings.billing.badgeLite", lang),
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
  const maxStorage = tier?.max_storage_gb ?? 0;
  const currentPosts = ba?.current_posts_count ?? 0;
  const currentStorage = parseFloat(ba?.current_storage_gb ?? "0");

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
            {ba?.is_trial && ba.days_until_expiry != null && (
              <DataRow label={t("settings.billing.trial", lang)} value={`${ba.days_until_expiry} ${t("settings.billing.trialDaysLeft", lang)}`} />
            )}
            <DataRow label={t("settings.billing.provider", lang)} value={ba?.payment_provider || t("common.none", lang)} />
          </dl>
        </CardContent>
      </Card>

      {/* Usage */}
      <Card>
        <CardHeader>
          <CardTitle>{t("settings.billing.usageTitle", lang)}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4 rounded-lg border border-border/60 p-4">
            <UsageBar current={currentPosts} max={maxPosts} label={t("settings.billing.posts", lang)} />
            <UsageBar current={currentStorage} max={maxStorage} label={t("settings.billing.storage", lang)} unit="GB" />
          </div>
        </CardContent>
      </Card>

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
      <PasswordSection lang={lang} />
      <TwoFactorSection lang={lang} />
      <LinkedAccountsSection lang={lang} />
      <PhoneSection user={user} onSaved={onSaved} lang={lang} />
    </div>
  );
}

function PasswordSection({ lang }: { lang: string }) {
  const [currentPassword, setCurrentPassword] = React.useState("");
  const [newPassword, setNewPassword] = React.useState("");
  const [confirmPassword, setConfirmPassword] = React.useState("");
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [success, setSuccess] = React.useState(false);
  useAutoDismiss(success, setSuccess);
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
        <CardDescription>{t("settings.security.passwordSubtitle", lang)}</CardDescription>
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
            <p className="text-[12px] text-destructive">{t("settings.security.mismatch", lang)}</p>
          )}
          {error && <p className="text-[12px] text-destructive">{error}</p>}
          {success && <p className="text-[12px] text-success">{t("settings.security.saved", lang)}</p>}
          <div className="pt-2">
            <Button type="submit" size="sm" loading={loading} disabled={!canSubmit || loading}>{t("settings.security.save", lang)}</Button>
          </div>
        </form>
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
      .then(setStatus)
      .catch(() => {})
      .finally(() => setFetchLoading(false));
  }, []);

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

  if (fetchLoading) return null;

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
            <div className="grid grid-cols-2 gap-1 rounded-lg border border-border p-3 font-mono text-[13px]">
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
                ? "bg-success/10 text-success"
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
      .then(setData)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

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

  if (loading) return null;

  const accounts = data?.social_accounts ?? [];
  const canUnlink = data?.has_password || accounts.length > 1;

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("settings.security.linkedTitle", lang)}</CardTitle>
        <CardDescription>{t("settings.security.linkedSubtitle", lang)}</CardDescription>
      </CardHeader>
      <CardContent>
        {accounts.length === 0 ? (
          <p className="text-[13px] text-muted-foreground">{t("settings.security.linkedNone", lang)}</p>
        ) : (
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
        )}
        {error && <p className="mt-2 text-[12px] text-destructive">{error}</p>}
      </CardContent>
    </Card>
  );
}

function PhoneSection({ user, onSaved, lang }: { user: UserProfile; onSaved: () => void; lang: string }) {
  const phone = user.profile?.phone;
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
          <p className="text-[13px] text-muted-foreground">{t("settings.security.phoneNoPhone", lang)}</p>
        ) : (
          <div className="space-y-3">
            <div className="flex items-center gap-3">
              <span className="text-sm font-medium">{phone}</span>
              <span className={cn("rounded-full px-2.5 py-0.5 text-[11px] font-semibold",
                verified
                  ? "bg-success/10 text-success"
                  : "bg-amber-100 text-amber-700"
              )}>
                {verified ? t("settings.security.phoneVerified", lang) : t("settings.security.phoneUnverified", lang)}
              </span>
            </div>

            {!verified && !otpSent && (
              <Button type="button" size="sm" loading={loading} onClick={handleRequestOtp}>
                {t("settings.security.phoneVerify", lang)}
              </Button>
            )}

            {otpSent && (
              <div className="flex items-end gap-2">
                <div className="space-y-1.5">
                  <Label>{t("settings.security.phoneOtpSent", lang)}</Label>
                  <Input
                    value={code}
                    onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                    placeholder={t("settings.security.phoneOtpPlaceholder", lang)}
                    maxLength={6}
                    className="w-40 font-mono"
                  />
                </div>
                <Button type="button" size="sm" loading={loading} disabled={code.length < 4} onClick={handleVerify}>
                  {t("settings.security.phoneOtpConfirm", lang)}
                </Button>
              </div>
            )}

            {error && <p className="text-[12px] text-destructive">{error}</p>}
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
  const triggerClassName =
    "shrink-0 justify-start rounded-none border-b-2 border-transparent px-1.5 pb-3 pt-0 text-[13px] shadow-none data-[state=active]:border-foreground data-[state=active]:bg-transparent data-[state=active]:shadow-none md:h-9 md:w-full md:rounded-lg md:border-0 md:px-3 md:py-0 md:text-left md:data-[state=active]:bg-foreground/[0.065]";
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
      className="w-full md:grid md:grid-cols-[190px_minmax(0,1fr)] md:items-start md:gap-9"
    >
      <div className="mb-7 md:sticky md:top-20 md:mb-0">
        {/* Mobile: horizontal scrollable pills — all sections visible, one tap to switch */}
        <div className="-mx-4 mb-1 overflow-x-auto scrollbar-none px-4 md:hidden">
          <TabsList className="flex w-max gap-1.5 bg-transparent p-0">
            {settingsTabs.map((tab) => (
              <TabsTrigger
                key={tab.value}
                value={tab.value}
                className="shrink-0 rounded-lg border border-border/55 bg-surface px-3.5 py-2 text-[13px] font-medium text-foreground/60 shadow-none transition-colors data-[state=active]:border-foreground data-[state=active]:bg-foreground data-[state=active]:text-background"
              >
                {t(tab.label, lang)}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>
        {/* Desktop: vertical list */}
        <TabsList className="hidden min-h-0 w-full flex-col items-stretch gap-1 rounded-xl border border-border/55 bg-surface p-2 text-muted-foreground md:flex">
          {settingsTabs.map((tab) => (
            <TabsTrigger key={tab.value} value={tab.value} className={triggerClassName}>{t(tab.label, lang)}</TabsTrigger>
          ))}
        </TabsList>
      </div>
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
