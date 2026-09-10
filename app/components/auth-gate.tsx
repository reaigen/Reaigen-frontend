"use client";

import * as React from "react";
import { Button } from "../lib/ui/button";
import { Checkbox } from "../lib/ui/checkbox";
import { Input } from "../lib/ui/input";
import { Label } from "../lib/ui/label";
import { requestPasswordReset, resendVerification, type StepUpChallenge } from "../lib/api/client";
import type { SessionEndReason } from "../lib/session-end";
import { getSafeApiErrorMessage } from "../lib/api/error-message";
import { getBrowserLanguage, t } from "../lib/i18n";
import type { LocaleKey } from "../lib/locales";
import { RegistrationLegalText } from "./content-documents";
import { useAuth } from "./hooks/use-auth";

type RegisterData = {
  email: string;
  username: string;
  password: string;
  password_confirm: string;
  first_name: string;
  last_name: string;
  accept_privacy_policy: boolean;
  accept_terms: boolean;
  preferred_language: string;
  preferred_timezone: string;
};

type AuthGateProps = {
  open: boolean;
  onClose: () => void;
  onLogin: (email: string, password: string) => Promise<void | StepUpChallenge>;
  onRegister: (data: RegisterData) => Promise<void>;
  /** Why the previous session ended, when the proxy could say. */
  sessionEnd?: SessionEndReason | null;
  /** The profile load failed without a sign-out verdict; offer a retry. */
  serviceUnavailable?: boolean;
  onRetry?: () => void;
  /** Sign-up succeeded and the account waits for its email link. */
  pendingVerificationEmail?: string | null;
  onPendingVerificationDismiss?: () => void;
  /** The email link was just opened; the account can sign in now. */
  verifiedNotice?: boolean;
};

const SESSION_END_COPY: Record<SessionEndReason, LocaleKey> = {
  email_verification: "auth.session.emailVerification",
  account_disabled: "auth.session.accountDisabled",
  expired: "auth.session.expired",
};

/* ── Shared input style ───────────────────────────────────────────────── */

const INPUT_CLASS =
  "h-14 rounded-full border-border bg-card px-5 text-[15px] text-foreground shadow-none placeholder:text-foreground/35 transition-[border-color,box-shadow] duration-150 hover:border-foreground/35 focus-visible:border-foreground focus-visible:bg-card focus-visible:ring-0 focus-visible:shadow-[0_0_0_3px_rgba(0,0,0,0.08)]";

const AUTH_IMAGE_URL =
  "https://images.unsplash.com/photo-1639663742190-1b3dba2eebcf?auto=format&fit=crop&fm=jpg&q=84&w=1800";

/* ── Helpers ──────────────────────────────────────────────────────────── */

function useBrowserLang(): string {
  const [lang, setLang] = React.useState("en");
  React.useEffect(() => { setLang(getBrowserLanguage()); }, []);
  return lang;
}

function ReaigenLogo({ className = "" }: { className?: string }) {
  return (
    <span
      className={`text-[24px] leading-none text-foreground ${className}`}
      style={{ fontFamily: "var(--font-brand), ui-serif, Georgia, serif", fontWeight: 500, letterSpacing: "0.005em" }}
    >
      Reaigen
    </span>
  );
}

function BrandPanel({ lang }: { lang: string }) {
  return (
    <aside className="relative hidden min-h-[100dvh] overflow-hidden bg-[#11110f] lg:block">
      <div
        aria-hidden="true"
        className="absolute inset-0 bg-cover bg-center"
        style={{ backgroundImage: `url(${AUTH_IMAGE_URL})` }}
      />
      <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(0,0,0,0.48)_0%,rgba(0,0,0,0.05)_38%,rgba(0,0,0,0.18)_58%,rgba(0,0,0,0.76)_100%)]" />

      <div className="absolute left-10 top-9 flex items-center gap-3 xl:left-14 xl:top-12">
        <ReaigenLogo className="!text-white" />
        <span className="rounded-full border border-white/30 bg-black/10 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.14em] text-white/75 backdrop-blur-md">
          {t("auth.brand.workspace", lang)}
        </span>
      </div>

      <div className="absolute inset-x-0 bottom-0 p-10 xl:p-14">
        <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-white/60">
          {t("auth.brand.kicker", lang)}
        </p>
        <h2 className="mt-4 max-w-[38rem] text-[clamp(2.5rem,4.2vw,5.25rem)] font-semibold leading-[0.94] tracking-[-0.06em] text-white">
          {t("auth.brand.title", lang)}
        </h2>
        <p className="mt-5 max-w-[31rem] text-[15px] leading-relaxed !text-white opacity-75 xl:text-[16px]">
          {t("auth.brand.subtitle", lang)}
        </p>
        <div className="mt-7 inline-flex items-center gap-2 rounded-full border border-white/25 bg-black/20 px-3.5 py-2 text-[11px] font-semibold text-white/85 backdrop-blur-md">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" aria-hidden="true" />
          {t("auth.brand.previewStatus", lang)}
        </div>
      </div>
    </aside>
  );
}

