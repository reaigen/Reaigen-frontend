"use client";

import * as React from "react";
import { Button } from "../lib/ui/button";
import { Checkbox } from "../lib/ui/checkbox";
import { Input } from "../lib/ui/input";
import { Label } from "../lib/ui/label";
import { requestPasswordReset } from "../lib/api/client";
import { getSafeApiErrorMessage } from "../lib/api/error-message";
import { getBrowserLanguage, t } from "../lib/i18n";
import { RegistrationLegalText } from "./content-documents";

type RegisterData = {
  email: string;
  username: string;
  password: string;
  password_confirm: string;
  first_name: string;
  last_name: string;
  accept_privacy_policy: boolean;
  accept_terms: boolean;
};

type AuthGateProps = {
  open: boolean;
  onClose: () => void;
  onLogin: (email: string, password: string) => Promise<void>;
  onRegister: (data: RegisterData) => Promise<void>;
};

/* ── Shared input style ───────────────────────────────────────────────── */

const INPUT_CLASS =
  "border-black/[0.1] bg-white text-foreground placeholder:text-foreground/35 h-[46px] text-[14px] rounded-[12px] shadow-[0_1px_2px_rgba(0,0,0,0.04)] focus-visible:ring-0 focus-visible:border-foreground/30 focus-visible:shadow-[0_0_0_3px_rgba(0,0,0,0.04),0_1px_2px_rgba(0,0,0,0.04)] transition-all duration-150";

/* ── Helpers ──────────────────────────────────────────────────────────── */

function useBrowserLang(): string {
  const [lang, setLang] = React.useState("en");
  React.useEffect(() => { setLang(getBrowserLanguage()); }, []);
  return lang;
}

function ReaigenLogo() {
  return (
    <span
      className="text-[28px] text-foreground"
      style={{ fontFamily: "var(--font-brand), ui-serif, Georgia, serif", fontWeight: 400, letterSpacing: "0.01em" }}
    >
      Reaigen
    </span>
  );
}

/* ── Social sign-in ───────────────────────────────────────────────────── */

function SocialButtons({ lang }: { lang: string }) {
  return (
    <>
      <div className="flex items-center gap-3 pt-1">
        <div className="flex-1 h-px bg-foreground/[0.08]" />
        <span className="text-[11px] text-foreground/40 font-medium uppercase tracking-wider">{t("auth.login.socialDivider", lang)}</span>
        <div className="flex-1 h-px bg-foreground/[0.08]" />
      </div>
      <div className="grid grid-cols-2 gap-2.5">
        <button
          type="button"
          className="flex items-center justify-center gap-2.5 h-[46px] rounded-[12px] border border-black/[0.08] bg-white text-[13px] font-medium text-foreground/75 shadow-[0_1px_3px_rgba(0,0,0,0.04)] transition-all hover:shadow-[0_2px_8px_rgba(0,0,0,0.06)] hover:border-black/[0.12] active:scale-[0.98]"
        >
          <svg viewBox="0 0 24 24" className="h-[18px] w-[18px]" aria-hidden="true">
            <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/>
            <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
            <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
            <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
          </svg>
          {t("auth.social.google", lang)}
        </button>
        <button
          type="button"
          className="flex items-center justify-center gap-2.5 h-[46px] rounded-[12px] border border-black/[0.08] bg-white text-[13px] font-medium text-foreground/75 shadow-[0_1px_3px_rgba(0,0,0,0.04)] transition-all hover:shadow-[0_2px_8px_rgba(0,0,0,0.06)] hover:border-black/[0.12] active:scale-[0.98]"
        >
          <svg viewBox="0 0 24 24" className="h-[18px] w-[18px]" fill="currentColor" aria-hidden="true">
            <path d="M17.05 20.28c-.98.95-2.05.88-3.08.4-1.09-.5-2.08-.48-3.24 0-1.44.62-2.2.44-3.06-.4C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.8 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.31 2.99-2.54 4.09zM12.03 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25z"/>
          </svg>
          {t("auth.social.apple", lang)}
        </button>
      </div>
    </>
  );
}

/* ── Login Form ───────────────────────────────────────────────────────── */

