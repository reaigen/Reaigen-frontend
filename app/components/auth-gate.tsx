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
  "border-border/60 bg-background text-foreground placeholder:text-foreground/40 h-11 text-[14px] rounded-md shadow-none focus-visible:ring-0 focus-visible:border-foreground/40 focus-visible:shadow-[0_0_0_3px_rgba(0,0,0,0.05)] transition-colors duration-150";

/* ── Helpers ──────────────────────────────────────────────────────────── */

function useBrowserLang(): string {
  const [lang, setLang] = React.useState("en");
  React.useEffect(() => { setLang(getBrowserLanguage()); }, []);
  return lang;
}

function ReaigenLogo() {
  return (
    <span
      className="text-[19px] text-foreground/90"
      style={{ fontFamily: "var(--font-brand), ui-serif, Georgia, serif", fontWeight: 500, letterSpacing: "0.01em" }}
    >
      Reaigen
    </span>
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
        <Label htmlFor="login-email" className="text-[13px] font-medium text-foreground">
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
            className="rounded-md text-[12px] text-foreground/55 hover:text-foreground transition-colors disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
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
            onClick={() => setShowPassword((v) => !v)}
            className="absolute right-3.5 top-1/2 -translate-y-1/2 rounded-md text-[12px] font-medium text-foreground/55 hover:text-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            {showPassword ? t("common.hide", lang) : t("common.show", lang)}
          </button>
        </div>
      </div>

      {error && (
        <p className="rounded-md border border-destructive/25 bg-destructive/[0.04] px-3.5 py-2.5 text-[12px] text-destructive leading-relaxed">
          {error}
        </p>
      )}

      <Button
        type="submit"
        className={`w-full h-11 text-[14px] font-semibold rounded-md shadow-none transition-colors disabled:opacity-100 ${loading ? "disabled:bg-foreground disabled:text-background" : "disabled:bg-foreground/[0.07] disabled:text-foreground/35"}`}
        loading={loading}
        disabled={!canSubmit || loading}
      >
        {t("auth.login.submit", lang)}
      </Button>

      <div className="pt-3 text-center">
        <button type="button" onClick={onSwitchToRegister} className="text-[13px] font-medium text-foreground/70 hover:text-foreground transition-colors">
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

      <div className="grid grid-cols-2 gap-3">
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
        <p className="rounded-md border border-destructive/25 bg-destructive/[0.04] px-3.5 py-2.5 text-[12px] text-destructive leading-relaxed">
          {error}
        </p>
      )}

      <Button
        type="submit"
        className={`w-full h-11 text-[14px] font-semibold rounded-md shadow-none transition-colors disabled:opacity-100 ${loading ? "disabled:bg-foreground disabled:text-background" : "disabled:bg-foreground/[0.07] disabled:text-foreground/35"}`}
        loading={loading}
        disabled={!canSubmit || loading}
      >
        {t("auth.register.submit", lang)}
      </Button>

      <div className="pt-3 text-center">
        <button type="button" onClick={onSwitchToLogin} className="text-[13px] font-medium text-foreground/70 hover:text-foreground transition-colors">
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
    <div className="w-full md:max-w-[26rem] md:mx-auto">
      <div className="bg-background min-h-[100dvh] px-6 py-10 md:min-h-0 md:border md:border-border/60 md:rounded-xl md:shadow-[0_8px_30px_rgba(0,0,0,0.06)] md:px-9 md:py-10">
        {/* Header */}
        <div className="mb-8">
          <ReaigenLogo />
          <h1 className="text-[22px] font-semibold tracking-tight mt-7 text-foreground">
            {mode === "login" ? t("auth.login.title", lang) : t("auth.register.title", lang)}
          </h1>
          <p className="text-[13px] text-foreground/55 mt-1 leading-relaxed">
            {mode === "login" ? t("auth.login.subtitle", lang) : t("auth.register.subtitle", lang)}
          </p>
        </div>

        {/* Form */}
        <div key={mode} className="animate-fade-in">
          {mode === "login" ? (
            <LoginCard lang={lang} onSubmit={onLogin} onSwitchToRegister={() => setMode("register")} />
          ) : (
            <RegistrationCard lang={lang} onSubmit={onRegister} onSwitchToLogin={() => setMode("login")} />
          )}
        </div>
      </div>
    </div>
  );
}