/* ── Login Form ───────────────────────────────────────────────────────── */

function SessionEndNotice({ lang, reason, email }: { lang: string; reason: SessionEndReason; email: string }) {
  const [resent, setResent] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const emailIsValid = /\S+@\S+\.\S+/.test(email.trim());

  async function resend() {
    if (!emailIsValid || busy) return;
    setBusy(true);
    setError(null);
    try {
      await resendVerification(email.trim());
      setResent(true);
    } catch (err) {
      setError(getSafeApiErrorMessage(err, lang));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div role="status" className="rounded-2xl border border-border bg-surface-subtle px-4 py-3.5" data-testid="session-end-notice" data-reason={reason}>
      <p className="text-[13px] font-semibold text-foreground">{t("auth.session.endedTitle", lang)}</p>
      <p className="mt-1 text-[12px] leading-relaxed text-foreground/65">{t(SESSION_END_COPY[reason], lang)}</p>
      {reason === "email_verification" ? (
        <button
          type="button"
          onClick={resend}
          disabled={!emailIsValid || busy || resent}
          className="mt-2 text-[12px] font-semibold text-foreground underline underline-offset-4 disabled:opacity-50"
        >
          {resent ? t("auth.session.resent", lang) : t("auth.session.resend", lang)}
        </button>
      ) : null}
      {error ? <p className="mt-1 text-[12px] text-destructive">{error}</p> : null}
    </div>
  );
}

function VerificationPendingCard({ lang, email, onBack }: { lang: string; email: string; onBack: () => void }) {
  const [resent, setResent] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function resend() {
    if (busy || resent) return;
    setBusy(true);
    setError(null);
    try {
      await resendVerification(email);
      setResent(true);
    } catch (err) {
      setError(getSafeApiErrorMessage(err, lang));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-5" data-testid="verification-pending">
      <div className="rounded-2xl border border-border bg-surface-subtle px-5 py-4">
        <p className="break-all text-[15px] font-semibold text-foreground" data-testid="verification-pending-email">{email}</p>
        <p className="mt-2 text-[13px] leading-relaxed text-foreground/65">{t("auth.register.pendingHint", lang)}</p>
      </div>
      {error ? (
        <p role="alert" className="rounded-2xl border border-destructive/20 bg-destructive/[0.045] px-4 py-3 text-[12px] font-medium leading-relaxed text-destructive">{error}</p>
      ) : null}
      <Button
        type="button"
        variant="outline"
        className="h-[3.25rem] w-full rounded-full text-[14px] font-semibold shadow-none"
        loading={busy}
        disabled={resent}
        onClick={resend}
        data-testid="verification-pending-resend"
      >
        {resent ? t("auth.register.pendingResent", lang) : t("auth.register.pendingResend", lang)}
      </Button>
      <button
        type="button"
        onClick={onBack}
        className="h-11 w-full rounded-full text-[13px] font-medium text-foreground/55 transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
      >
        {t("auth.register.pendingBack", lang)}
      </button>
    </div>
  );
}

function LoginCard({
  lang,
  onSubmit,
  onSwitchToRegister,
  sessionEnd = null,
  verifiedNotice = false,
}: {
  lang: string;
  onSubmit: (email: string, password: string) => Promise<void | StepUpChallenge>;
  onSwitchToRegister: () => void;
  sessionEnd?: SessionEndReason | null;
  verifiedNotice?: boolean;
}) {
  const { completeStepUp } = useAuth();
  const [email, setEmail] = React.useState("");
  // The backend refuses sign-in for an unverified address with a message
  // that names verification; a resend action belongs right under it.
  const [resendState, setResendState] = React.useState<"idle" | "busy" | "sent">("idle");
  async function resendFromError() {
    if (resendState !== "idle") return;
    setResendState("busy");
    try {
      await resendVerification(email.trim());
      setResendState("sent");
    } catch (err) {
      setError(getSafeApiErrorMessage(err, lang));
      setResendState("idle");
    }
  }
  const [password, setPassword] = React.useState("");
  const [showPassword, setShowPassword] = React.useState(false);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [resetSent, setResetSent] = React.useState(false);
  const [resetLoading, setResetLoading] = React.useState(false);
  const [stepUp, setStepUp] = React.useState<StepUpChallenge | null>(null);
  const [stepUpCode, setStepUpCode] = React.useState("");
  const emailIsValid = /\S+@\S+\.\S+/.test(email.trim());
  const canSubmit = emailIsValid && password.length > 0;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!canSubmit) {
      setError(t("auth.validation.incomplete", lang));
      return;
    }
    try {
      setLoading(true);
      const result = await onSubmit(email.trim(), password);
      if (result && result.step_up_required) {
        setStepUp(result);
        setStepUpCode("");
      }
    } catch (err) {
      setError(getSafeApiErrorMessage(err, lang));
    } finally {
      setLoading(false);
    }
  }

  async function handleStepUpSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!stepUp) return;
    if (stepUpCode.trim().length < 6) {
      setError(t("auth.validation.incomplete", lang));
      return;
    }
    setError(null);
    try {
      setLoading(true);
      const method = stepUp.step_up_methods.includes("otp") ? "otp" : "totp";
      await completeStepUp(stepUp.step_up_token, method, stepUpCode.trim());
    } catch (err) {
      setError(getSafeApiErrorMessage(err, lang));
      setLoading(false);
    }
  }

  if (stepUp) {
    const usesSms = stepUp.step_up_methods.includes("otp");
    return (
      <form className="space-y-5" onSubmit={handleStepUpSubmit} noValidate>
        <div className="space-y-1.5">
          <p className="text-[15px] font-semibold text-foreground">
            {t("auth.stepUp.title", lang)}
          </p>
          <p className="text-[13px] text-muted-foreground">
            {usesSms ? t("auth.stepUp.hintOtp", lang) : t("auth.stepUp.hintTotp", lang)}
          </p>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="step-up-code" className="text-[13px] font-medium text-foreground">
            {t("auth.stepUp.codeLabel", lang)}
          </Label>
          <Input
            id="step-up-code"
            inputMode="numeric"
            autoComplete="one-time-code"
            placeholder={t("auth.stepUp.codePlaceholder", lang)}
            value={stepUpCode}
            onChange={(e) => { setStepUpCode(e.target.value.replace(/\D/g, "").slice(0, 8)); if (error) setError(null); }}
            className={INPUT_CLASS}
            autoFocus
          />
        </div>
        {error && (
          <p role="alert" className="rounded-2xl border border-destructive/20 bg-destructive/[0.045] px-4 py-3 text-[12px] font-medium leading-relaxed text-destructive">
            {error}
          </p>
        )}
        <Button
          type="submit"
          className="h-[3.25rem] w-full rounded-full text-[14px] font-semibold shadow-none disabled:opacity-100 disabled:bg-foreground disabled:text-background"
          loading={loading}
          disabled={loading}
        >
          {t("auth.stepUp.submit", lang)}
        </Button>
        <button
          type="button"
          onClick={() => { setStepUp(null); setStepUpCode(""); setError(null); }}
          className="h-11 w-full rounded-full text-[13px] font-medium text-foreground/55 transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          {t("auth.stepUp.back", lang)}
        </button>
      </form>
    );
  }

  return (
    <form className="space-y-5" onSubmit={handleSubmit} noValidate>
      {sessionEnd ? <SessionEndNotice lang={lang} reason={sessionEnd} email={email} /> : null}
      {verifiedNotice && !sessionEnd ? (
        <div role="status" className="rounded-2xl border border-success/25 bg-success/[0.06] px-4 py-3.5" data-testid="verified-notice">
          <p className="text-[13px] font-semibold text-success">{t("auth.verified.title", lang)}</p>
          <p className="mt-1 text-[12px] leading-relaxed text-foreground/65">{t("auth.verified.body", lang)}</p>
        </div>
      ) : null}
      <div className="space-y-1.5">
        <Label htmlFor="login-email" className="text-[13px] font-medium text-foreground">
          {t("auth.login.emailLabel", lang)}
        </Label>
        <Input
          id="login-email"
          type="email"
          placeholder={t("auth.login.emailPlaceholder", lang)}
          value={email}
          onChange={(e) => { setEmail(e.target.value); if (error) setError(null); }}
          autoComplete="email"
          className={INPUT_CLASS}
        />
      </div>

      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <Label htmlFor="login-password" className="text-[13px] font-medium text-foreground">
            {t("auth.login.passwordLabel", lang)}
          </Label>
          <button
            type="button"
            disabled={resetLoading || !emailIsValid}
            onClick={async () => {
              if (!emailIsValid) return;
              setResetLoading(true);
              try { await requestPasswordReset(email.trim()); setResetSent(true); }
              catch (err) { setError(getSafeApiErrorMessage(err, lang)); }
              setResetLoading(false);
            }}
            className="rounded-full px-1.5 py-0.5 text-[12px] font-medium text-foreground/45 transition-colors hover:text-foreground disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            {resetSent ? t("auth.login.forgotSent", lang) : resetLoading ? t("auth.login.forgotSending", lang) : t("auth.login.forgot", lang)}
          </button>
        </div>
        <div className="relative">
          <Input
            id="login-password"
            type={showPassword ? "text" : "password"}
            placeholder={t("auth.login.passwordPlaceholder", lang)}
            value={password}
            onChange={(e) => { setPassword(e.target.value); if (error) setError(null); }}
            autoComplete="current-password"
            className={`${INPUT_CLASS} pr-14`}
          />
          <button
            type="button"
            onClick={() => setShowPassword((v) => !v)}
            className="absolute right-3 top-1/2 -translate-y-1/2 rounded-full px-2 py-1 text-[12px] font-semibold text-foreground/50 transition-colors hover:bg-foreground/[0.04] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            {showPassword ? t("common.hide", lang) : t("common.show", lang)}
          </button>
        </div>
      </div>

      {error && (
        <div role="alert" className="rounded-2xl border border-destructive/20 bg-destructive/[0.045] px-4 py-3 text-[12px] font-medium leading-relaxed text-destructive">
          <p>{error}</p>
          {/verif/i.test(error) && emailIsValid ? (
            <button
              type="button"
              onClick={resendFromError}
              disabled={resendState !== "idle"}
              className="mt-1.5 font-semibold text-foreground underline underline-offset-4 disabled:opacity-60"
              data-testid="login-resend-verification"
            >
              {resendState === "sent" ? t("auth.session.resent", lang) : t("auth.login.resendVerification", lang)}
            </button>
          ) : null}
        </div>
      )}

      <Button
        type="submit"
        className="h-[3.25rem] w-full rounded-full text-[14px] font-semibold shadow-none transition-[background-color,color,transform] active:scale-[0.99] disabled:opacity-100 disabled:bg-foreground disabled:text-background"
        loading={loading}
        disabled={loading}
      >
        {t("auth.login.submit", lang)}
      </Button>

      <div className="pt-0.5">
        <button type="button" onClick={onSwitchToRegister} className="h-[3.25rem] w-full rounded-full border border-border bg-card px-5 text-[14px] font-semibold text-foreground transition-[background-color,border-color,transform] hover:border-foreground/35 hover:bg-foreground/[0.025] active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2">
          {t("auth.login.switchToRegister", lang)}
        </button>
      </div>
    </form>
  );
}