function LoginCard({
  lang,
  onSubmit,
  onSwitchToRegister,
}: {
  lang: string;
  onSubmit: (email: string, password: string) => Promise<void>;
  onSwitchToRegister: () => void;
}) {
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [rememberMe, setRememberMe] = React.useState(true);
  const [showPassword, setShowPassword] = React.useState(false);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [resetSent, setResetSent] = React.useState(false);
  const [resetLoading, setResetLoading] = React.useState(false);
  const emailIsValid = /\S+@\S+\.\S+/.test(email.trim());
  const canSubmit = emailIsValid && password.length > 0;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!canSubmit) return;
    try {
      setLoading(true);
      await onSubmit(email.trim(), password);
    } catch (err) {
      setError(getSafeApiErrorMessage(err, lang));
    } finally {
      setLoading(false);
    }
  }

  return (
    <form className="space-y-5" onSubmit={handleSubmit}>
      <div className="space-y-1.5">
        <Label htmlFor="login-email" className="text-[12px] font-medium text-foreground/70">
          {t("auth.login.emailLabel", lang)}
        </Label>
        <Input
          id="login-email"
          type="email"
          placeholder={t("auth.login.emailPlaceholder", lang)}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="email"
          className={INPUT_CLASS}
        />
      </div>

      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <Label htmlFor="login-password" className="text-[12px] font-medium text-foreground/70">
            {t("auth.login.passwordLabel", lang)}
          </Label>
          <button
            type="button"
            tabIndex={-1}
            disabled={resetLoading || !emailIsValid}
            onClick={async () => {
              if (!emailIsValid) return;
              setResetLoading(true);
              try { await requestPasswordReset(email.trim()); setResetSent(true); }
              catch (err) { setError(getSafeApiErrorMessage(err, lang)); }
              setResetLoading(false);
            }}
            className="text-[11px] text-foreground/45 hover:text-foreground transition-colors disabled:opacity-40"
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
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            className={`${INPUT_CLASS} pr-14`}
          />
          <button
            type="button"
            tabIndex={-1}
            onClick={() => setShowPassword((v) => !v)}
            className="absolute right-3.5 top-1/2 -translate-y-1/2 text-[11px] font-medium text-foreground/45 hover:text-foreground transition-colors"
          >
            {showPassword ? t("common.hide", lang) : t("common.show", lang)}
          </button>
        </div>
      </div>

      <label className="flex items-center gap-2.5 text-[12px] text-foreground/60 cursor-pointer select-none">
        <Checkbox
          checked={rememberMe}
          onCheckedChange={(checked) => setRememberMe(checked === true)}
          tabIndex={-1}
          className="border-foreground/20"
        />
        {t("auth.login.rememberMe", lang)}
      </label>

      {error && (
        <p className="rounded-[10px] border border-destructive/25 bg-destructive/[0.04] px-3.5 py-2.5 text-[12px] text-destructive leading-relaxed">
          {error}
        </p>
      )}

      <Button
        type="submit"
        className="w-full h-[46px] text-[14px] font-semibold rounded-[12px] shadow-[0_1px_3px_rgba(0,0,0,0.1),0_1px_2px_rgba(0,0,0,0.06)] active:scale-[0.99] transition-transform"
        loading={loading}
        disabled={!canSubmit || loading}
      >
        {t("auth.login.submit", lang)}
      </Button>

      <SocialButtons lang={lang} />

      <div className="pt-3 text-center">
        <button type="button" onClick={onSwitchToRegister} className="text-[12px] text-foreground/50 hover:text-foreground transition-colors">
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
  const passwordIsValid = password.trim().length >= 8;
  const passwordsMatch = password === confirmPassword && confirmPassword.length > 0;
  const username = `${firstName.trim().toLowerCase()}_${lastName.trim().toLowerCase()}`.replace(/\s+/g, "");
  const canSubmit = firstName.trim().length > 0 && lastName.trim().length > 0 && emailIsValid && passwordIsValid && passwordsMatch && agreeToTerms;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!canSubmit) return;
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
      });
    } catch (err) {
      setError(getSafeApiErrorMessage(err, lang));
    } finally {
      setLoading(false);
    }
  }

  return (
    <form className="space-y-4" onSubmit={handleSubmit}>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="register-first-name" className="text-[12px] font-medium text-foreground/70">
            {t("auth.register.firstNameLabel", lang)}
          </Label>
          <Input id="register-first-name" type="text" placeholder={t("auth.register.firstNamePlaceholder", lang)}
            value={firstName} onChange={(e) => setFirstName(e.target.value)} autoComplete="given-name" className={INPUT_CLASS} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="register-last-name" className="text-[12px] font-medium text-foreground/70">
            {t("auth.register.lastNameLabel", lang)}
          </Label>
          <Input id="register-last-name" type="text" placeholder={t("auth.register.lastNamePlaceholder", lang)}
            value={lastName} onChange={(e) => setLastName(e.target.value)} autoComplete="family-name" className={INPUT_CLASS} />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="register-email" className="text-[12px] font-medium text-foreground/70">
          {t("auth.register.emailLabel", lang)}
        </Label>
        <Input id="register-email" type="email" placeholder={t("auth.register.emailPlaceholder", lang)}
          value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" className={INPUT_CLASS} />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="register-password" className="text-[12px] font-medium text-foreground/70">
            {t("auth.register.passwordLabel", lang)}
          </Label>
          <div className="relative">
            <Input id="register-password" type={showPassword ? "text" : "password"} placeholder={t("auth.register.passwordPlaceholder", lang)}
              value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" className={`${INPUT_CLASS} pr-14`} />
            <button type="button" onClick={() => setShowPassword((v) => !v)}
              className="absolute right-3.5 top-1/2 -translate-y-1/2 text-[11px] font-medium text-foreground/45 hover:text-foreground transition-colors">
              {showPassword ? t("common.hide", lang) : t("common.show", lang)}
            </button>
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="register-confirm" className="text-[12px] font-medium text-foreground/70">
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
        <p className="rounded-[10px] border border-destructive/25 bg-destructive/[0.04] px-3.5 py-2.5 text-[12px] text-destructive leading-relaxed">
          {error}
        </p>
      )}

      <Button
        type="submit"
        className="w-full h-[46px] text-[14px] font-semibold rounded-[12px] shadow-[0_1px_3px_rgba(0,0,0,0.1),0_1px_2px_rgba(0,0,0,0.06)] active:scale-[0.99] transition-transform"
        loading={loading}
        disabled={!canSubmit || loading}
      >
        {t("auth.register.submit", lang)}
      </Button>

      <SocialButtons lang={lang} />

      <div className="pt-3 text-center">
        <button type="button" onClick={onSwitchToLogin} className="text-[12px] text-foreground/50 hover:text-foreground transition-colors">
          {t("auth.register.switchToLogin", lang)}
        </button>
      </div>
    </form>
  );
}

