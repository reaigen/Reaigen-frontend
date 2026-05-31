"use client";

import * as React from "react";

import { AnimatePresence, motion } from "framer-motion";
import { Button } from "../lib/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../lib/ui/card";
import { Checkbox } from "../lib/ui/checkbox";
import { Input } from "../lib/ui/input";
import { Label } from "../lib/ui/label";
import { ApiError, requestPasswordReset } from "../lib/api/client";
import { t } from "../lib/i18n";

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

const AUTH_FOCUS_RESET =
  "focus:outline-none focus-visible:outline-none focus-visible:ring-0 focus-visible:ring-transparent focus-visible:ring-offset-0";

/* ── responsive class tokens ─────────────────────────────────────────── */

const AUTH_LABEL_CLASS = "text-[13px] sm:text-[12px] text-foreground/82";

const AUTH_INPUT_CLASS =
  `border-foreground/[0.22] bg-white text-foreground placeholder:text-foreground/48 shadow-[inset_0_1px_0_rgba(255,255,255,0.7)] ${AUTH_FOCUS_RESET} focus-visible:border-foreground/60 focus-visible:shadow-[0_0_0_1px_rgba(15,23,42,0.14)] h-[52px] text-[16px] rounded-[14px] sm:h-11 sm:text-sm sm:rounded-xl`;

const AUTH_CHECKBOX_CLASS =
  `border-foreground/[0.26] ${AUTH_FOCUS_RESET} focus-visible:border-foreground/60`;
const AUTH_TEXT_BUTTON_CLASS = `${AUTH_FOCUS_RESET} transition-colors`;
const AUTH_SWITCH_EASE: [number, number, number, number] = [0.76, 0, 0.24, 1];
const AUTH_SWITCH_DURATION = 0.52;

/* ── browser language detection (pre-login, no user object) ──────────── */

function useBrowserLang(): string {
  const [lang, setLang] = React.useState("en");
  React.useEffect(() => {
    const raw = navigator.language?.slice(0, 2).toLowerCase() ?? "en";
    const supported = ["en", "sk", "cs", "de"];
    setLang(supported.includes(raw) ? raw : "en");
  }, []);
  return lang;
}

/* ── social sign-in ──────────────────────────────────────────────────── */

function SocialSignInButtons({ lang }: { lang: string }) {
  return (
    <>
      <div className="flex items-center gap-3 my-2 sm:my-1">
        <div className="flex-1 h-px bg-foreground/[0.12]" />
        <span className="text-[12px] sm:text-[11px] text-foreground/58 font-medium">
          {t("auth.login.socialDivider", lang)}
        </span>
        <div className="flex-1 h-px bg-foreground/[0.12]" />
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-2.5">
        <button
          type="button"
          className={`flex items-center justify-center gap-2.5 h-[52px] sm:h-12 rounded-[14px] sm:rounded-xl border border-foreground/[0.14] bg-white hover:bg-foreground/[0.04] text-[15px] sm:text-[14px] font-semibold text-foreground shadow-sm ${AUTH_TEXT_BUTTON_CLASS}`}
        >
          <svg viewBox="0 0 24 24" className="h-[21px] w-[21px]" aria-hidden="true">
            <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/>
            <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
            <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
            <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
          </svg>
          {t("auth.social.google", lang)}
        </button>
        <button
          type="button"
          className={`flex items-center justify-center gap-2.5 h-[52px] sm:h-12 rounded-[14px] sm:rounded-xl border border-foreground/[0.14] bg-white hover:bg-foreground/[0.04] text-[15px] sm:text-[14px] font-medium text-black shadow-sm ${AUTH_TEXT_BUTTON_CLASS}`}
        >
          <svg viewBox="0 0 24 24" className="h-[22px] w-[22px]" fill="black" aria-hidden="true">
            <path d="M17.05 20.28c-.98.95-2.05.88-3.08.4-1.09-.5-2.08-.48-3.24 0-1.44.62-2.2.44-3.06-.4C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.8 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.31 2.99-2.54 4.09zM12.03 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25z"/>
          </svg>
          {t("auth.social.apple", lang)}
        </button>
      </div>
    </>
  );
}