/* ── Registration Form ────────────────────────────────────────────────── */

function RegistrationCard({
  lang,
  onSubmit,
  onSwitchToLogin,
}: {
  lang: string;
  onSubmit: (data: RegisterData) => Promise<void>;
  onSwitchToLogin: () => void;
}) {
  const [firstName, setFirstName] = React.useState("");
  const [lastName, setLastName] = React.useState("");
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [confirmPassword, setConfirmPassword] = React.useState("");
  const [showPassword, setShowPassword] = React.useState(false);
  const [agreeToTerms, setAgreeToTerms] = React.useState(false);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const emailIsValid = /\S+@\S+\.\S+/.test(email.trim());
  const passwordIsValid = password.length >= 8;
  const passwordsMatch = password === confirmPassword && confirmPassword.length > 0;
  // Email is the stable cross-platform account identifier. Name-derived
  // usernames collided whenever two people shared the same name, while iOS
  // already uses the normalized email for this backend-required field.
  const username = email.trim().toLowerCase();
  const canSubmit = firstName.trim().length > 0 && lastName.trim().length > 0 && emailIsValid && passwordIsValid && passwordsMatch && agreeToTerms;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!canSubmit) {
      setError(t("auth.validation.incomplete", lang));
      return;
    }
    try {
      setLoading(true);
      await onSubmit({
        email: email.trim(),
        username,
        password,
        password_confirm: confirmPassword,
        first_name: firstName.trim(),
        last_name: lastName.trim(),
        accept_privacy_policy: agreeToTerms,
        accept_terms: agreeToTerms,
        preferred_language: lang,
        preferred_timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
      });
    } catch (err) {
      setError(getSafeApiErrorMessage(err, lang));
    } finally {
      setLoading(false);
    }
  }

  return (
    <form className="space-y-4" onSubmit={handleSubmit} noValidate>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="register-first-name" className="text-[13px] font-medium text-foreground">
            {t("auth.register.firstNameLabel", lang)}
          </Label>
          <Input id="register-first-name" type="text" placeholder={t("auth.register.firstNamePlaceholder", lang)}
            value={firstName} onChange={(e) => setFirstName(e.target.value)} autoComplete="given-name" className={INPUT_CLASS} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="register-last-name" className="text-[13px] font-medium text-foreground">
            {t("auth.register.lastNameLabel", lang)}
          </Label>
          <Input id="register-last-name" type="text" placeholder={t("auth.register.lastNamePlaceholder", lang)}
            value={lastName} onChange={(e) => setLastName(e.target.value)} autoComplete="family-name" className={INPUT_CLASS} />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="register-email" className="text-[13px] font-medium text-foreground">
          {t("auth.register.emailLabel", lang)}
        </Label>
        <Input id="register-email" type="email" placeholder={t("auth.register.emailPlaceholder", lang)}
          value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" className={INPUT_CLASS} />
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="register-password" className="text-[13px] font-medium text-foreground">
            {t("auth.register.passwordLabel", lang)}
          </Label>
          <div className="relative">
            <Input id="register-password" type={showPassword ? "text" : "password"} placeholder={t("auth.register.passwordPlaceholder", lang)}
              value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" className={`${INPUT_CLASS} pr-14`} />
            <button type="button" onClick={() => setShowPassword((v) => !v)}
              className="absolute right-3.5 top-1/2 -translate-y-1/2 text-[12px] font-medium text-foreground/55 hover:text-foreground transition-colors">
              {showPassword ? t("common.hide", lang) : t("common.show", lang)}
            </button>
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="register-confirm" className="text-[13px] font-medium text-foreground">
            {t("auth.register.confirmLabel", lang)}
          </Label>
          <Input id="register-confirm" type="password" placeholder={t("auth.register.confirmPlaceholder", lang)}
            value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} autoComplete="new-password" className={INPUT_CLASS} />
        </div>
      </div>
      {!passwordsMatch && confirmPassword.length > 0 && (
        <p className="text-[11px] text-destructive">{t("auth.register.passwordMismatch", lang)}</p>
      )}

      <div className="flex items-start gap-2.5 text-[12px] text-foreground/60">
        <Checkbox
          id="register-terms"
          className="mt-0.5 border-foreground/20"
          checked={agreeToTerms}
          onCheckedChange={(checked) => setAgreeToTerms(checked === true)}
        />
        <div className="min-w-0 leading-relaxed">
          <RegistrationLegalText lang={lang} />
        </div>
      </div>

      {error && (
        <p role="alert" className="rounded-2xl border border-destructive/20 bg-destructive/[0.045] px-4 py-3 text-[12px] font-medium leading-relaxed text-destructive">
          {error}
        </p>
      )}

      <Button
        type="submit"
        className="h-[3.25rem] w-full rounded-full text-[14px] font-semibold shadow-none transition-[background-color,color,transform] active:scale-[0.99] disabled:opacity-100 disabled:bg-foreground disabled:text-background"
        loading={loading}
        disabled={loading}
      >
        {t("auth.register.submit", lang)}
      </Button>

      <div className="pt-0.5">
        <button type="button" onClick={onSwitchToLogin} className="h-[3.25rem] w-full rounded-full border border-border bg-card px-5 text-[14px] font-semibold text-foreground transition-[background-color,border-color,transform] hover:border-foreground/35 hover:bg-foreground/[0.025] active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2">
          {t("auth.register.switchToLogin", lang)}
        </button>
      </div>
    </form>
  );
}