/* ── Auth Gate ─────────────────────────────────────────────────────────── */

export function AuthGate({ open, onLogin, onRegister }: AuthGateProps) {
  const [mode, setMode] = React.useState<"login" | "register">("login");
  const lang = useBrowserLang();

  if (!open) return null;

  return (
    <div className="w-full sm:max-w-[26rem] sm:mx-auto">
      <div className="bg-white min-h-[100dvh] px-6 py-10 sm:min-h-0 sm:border sm:border-black/[0.06] sm:rounded-[20px] sm:shadow-[0_30px_100px_-12px_rgba(0,0,0,0.14),0_4px_12px_-2px_rgba(0,0,0,0.05),0_0_0_1px_rgba(0,0,0,0.02)] sm:px-9 sm:py-10">
        {/* Header */}
        <div className="mb-8">
          <ReaigenLogo />
          <h1 className="text-[22px] font-semibold tracking-[-0.01em] mt-5 text-foreground">
            {mode === "login" ? t("auth.login.title", lang) : t("auth.register.title", lang)}
          </h1>
          <p className="text-[13px] text-foreground/45 mt-1.5 leading-relaxed">
            {mode === "login" ? t("auth.login.subtitle", lang) : t("auth.register.subtitle", lang)}
          </p>
        </div>

        {/* Form */}
        {mode === "login" ? (
          <LoginCard lang={lang} onSubmit={onLogin} onSwitchToRegister={() => setMode("register")} />
        ) : (
          <RegistrationCard lang={lang} onSubmit={onRegister} onSwitchToLogin={() => setMode("login")} />
        )}
      </div>
    </div>
  );
}