/* ── helpers ──────────────────────────────────────────────────────────── */

function parseApiError(err: unknown): string {
  if (err instanceof ApiError) {
    try {
      const body = JSON.parse(err.body);
      return body.detail ?? body.error ?? Object.values(body).flat().join(", ") ?? "Request failed";
    } catch {
      return err.body || "Request failed";
    }
  }
  return err instanceof Error ? err.message : "Unknown error";
}

function ReaigenLogo() {
  return (
    <div className="mb-4">
      <span
        className="text-[32px] sm:text-[28px] text-foreground"
        style={{ fontFamily: 'var(--font-brand), ui-serif, Georgia, serif', fontWeight: 500, letterSpacing: '0.03em' }}
      >
        Reaigen
      </span>
    </div>
  );
}

/* ── login card ──────────────────────────────────────────────────────── */

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

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    if (!canSubmit) return;
    try {
      setLoading(true);
      await onSubmit(email.trim(), password);
    } catch (err) {
      setError(parseApiError(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card
      className={
        "w-full bg-white" +
        " border-0 shadow-none rounded-none min-h-[100dvh] flex flex-col" +
        " sm:w-[34rem] sm:border sm:border-foreground/[0.16] sm:shadow-[0_28px_90px_rgba(15,23,42,0.20)] sm:rounded-2xl sm:min-h-0 sm:block"
      }
    >
      <div className="pt-safe sm:hidden" aria-hidden="true" />

      <CardHeader className="pb-3 pt-10 px-6  sm:pb-2 sm:pt-7 sm:px-7">
        <ReaigenLogo />
        <CardTitle className="text-foreground text-[26px] sm:text-[20px] pt-1">
          {t("auth.login.title", lang)}
        </CardTitle>
        <CardDescription className="text-foreground/62 text-[15px] sm:text-[13px]">
          {t("auth.login.subtitle", lang)}
        </CardDescription>
      </CardHeader>

      <CardContent className="px-6 pb-0 flex-1 flex flex-col  sm:px-7 sm:pb-7 sm:flex-none sm:block">
        <form className="space-y-5 sm:space-y-4" onSubmit={handleSubmit}>
          <div className="space-y-1.5">
            <Label htmlFor="login-email" required className={AUTH_LABEL_CLASS}>
              {t("auth.login.emailLabel", lang)}
            </Label>
            <Input
              id="login-email"
              type="email"
              placeholder={t("auth.login.emailPlaceholder", lang)}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              className={AUTH_INPUT_CLASS}
            />
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-3">
              <Label htmlFor="login-password" required className={AUTH_LABEL_CLASS}>
                {t("auth.login.passwordLabel", lang)}
              </Label>
              <button
                type="button"
                tabIndex={-1}
                disabled={resetLoading || !emailIsValid}
                onClick={async () => {
                  if (!emailIsValid) return;
                  setResetLoading(true);
                  try {
                    await requestPasswordReset(email.trim());
                    setResetSent(true);
                  } catch (err) {
                    setError(parseApiError(err));
                  }
                  setResetLoading(false);
                }}
                className={`inline-flex items-center text-[12px] sm:text-[11px] text-foreground/60 hover:text-foreground disabled:opacity-40 ${AUTH_TEXT_BUTTON_CLASS}`}
              >
                {resetSent
                  ? t("auth.login.forgotSent", lang)
                  : resetLoading
                    ? t("auth.login.forgotSending", lang)
                    : t("auth.login.forgot", lang)}
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
                className={`${AUTH_INPUT_CLASS} pr-14 sm:pr-12`}
              />
              <button
                type="button"
                tabIndex={-1}
                onClick={() => setShowPassword((v) => !v)}
                className={`absolute right-3.5 sm:right-3 top-1/2 -translate-y-1/2 text-[13px] sm:text-[11px] font-medium text-foreground/62 hover:text-foreground ${AUTH_TEXT_BUTTON_CLASS}`}
              >
                {showPassword ? "Hide" : "Show"}
              </button>
            </div>
          </div>

          <label className="flex items-center gap-2.5 sm:gap-2 text-[14px] sm:text-[12px] text-foreground/72 cursor-pointer" tabIndex={-1}>
            <Checkbox
              className={AUTH_CHECKBOX_CLASS}
              checked={rememberMe}
              onCheckedChange={(checked) => setRememberMe(checked === true)}
              tabIndex={-1}
            />
            {t("auth.login.rememberMe", lang)}
          </label>

          {error && (
            <p className="rounded-xl border border-destructive/35 bg-destructive/6 px-3.5 py-2.5 text-[13px] sm:text-[12px] text-destructive">
              {error}
            </p>
          )}

          <Button
            type="submit"
            className={`w-full h-[52px] text-[16px] rounded-[14px] sm:h-11 sm:text-[14px] sm:rounded-xl ${AUTH_FOCUS_RESET}`}
            loading={loading}
            disabled={!canSubmit || loading}
          >
            {t("auth.login.submit", lang)}
          </Button>

          <SocialSignInButtons lang={lang} />
        </form>

        <div className="mt-auto pt-6 pb-4 sm:mt-4 sm:pt-1 sm:pb-0 flex items-center justify-center text-[14px] sm:text-[12px] text-foreground/62">
          <button type="button" onClick={onSwitchToRegister} className={`hover:text-foreground ${AUTH_TEXT_BUTTON_CLASS}`}>
            {t("auth.login.switchToRegister", lang)}
          </button>
        </div>

        <div className="pb-safe sm:hidden" aria-hidden="true" />
      </CardContent>
    </Card>
  );
}

/* ── registration card ───────────────────────────────────────────────── */

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

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
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
      setError(parseApiError(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card
      className={
        "w-full bg-white" +
        " border-0 shadow-none rounded-none min-h-[100dvh] flex flex-col" +
        " sm:w-[38rem] sm:border sm:border-foreground/[0.16] sm:shadow-[0_28px_90px_rgba(15,23,42,0.20)] sm:rounded-2xl sm:min-h-0 sm:block"
      }
    >
      <div className="pt-safe sm:hidden" aria-hidden="true" />

      <CardHeader className="pb-3 pt-10 px-6  sm:pb-2 sm:pt-8 sm:px-8">
        <ReaigenLogo />
        <CardTitle className="text-foreground text-[26px] sm:text-[20px] pt-1">
          {t("auth.register.title", lang)}
        </CardTitle>
        <CardDescription className="text-foreground/62 text-[15px] sm:text-[13px]">
          {t("auth.register.subtitle", lang)}
        </CardDescription>
      </CardHeader>

      <CardContent className="px-6 pb-0 flex-1 flex flex-col  sm:px-8 sm:pb-8 sm:flex-none sm:block">
        <form className="space-y-5 sm:space-y-4" onSubmit={handleSubmit}>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="register-first-name" required className={AUTH_LABEL_CLASS}>
                {t("auth.register.firstNameLabel", lang)}
              </Label>
              <Input id="register-first-name" type="text" placeholder={t("auth.register.firstNamePlaceholder", lang)} value={firstName}
                onChange={(e) => setFirstName(e.target.value)} autoComplete="given-name" className={AUTH_INPUT_CLASS} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="register-last-name" required className={AUTH_LABEL_CLASS}>
                {t("auth.register.lastNameLabel", lang)}
              </Label>
              <Input id="register-last-name" type="text" placeholder={t("auth.register.lastNamePlaceholder", lang)} value={lastName}
                onChange={(e) => setLastName(e.target.value)} autoComplete="family-name" className={AUTH_INPUT_CLASS} />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="register-email" required className={AUTH_LABEL_CLASS}>
              {t("auth.register.emailLabel", lang)}
            </Label>
            <Input id="register-email" type="email" placeholder={t("auth.register.emailPlaceholder", lang)} value={email}
              onChange={(e) => setEmail(e.target.value)} autoComplete="email" className={AUTH_INPUT_CLASS} />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="register-password" required className={AUTH_LABEL_CLASS}>
                {t("auth.register.passwordLabel", lang)}
              </Label>
              <div className="relative">
                <Input id="register-password" type={showPassword ? "text" : "password"} placeholder={t("auth.register.passwordPlaceholder", lang)}
                  value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" className={`${AUTH_INPUT_CLASS} pr-14 sm:pr-12`} />
                <button type="button" onClick={() => setShowPassword((v) => !v)}
                  className={`absolute right-3.5 sm:right-3 top-1/2 -translate-y-1/2 text-[13px] sm:text-[11px] font-medium text-foreground/62 hover:text-foreground ${AUTH_TEXT_BUTTON_CLASS}`}>
                  {showPassword ? "Hide" : "Show"}
                </button>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="register-confirm" required className={AUTH_LABEL_CLASS}>
                {t("auth.register.confirmLabel", lang)}
              </Label>
              <Input id="register-confirm" type="password" placeholder={t("auth.register.confirmPlaceholder", lang)}
                value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} autoComplete="new-password" className={AUTH_INPUT_CLASS} />
            </div>
          </div>
          {!passwordsMatch && confirmPassword.length > 0 && (
            <p className="text-[12px] sm:text-[11px] font-medium text-destructive">
              {t("auth.register.passwordMismatch", lang)}
            </p>
          )}

          <label className="flex items-center gap-2.5 sm:gap-2 text-[14px] sm:text-[12px] text-foreground/72 cursor-pointer">
            <Checkbox className={AUTH_CHECKBOX_CLASS} checked={agreeToTerms} onCheckedChange={(checked) => setAgreeToTerms(checked === true)} />
            {t("auth.register.terms", lang)}
          </label>

          {error && (
            <p className="rounded-xl border border-destructive/35 bg-destructive/6 px-3.5 py-2.5 text-[13px] sm:text-[12px] text-destructive">
              {error}
            </p>
          )}

          <Button
            type="submit"
            className={`w-full h-[52px] text-[16px] rounded-[14px] sm:h-11 sm:text-[14px] sm:rounded-xl ${AUTH_FOCUS_RESET}`}
            loading={loading}
            disabled={!canSubmit || loading}
          >
            {t("auth.register.submit", lang)}
          </Button>

          <SocialSignInButtons lang={lang} />
        </form>

        <div className="mt-auto pt-6 pb-4 sm:mt-4 sm:pt-1 sm:pb-0 flex items-center justify-center text-[14px] sm:text-[12px] text-foreground/62">
          <button type="button" onClick={onSwitchToLogin} className={`hover:text-foreground ${AUTH_TEXT_BUTTON_CLASS}`}>
            {t("auth.register.switchToLogin", lang)}
          </button>
        </div>

        <div className="pb-safe sm:hidden" aria-hidden="true" />
      </CardContent>
    </Card>
  );
}