/* ── Auth Gate ─────────────────────────────────────────────────────────── */

export function AuthGate({
  open,
  onLogin,
  onRegister,
  sessionEnd = null,
  serviceUnavailable = false,
  onRetry,
  pendingVerificationEmail = null,
  onPendingVerificationDismiss,
  verifiedNotice = false,
}: AuthGateProps) {
  const [mode, setMode] = React.useState<"login" | "register">("login");
  // The service panel is dismissable: the form underneath still works once
  // the backend answers, and a stuck panel would be its own way of locking
  // people out.
  const [showForm, setShowForm] = React.useState(false);
  const lang = useBrowserLang();

  if (!open) return null;

  const unavailable = serviceUnavailable && !showForm;
  const pending = pendingVerificationEmail !== null;
  const title = pending
    ? t("auth.register.pendingTitle", lang)
    : mode === "login" ? t("auth.login.title", lang) : t("auth.register.title", lang);
  const subtitle = pending
    ? `${t("auth.register.pendingBody", lang)} ${pendingVerificationEmail}`
    : mode === "login" ? t("auth.login.subtitle", lang) : t("auth.register.subtitle", lang);

  return (
    <div className="grid min-h-[100dvh] w-full bg-card lg:grid-cols-[minmax(0,1.12fr)_minmax(28rem,0.88fr)]">
      <BrandPanel lang={lang} />

      <section className="flex min-h-[100dvh] items-center justify-center bg-card px-5 pb-[max(2.5rem,env(safe-area-inset-bottom))] pt-[max(2.5rem,env(safe-area-inset-top))] sm:px-10 lg:px-12 lg:py-12 xl:px-20">
        <div className="w-full max-w-[27rem]">
          <div className="mb-12 flex items-center lg:hidden">
            <ReaigenLogo className="text-[26px]" />
          </div>

          <div className="mb-8">
            <p className="mb-4 text-[10px] font-bold uppercase tracking-[0.16em] text-foreground/40 lg:text-[11px]">
              {t("auth.brand.workspace", lang)}
            </p>
            <h1 className="text-[clamp(2.25rem,5vw,3.5rem)] font-semibold leading-[0.98] tracking-[-0.055em] text-foreground">
              {title}
            </h1>
            <p className="mt-3 text-[15px] leading-relaxed text-muted-foreground">
              {subtitle}
            </p>
          </div>

          {unavailable ? (
            <div className="space-y-4 rounded-2xl border border-border bg-surface-subtle px-5 py-5" role="alert" data-testid="service-unavailable">
              <div>
                <p className="text-[15px] font-semibold text-foreground">{t("auth.unavailable.title", lang)}</p>
                <p className="mt-1.5 text-[13px] leading-relaxed text-foreground/65">{t("auth.unavailable.body", lang)}</p>
              </div>
              <div className="flex flex-col gap-2 sm:flex-row">
                <Button type="button" className="h-12 rounded-full px-6 text-[14px] font-semibold shadow-none" onClick={onRetry}>
                  {t("auth.unavailable.retry", lang)}
                </Button>
                <button type="button" onClick={() => setShowForm(true)} className="h-12 rounded-full px-5 text-[13px] font-medium text-foreground/55 transition-colors hover:text-foreground">
                  {t("auth.login.submit", lang)}
                </button>
              </div>
            </div>
          ) : null}

          {pending && !unavailable ? (
            <div key="pending" className="animate-fade-in">
              <VerificationPendingCard
                lang={lang}
                email={pendingVerificationEmail}
                onBack={() => { onPendingVerificationDismiss?.(); setMode("login"); }}
              />
            </div>
          ) : null}

          <div key={mode} className={unavailable || pending ? "hidden" : "animate-fade-in"}>
            {mode === "login" ? (
              <LoginCard lang={lang} onSubmit={onLogin} onSwitchToRegister={() => setMode("register")} sessionEnd={sessionEnd} verifiedNotice={verifiedNotice} />
            ) : (
              <RegistrationCard lang={lang} onSubmit={onRegister} onSwitchToLogin={() => setMode("login")} />
            )}
          </div>

        </div>
      </section>
    </div>
  );
}