/* ── auth gate ───────────────────────────────────────────────────────── */

export function AuthGate({ open, onClose, onLogin, onRegister }: AuthGateProps) {
  const [mode, setMode] = React.useState<"login" | "register">("login");
  const lang = useBrowserLang();

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[9999] flex items-start justify-center overflow-y-auto bg-[hsl(var(--muted))]/35 sm:items-center">
      <motion.div
        layout
        className="relative w-full sm:w-auto"
        transition={{
          layout: { duration: AUTH_SWITCH_DURATION, ease: AUTH_SWITCH_EASE },
        }}
      >
        <AnimatePresence initial={false} mode="wait">
          <motion.div
            key={mode}
            layout
            initial={{ opacity: 0, scale: 1.035, y: 16 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.94, y: 10 }}
            transition={{ duration: AUTH_SWITCH_DURATION, ease: AUTH_SWITCH_EASE }}
            style={{ transformOrigin: "50% 50%" }}
          >
            {mode === "login" ? (
              <LoginCard
                lang={lang}
                onSubmit={async (email, password) => { await onLogin(email, password); onClose(); }}
                onSwitchToRegister={() => setMode("register")}
              />
            ) : (
              <RegistrationCard
                lang={lang}
                onSubmit={async (data) => { await onRegister(data); onClose(); }}
                onSwitchToLogin={() => setMode("login")}
              />
            )}
          </motion.div>
        </AnimatePresence>
      </motion.div>
    </div>
  );
}
