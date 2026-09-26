"use client";

import * as React from "react";
import { Button } from "../lib/ui/button";
import { Checkbox } from "../lib/ui/checkbox";
import { FieldMessage, FormField, focusFirstInvalidField } from "../lib/ui/form-field";
import { Input } from "../lib/ui/input";
import { Label } from "../lib/ui/label";
import { requestPasswordReset, resendVerification, type StepUpChallenge } from "../lib/api/client";
import type { SessionEndReason } from "../lib/session-end";
import { getSafeApiErrorMessage, isEmailVerificationError } from "../lib/api/error-message";
import { isEmailAddress } from "../lib/form-validation";
import { getBrowserLanguage, t } from "../lib/i18n";
import type { LocaleKey } from "../lib/locales";
import { RegistrationLegalText } from "./content-documents";
import { useAuth } from "./hooks/use-auth";
import {
  AUTH_IMAGE_MEDIA,
  AUTH_IMAGE_PLACEHOLDER,
  AUTH_IMAGE_SIZES,
  AUTH_IMAGE_SRCSET,
} from "../lib/auth-brand-image";

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

/**
 * What the sign-in screens say when something did not go through.
 *
 * A failure is a soft tinted banner with a small mark, the same shape as
 * the field messages above it. A refusal the creator can act on (the address is not
 * verified yet) is a card in the same surface as the rest of the screen,
 * with a title and the action right there.
 */
function AuthNotice({ tone, message, title, children, testId }: {
  tone: "error" | "info";
  message: string;
  title?: string;
  children?: React.ReactNode;
  testId?: string;
}) {
  if (tone === "info") {
    return (
      <div role="status" data-tone="info" data-testid={testId} className="rounded-2xl border border-border bg-surface-subtle px-5 py-4">
        {title ? <p className="text-[14px] font-semibold text-foreground">{title}</p> : null}
        <p className={`text-[13px] leading-relaxed text-foreground/70${title ? " mt-1" : ""}`}>{message}</p>
        {children}
      </div>
    );
  }
  return (
    <div role="alert" data-tone="error" data-testid={testId} className="flex animate-fade-in items-start gap-2.5 rounded-2xl border border-destructive/15 bg-destructive/[0.04] px-4 py-3 text-[13px] leading-relaxed text-foreground/85">
      <svg aria-hidden="true" viewBox="0 0 16 16" className="mt-[3px] h-3.5 w-3.5 shrink-0 text-destructive" fill="currentColor">
        <path d="M8 1.5a6.5 6.5 0 1 1 0 13 6.5 6.5 0 0 1 0-13Zm0 3.25a.75.75 0 0 0-.75.75v3a.75.75 0 0 0 1.5 0v-3A.75.75 0 0 0 8 4.75Zm0 5.5a.875.875 0 1 0 0 1.75.875.875 0 0 0 0-1.75Z" />
      </svg>
      <span>{message}</span>
    </div>
  );
}

/* ── Shared input style ───────────────────────────────────────────────── */

const INPUT_CLASS =
  "h-[3.25rem] rounded-2xl border-border bg-card px-4 text-[15px] text-foreground shadow-[inset_0_1px_2px_rgba(0,0,0,0.04)] placeholder:text-foreground/35 transition-[border-color,box-shadow] duration-150 hover:border-foreground/35 focus-visible:border-foreground focus-visible:bg-card focus-visible:ring-0 focus-visible:shadow-[0_0_0_4px_rgba(0,0,0,0.07)]";

const PRIMARY_BUTTON_CLASS =
  "h-[3.25rem] w-full rounded-2xl text-[14px] font-semibold shadow-none transition-[background-color,color,transform] active:scale-[0.99] disabled:opacity-100 disabled:bg-foreground disabled:text-background";

const SECONDARY_BUTTON_CLASS =
  "h-[3.25rem] w-full rounded-2xl border border-border bg-card px-5 text-[14px] font-semibold text-foreground transition-[background-color,border-color,transform] hover:border-foreground/35 hover:bg-foreground/[0.025] active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2";


/* ── Field parts ──────────────────────────────────────────────────────── */

type IconName = "mail" | "lock" | "arrowLeft" | "eye" | "eyeOff" | "check" | "shield" | "caps";

const ICON_PATHS: Record<IconName, React.ReactNode> = {
  mail: (<><rect x="3" y="5" width="18" height="14" rx="2.5" /><path d="m4 7 8 6 8-6" /></>),
  lock: (<><rect x="4.5" y="10.5" width="15" height="10" rx="2.5" /><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" /><path d="M12 14.5v2.5" /></>),
  arrowLeft: (<path d="M19 12H5.5M11 5.5 4.5 12l6.5 6.5" />),
  eye: (<><path d="M2.75 12S6 5.75 12 5.75 21.25 12 21.25 12 18 18.25 12 18.25 2.75 12 2.75 12Z" /><circle cx="12" cy="12" r="3" /></>),
  eyeOff: (<><path d="M9.9 5.96A9.6 9.6 0 0 1 12 5.75C18 5.75 21.25 12 21.25 12a16 16 0 0 1-2.6 3.47M6.6 7.1C4.1 8.8 2.75 12 2.75 12S6 18.25 12 18.25a9.3 9.3 0 0 0 4.9-1.35" /><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" /><path d="m3.5 3.5 17 17" /></>),
  check: (<path d="m5 12.5 4.25 4.25L19 7" />),
  shield: (<><path d="M12 3 4.75 5.75v5.5c0 4.6 3.1 8.4 7.25 9.75 4.15-1.35 7.25-5.15 7.25-9.75v-5.5Z" /><path d="m9 12 2.1 2.1L15.25 10" /></>),
  caps: (<><path d="M12 4.5 5 11.5h3.75v4h6.5v-4H19Z" /><path d="M8.75 19.5h6.5" /></>),
};

function FieldIcon({ name, className = "" }: { name: IconName; className?: string }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" className={`h-[18px] w-[18px] shrink-0 ${className}`}>
      {ICON_PATHS[name]}
    </svg>
  );
}

type AuthInputProps = React.ComponentProps<typeof Input> & {
  /** Leading mark; names are left without one, their label says enough. */
  icon?: IconName;
  /** Shown at the right edge; the input reserves room for it. */
  trailing?: React.ReactNode;
};

/**
 * The sign-in field: an optional leading mark that names the field and
 * darkens while the field has focus, and an optional trailing slot for the
 * reveal toggle or a "valid" check.
 */
function AuthInput({ icon, trailing, className = "", ...props }: AuthInputProps) {
  return (
    <div className="group relative">
      {icon ? (
        <span className={`pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 transition-colors duration-150 ${props.error ? "text-destructive/70" : "text-foreground/35 group-focus-within:text-foreground"}`}>
          <FieldIcon name={icon} />
        </span>
      ) : null}
      <Input {...props} className={`${INPUT_CLASS} ${icon ? "pl-11" : ""} ${trailing ? "pr-12" : ""} ${className}`} />
      {trailing ? (
        <span className="absolute right-2 top-1/2 flex -translate-y-1/2 items-center">{trailing}</span>
      ) : null}
    </div>
  );
}

/**
 * Reveal toggle for a password field. It stays clickable but sits outside
 * the Tab order, so Tab moves field to field (email → password → confirm)
 * the way people expect on a sign-in form.
 */
function RevealToggle({ shown, onToggle, controls, lang }: { shown: boolean; onToggle: () => void; controls: string; lang: string }) {
  return (
    <button
      type="button"
      tabIndex={-1}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onToggle}
      aria-label={shown ? t("auth.password.hide", lang) : t("auth.password.show", lang)}
      aria-pressed={shown}
      aria-controls={controls}
      data-testid={`${controls}-reveal`}
      className="flex h-9 w-9 items-center justify-center rounded-xl text-foreground/45 transition-colors hover:bg-foreground/[0.05] hover:text-foreground"
    >
      <FieldIcon name={shown ? "eyeOff" : "eye"} />
    </button>
  );
}

function ValidMark() {
  return (
    <span className="flex h-9 w-9 items-center justify-center text-success" data-valid-mark>
      <FieldIcon name="check" className="h-4 w-4" />
    </span>
  );
}

/** Tracks Caps Lock from key events on a password field. */
function useCapsLock() {
  const [on, setOn] = React.useState(false);
  const read = React.useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (typeof e.getModifierState === "function") setOn(e.getModifierState("CapsLock"));
  }, []);
  return { capsLock: on, onKeyDown: read, onKeyUp: read, clear: () => setOn(false) };
}

/** Sits inside the password field, like the system's own Caps Lock mark, so nothing below moves. */
function CapsLockBadge({ lang }: { lang: string }) {
  const label = t("auth.field.capsLock", lang);
  return (
    <span role="status" title={label} data-testid="caps-lock-note" className="flex h-7 w-7 animate-fade-in items-center justify-center rounded-lg bg-warning/10 text-warning">
      <FieldIcon name="caps" className="h-4 w-4" />
      <span className="sr-only">{label}</span>
    </span>
  );
}

/*
 * The backend runs Django's password validators: at least 8 characters,
 * not entirely numeric, not a common password, not too close to the name
 * or email. The first two are checked here as the creator types; the last
 * two need the server's word lists, so the server's refusal covers them.
 */
function passwordRules(password: string) {
  return {
    length: password.length >= 8,
    notNumeric: password.length > 0 && !/^\d+$/.test(password),
  };
}

type Strength = "weak" | "fair" | "good" | "strong";

function passwordStrength(password: string): Strength {
  const rules = passwordRules(password);
  if (!rules.length || !rules.notNumeric) return "weak";
  const classes = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((re) => re.test(password)).length;
  if (password.length >= 12 && classes >= 3) return "strong";
  if (password.length >= 12 || classes >= 3) return "good";
  return "fair";
}

const STRENGTH_LEVEL: Record<Strength, number> = { weak: 1, fair: 2, good: 3, strong: 4 };
const STRENGTH_TONE: Record<Strength, string> = {
  weak: "bg-destructive",
  fair: "bg-warning",
  good: "bg-success/75",
  strong: "bg-success",
};

function PasswordChecklist({ password, lang, id }: { password: string; lang: string; id: string }) {
  const rules = passwordRules(password);
  const strength = passwordStrength(password);
  const level = password ? STRENGTH_LEVEL[strength] : 0;
  const items: Array<[boolean, LocaleKey]> = [
    [rules.length, "auth.register.ruleLength"],
    [rules.notNumeric, "auth.register.ruleNotNumeric"],
  ];
  return (
    <div id={id} className="space-y-2 pt-2" data-testid="password-checklist" data-strength={password ? strength : "empty"}>
      {/* A 4px line that is there from the start, so the first keystroke moves nothing. */}
      <div className="grid grid-cols-4 gap-1" aria-hidden="true">
        {[1, 2, 3, 4].map((step) => (
          <span key={step} className={`h-1 rounded-full transition-colors duration-200 ${step <= level ? STRENGTH_TONE[strength] : "bg-foreground/[0.06]"}`} />
        ))}
      </div>
      <div className="flex items-center gap-4">
        <ul className="flex min-w-0 flex-1 flex-wrap gap-x-4 gap-y-1">
          {items.map(([met, key]) => (
            <li key={key} data-met={met ? "true" : "false"} className={`flex items-center gap-1.5 text-[12px] transition-colors ${met ? "text-foreground/75" : "text-foreground/45"}`}>
              <span className={`flex h-3.5 w-3.5 items-center justify-center rounded-full transition-colors ${met ? "bg-success text-white" : "border border-foreground/20"}`}>
                {met ? <FieldIcon name="check" className="h-2.5 w-2.5 [stroke-width:3]" /> : null}
              </span>
              {t(key, lang)}
            </li>
          ))}
        </ul>
        <span className="shrink-0 text-[11px] font-semibold text-foreground/60" aria-live="polite">
          {password ? t(`auth.register.strength.${strength}` as LocaleKey, lang) : ""}
        </span>
      </div>
    </div>
  );
}

function SecurityNote({ lang }: { lang: string }) {
  return (
    <p className="flex items-center justify-center gap-1.5 text-[11px] font-medium text-foreground/45" data-testid="auth-security-note">
      <FieldIcon name="shield" className="h-3.5 w-3.5" />
      {t("auth.security.note", lang)}
    </p>
  );
}

/* ── Helpers ──────────────────────────────────────────────────────────── */

function useBrowserLang(): string {
  // AuthGate only mounts on the client, after the session check, so the
  // browser language is readable on the first render: no English flash.
  const [lang] = React.useState(() => (typeof navigator === "undefined" ? "en" : getBrowserLanguage()));
  // Screen readers pronounce the page in the language it is written in.
  React.useEffect(() => {
    const root = document.documentElement;
    const previous = root.lang;
    root.lang = lang;
    return () => { root.lang = previous; };
  }, [lang]);
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

function BrandPhoto() {
  const imgRef = React.useRef<HTMLImageElement>(null);
  const [loaded, setLoaded] = React.useState(false);
  // A preloaded or cached photo can finish before hydration attaches onLoad.
  React.useEffect(() => {
    const img = imgRef.current;
    if (img?.complete && img.naturalWidth > 0) setLoaded(true);
  }, []);
  return (
    <>
      <div
        aria-hidden="true"
        className="absolute inset-0 scale-110 bg-cover bg-center blur-2xl"
        style={{ backgroundImage: `url(${AUTH_IMAGE_PLACEHOLDER})` }}
      />
      {/* Below lg the panel is hidden, so only the inline placeholder is picked there. */}
      <picture>
        <source media={AUTH_IMAGE_MEDIA} srcSet={AUTH_IMAGE_SRCSET} sizes={AUTH_IMAGE_SIZES} type="image/webp" />
        <img
          ref={imgRef}
          src={AUTH_IMAGE_PLACEHOLDER}
          alt=""
          aria-hidden="true"
          decoding="async"
          fetchPriority="high"
          onLoad={(e) => { if (e.currentTarget.currentSrc.endsWith(".webp")) setLoaded(true); }}
          data-testid="auth-brand-photo"
          data-loaded={loaded ? "true" : "false"}
          className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-500 ease-out ${loaded ? "opacity-100" : "opacity-0"}`}
        />
      </picture>
    </>
  );
}

function BrandPanel({ lang }: { lang: string }) {
  return (
    <aside className="relative hidden h-[100dvh] overflow-hidden bg-[#8d877f] lg:block">
      <BrandPhoto />
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
          <span className="h-1.5 w-1.5 rounded-full bg-success ring-2 ring-success-foreground/25" aria-hidden="true" />
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
      {error ? <AuthNotice tone="error" message={error} /> : null}
      <Button
        type="button"
        variant="outline"
        className="h-[3.25rem] w-full rounded-2xl text-[14px] font-semibold shadow-none"
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
  onStepBackChange,
}: {
  lang: string;
  onSubmit: (email: string, password: string) => Promise<void | StepUpChallenge>;
  onSwitchToRegister: () => void;
  /** Hands the header's back arrow a way out of the code step, or null. */
  onStepBackChange?: (back: (() => void) | null) => void;
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
  // Known from the refusal itself, not from the wording: the message is
  // shown in the creator's language, so its text cannot be searched.
  const [verificationRequired, setVerificationRequired] = React.useState(false);
  const [emailTouched, setEmailTouched] = React.useState(false);
  const [passwordTouched, setPasswordTouched] = React.useState(false);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [resetSent, setResetSent] = React.useState(false);
  const [resetLoading, setResetLoading] = React.useState(false);
  const [stepUp, setStepUp] = React.useState<StepUpChallenge | null>(null);
  const [stepUpCode, setStepUpCode] = React.useState("");
  const [forgotNeedsEmail, setForgotNeedsEmail] = React.useState(false);
  const caps = useCapsLock();
  // Entering and leaving the code step tell the header in the same update,
  // so its back arrow never lags a frame behind the form.
  const leaveStepUp = React.useCallback(() => {
    setStepUp(null);
    setStepUpCode("");
    setError(null);
    onStepBackChange?.(null);
  }, [onStepBackChange]);
  React.useEffect(() => () => onStepBackChange?.(null), [onStepBackChange]);
  const emailIsValid = isEmailAddress(email);
  const canSubmit = emailIsValid && password.length > 0;
  // Leaving a field empty says nothing; "please enter …" waits for a submit.
  // A typed address that is not one is pointed out once the field is left.
  const emailError = forgotNeedsEmail && !emailIsValid ? t("auth.login.forgotNeedsEmail", lang)
    : emailTouched
      ? !email.trim() ? t("auth.field.emailRequired", lang) : !emailIsValid ? t("auth.field.emailInvalid", lang) : null
      : null;
  const passwordError = passwordTouched && !password ? t("auth.field.passwordRequired", lang) : null;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!canSubmit) {
      setEmailTouched(true);
      setPasswordTouched(true);
      focusFirstInvalidField([
        !emailIsValid && "login-email",
        !password && "login-password",
      ]);
      return;
    }
    try {
      setLoading(true);
      const result = await onSubmit(email.trim(), password);
      if (result && result.step_up_required) {
        setStepUp(result);
        setStepUpCode("");
        onStepBackChange?.(leaveStepUp);
      }
    } catch (err) {
      setVerificationRequired(isEmailVerificationError(err));
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
        {error && <AuthNotice tone="error" message={error} />}
        <Button type="submit" className={PRIMARY_BUTTON_CLASS} loading={loading} disabled={loading}>
          {t("auth.stepUp.submit", lang)}
        </Button>
        <button
          type="button"
          onClick={leaveStepUp}
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
      <div className="space-y-1">
        <FormField id="login-email" label={t("auth.login.emailLabel", lang)} error={emailError} reserveMessage>
          {(control) => (
            <AuthInput
              {...control}
              icon="mail"
              type="email"
              inputMode="email"
              autoCapitalize="none"
              spellCheck={false}
              value={email}
              onChange={(e) => { setEmail(e.target.value); setForgotNeedsEmail(false); if (error) setError(null); }}
              onBlur={() => { if (email.trim()) setEmailTouched(true); }}
              placeholder={t("auth.login.emailPlaceholder", lang)}
              autoComplete="username email"
              trailing={emailTouched && emailIsValid ? <ValidMark /> : undefined}
            />
          )}
        </FormField>

        <FormField id="login-password" label={t("auth.login.passwordLabel", lang)} error={passwordError} reserveMessage>
          {(control) => (
            <AuthInput
              {...control}
              icon="lock"
              type={showPassword ? "text" : "password"}
              value={password}
              onChange={(e) => { setPassword(e.target.value); if (error) setError(null); }}
              onKeyDown={caps.onKeyDown}
              onKeyUp={caps.onKeyUp}
              onBlur={caps.clear}
              placeholder={t("auth.login.passwordPlaceholder", lang)}
              autoComplete="current-password"
              className={caps.capsLock ? "pr-20" : undefined}
              trailing={(
                <>
                  {caps.capsLock ? <CapsLockBadge lang={lang} /> : null}
                  <RevealToggle shown={showPassword} onToggle={() => setShowPassword((v) => !v)} controls="login-password" lang={lang} />
                </>
              )}
            />
          )}
        </FormField>
      </div>

      {error && (
        <AuthNotice
          tone={verificationRequired ? "info" : "error"}
          title={verificationRequired ? t("auth.error.emailVerificationTitle", lang) : undefined}
          message={error}
          testId="login-notice"
        >
          {verificationRequired && emailIsValid ? (
            <Button
              type="button"
              variant="outline"
              className="mt-3 h-11 w-full rounded-xl text-[13px] font-semibold shadow-none"
              onClick={resendFromError}
              disabled={resendState !== "idle"}
              loading={resendState === "busy"}
              data-testid="login-resend-verification"
            >
              {resendState === "sent" ? t("auth.session.resent", lang) : t("auth.login.resendVerification", lang)}
            </Button>
          ) : null}
        </AuthNotice>
      )}

      <Button type="submit" className={PRIMARY_BUTTON_CLASS} loading={loading} disabled={loading}>
        {t("auth.login.submit", lang)}
      </Button>

      {/*
        After the submit button in the DOM so Tab goes email → password →
        Sign in. With no usable email it points back to the email field,
        whose reserved message line explains why, instead of sitting disabled.
      */}
      <div className="-mt-1 flex justify-center">
        <button
          type="button"
          disabled={resetLoading || resetSent}
          data-testid="login-forgot"
          onClick={async () => {
            if (!emailIsValid) {
              setForgotNeedsEmail(true);
              document.getElementById("login-email")?.focus();
              return;
            }
            setResetLoading(true);
            try { await requestPasswordReset(email.trim()); setResetSent(true); }
            catch (err) { setError(getSafeApiErrorMessage(err, lang)); }
            setResetLoading(false);
          }}
          className="rounded-lg px-2 py-1 text-[13px] font-medium text-foreground/60 underline-offset-4 transition-colors hover:text-foreground hover:underline disabled:no-underline disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          {resetSent ? t("auth.login.forgotSent", lang) : resetLoading ? t("auth.login.forgotSending", lang) : t("auth.login.forgot", lang)}
        </button>
      </div>

      <div className="flex items-center gap-3 pt-1" aria-hidden="true">
        <span className="h-px flex-1 bg-border" />
        <span className="text-[11px] font-medium uppercase tracking-[0.12em] text-foreground/35">{t("auth.login.socialDivider", lang)}</span>
        <span className="h-px flex-1 bg-border" />
      </div>

      <button type="button" onClick={onSwitchToRegister} className={SECONDARY_BUTTON_CLASS}>
        {t("auth.login.switchToRegister", lang)}
      </button>

      <SecurityNote lang={lang} />
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
  const [touched, setTouched] = React.useState({
    firstName: false,
    lastName: false,
    email: false,
    password: false,
    confirmPassword: false,
    terms: false,
  });
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const caps = useCapsLock();
  const emailIsValid = isEmailAddress(email);
  const rules = passwordRules(password);
  const passwordIsValid = rules.length && rules.notNumeric;
  const passwordsMatch = password === confirmPassword && confirmPassword.length > 0;
  // Email is the stable cross-platform account identifier. Name-derived
  // usernames collided whenever two people shared the same name, while iOS
  // already uses the normalized email for this backend-required field.
  const username = email.trim().toLowerCase();
  const canSubmit = firstName.trim().length > 0 && lastName.trim().length > 0 && emailIsValid && passwordIsValid && passwordsMatch && agreeToTerms;
  const touch = (key: keyof typeof touched) => setTouched((current) => ({ ...current, [key]: true }));
  // Tabbing past an empty field says nothing; "please enter …" waits for a
  // submit. Something typed is checked once the field is left.
  const touchIfFilled = (key: keyof typeof touched, value: string) => { if (value.trim()) touch(key); };
  const firstNameError = touched.firstName && !firstName.trim() ? t("auth.field.firstNameRequired", lang) : null;
  const lastNameError = touched.lastName && !lastName.trim() ? t("auth.field.lastNameRequired", lang) : null;
  // One line under the name row: two half-width messages would wrap.
  const nameError = firstNameError && lastNameError ? t("auth.field.nameRequired", lang) : firstNameError ?? lastNameError;
  const emailError = touched.email
    ? !email.trim() ? t("auth.field.emailRequired", lang) : !emailIsValid ? t("auth.field.emailInvalid", lang) : null
    : null;
  const passwordError = touched.password
    ? !password ? t("auth.field.newPasswordRequired", lang)
      : !rules.length ? t("auth.register.passwordShort", lang)
      : !rules.notNumeric ? t("auth.register.passwordNumeric", lang)
      : null
    : null;
  const confirmError = touched.confirmPassword
    ? !confirmPassword ? t("auth.field.confirmRequired", lang) : !passwordsMatch ? t("auth.register.passwordMismatch", lang) : null
    : null;
  const termsError = touched.terms && !agreeToTerms ? t("auth.register.termsRequired", lang) : null;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!canSubmit) {
      setTouched({ firstName: true, lastName: true, email: true, password: true, confirmPassword: true, terms: true });
      focusFirstInvalidField([
        !firstName.trim() && "register-first-name",
        !lastName.trim() && "register-last-name",
        !emailIsValid && "register-email",
        !passwordIsValid && "register-password",
        !passwordsMatch && "register-confirm",
        !agreeToTerms && "register-terms",
      ]);
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
      <div className="space-y-1">
        <div className="grid grid-cols-2 gap-x-3">
          <FormField id="register-first-name" label={t("auth.register.firstNameLabel", lang)} error={firstNameError} sharedMessageId="register-name-error">
            {(control) => (
              <AuthInput {...control} type="text" value={firstName} onChange={(e) => setFirstName(e.target.value)} onBlur={() => touchIfFilled("firstName", firstName)} autoComplete="given-name" />
            )}
          </FormField>
          <FormField id="register-last-name" label={t("auth.register.lastNameLabel", lang)} error={lastNameError} sharedMessageId="register-name-error">
            {(control) => (
              <AuthInput {...control} type="text" value={lastName} onChange={(e) => setLastName(e.target.value)} onBlur={() => touchIfFilled("lastName", lastName)} autoComplete="family-name" />
            )}
          </FormField>
          <div className="col-span-2 min-h-[1.625rem] pt-1.5">
            {nameError ? <FieldMessage id="register-name-error">{nameError}</FieldMessage> : null}
          </div>
        </div>

        <FormField id="register-email" label={t("auth.register.emailLabel", lang)} error={emailError} reserveMessage>
          {(control) => (
            <AuthInput
              {...control}
              icon="mail"
              type="email"
              inputMode="email"
              autoCapitalize="none"
              spellCheck={false}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onBlur={() => touchIfFilled("email", email)}
              autoComplete="email"
              trailing={touched.email && emailIsValid ? <ValidMark /> : undefined}
            />
          )}
        </FormField>

        <FormField id="register-password" label={t("auth.register.passwordLabel", lang)} error={passwordError} reserveMessage>
          {(control) => (
            <div>
              <AuthInput
                {...control}
                aria-describedby={[control["aria-describedby"], "register-password-rules"].filter(Boolean).join(" ")}
                icon="lock"
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onKeyDown={caps.onKeyDown}
                onKeyUp={caps.onKeyUp}
                onBlur={() => { touchIfFilled("password", password); caps.clear(); }}
                autoComplete="new-password"
                className={caps.capsLock ? "pr-20" : undefined}
                trailing={(
                  <>
                    {caps.capsLock ? <CapsLockBadge lang={lang} /> : null}
                    <RevealToggle shown={showPassword} onToggle={() => setShowPassword((v) => !v)} controls="register-password" lang={lang} />
                  </>
                )}
              />
              <PasswordChecklist password={password} lang={lang} id="register-password-rules" />
            </div>
          )}
        </FormField>

        <FormField id="register-confirm" label={t("auth.register.confirmLabel", lang)} error={confirmError} reserveMessage>
          {(control) => (
            <AuthInput
              {...control}
              icon="lock"
              type={showPassword ? "text" : "password"}
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              onKeyDown={caps.onKeyDown}
              onKeyUp={caps.onKeyUp}
              onBlur={() => { touchIfFilled("confirmPassword", confirmPassword); caps.clear(); }}
              autoComplete="new-password"
              className={caps.capsLock && passwordsMatch && passwordIsValid ? "pr-20" : undefined}
              trailing={caps.capsLock || (passwordsMatch && passwordIsValid) ? (
                <>
                  {caps.capsLock ? <CapsLockBadge lang={lang} /> : null}
                  {passwordsMatch && passwordIsValid ? <ValidMark /> : null}
                </>
              ) : undefined}
            />
          )}
        </FormField>
      </div>

      <div>
        <div className="flex items-start gap-2.5 text-[12px] text-foreground/60">
          <Checkbox
            id="register-terms"
            className="mt-0.5 border-foreground/20"
            checked={agreeToTerms}
            onCheckedChange={(checked) => { setAgreeToTerms(checked === true); touch("terms"); }}
            aria-label={t("auth.register.terms", lang)}
            aria-invalid={termsError ? true : undefined}
            aria-describedby={termsError ? "register-terms-error" : undefined}
          />
          <div className="min-w-0 leading-relaxed">
            <RegistrationLegalText lang={lang} />
          </div>
        </div>
        <div className="min-h-[1.625rem] pt-1.5">
          {termsError ? <FieldMessage id="register-terms-error">{termsError}</FieldMessage> : null}
        </div>
      </div>

      {error && <AuthNotice tone="error" message={error} testId="register-notice" />}

      <Button type="submit" className={PRIMARY_BUTTON_CLASS} loading={loading} disabled={loading}>
        {t("auth.register.submit", lang)}
      </Button>

      <button type="button" onClick={onSwitchToLogin} className="mx-auto flex h-10 items-center rounded-lg px-3 text-[13px] font-medium text-foreground/60 underline-offset-4 transition-colors hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        {t("auth.register.switchToLogin", lang)}
      </button>

      <SecurityNote lang={lang} />
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
  // Set while the sign-in form is on its verification-code step.
  const [stepBack, setStepBack] = React.useState<(() => void) | null>(null);
  const handleStepBackChange = React.useCallback((back: (() => void) | null) => setStepBack(() => back), []);
  const lang = useBrowserLang();
  const sectionRef = React.useRef<HTMLElement>(null);
  const view = pendingVerificationEmail !== null ? "pending" : mode;
  // Each view starts at its top; the longer register form may have been scrolled.
  React.useEffect(() => {
    sectionRef.current?.scrollTo({ top: 0 });
    window.scrollTo({ top: 0 });
  }, [view]);

  if (!open) return null;

  const unavailable = serviceUnavailable && !showForm;
  const pending = pendingVerificationEmail !== null;
  // The header arrow goes back one step: code → password form,
  // check-your-inbox → sign in, register → sign in.
  const goBack = unavailable ? null
    : pending ? () => { onPendingVerificationDismiss?.(); setMode("login"); }
    : mode === "register" ? () => setMode("login")
    : stepBack;
  const title = pending
    ? t("auth.register.pendingTitle", lang)
    : mode === "login" ? t("auth.login.title", lang) : t("auth.register.title", lang);
  const subtitle = pending
    ? `${t("auth.register.pendingBody", lang)} ${pendingVerificationEmail}`
    : mode === "login" ? t("auth.login.subtitle", lang) : t("auth.register.subtitle", lang);

  return (
    /*
     * On desktop the page itself never scrolls: the photo stays exactly one
     * screen tall and only the form column scrolls, with its scrollbar lane
     * kept open. Switching between sign-in and the longer register form then
     * moves nothing but the form, and the title sits at the same height in
     * every view instead of re-centring.
     */
    <div className="grid min-h-[100dvh] w-full bg-card lg:h-[100dvh] lg:grid-cols-[minmax(0,1.12fr)_minmax(28rem,0.88fr)] lg:overflow-hidden">
      <BrandPanel lang={lang} />

      <section ref={sectionRef} className="flex min-h-[100dvh] items-start justify-center bg-card px-5 pb-[max(2.5rem,env(safe-area-inset-bottom))] pt-[max(2.5rem,env(safe-area-inset-top))] [scrollbar-gutter:stable] sm:px-10 lg:h-[100dvh] lg:overflow-y-auto lg:px-12 lg:pb-12 lg:pt-[clamp(3rem,12vh,7.5rem)] xl:px-20">
        <div className="w-full max-w-[27rem]">
          <div className="mb-12 flex items-center lg:hidden">
            <ReaigenLogo className="text-[26px]" />
          </div>

          <div key={`head-${view}`} className="mb-8 animate-fade-in-up">
            {/* One fixed-height row for the back link or the kicker, so the title never shifts. */}
            <div className="mb-4 flex h-8 items-center">
              {goBack ? (
                <button
                  type="button"
                  onClick={goBack}
                  data-testid="auth-back"
                  className="group -mx-2 inline-flex h-8 items-center gap-1.5 rounded-lg px-2 text-[13px] font-medium text-foreground/55 transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <FieldIcon name="arrowLeft" className="h-4 w-4 transition-transform duration-150 group-hover:-translate-x-0.5" />
                  {t("auth.register.pendingBack", lang)}
                </button>
              ) : (
                <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-foreground/40 lg:text-[11px]">
                  {t("auth.brand.workspace", lang)}
                </p>
              )}
            </div>
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
            <div key="pending" className="animate-fade-in-up">
              <VerificationPendingCard
                lang={lang}
                email={pendingVerificationEmail}
                onBack={() => { onPendingVerificationDismiss?.(); setMode("login"); }}
              />
            </div>
          ) : null}

          <div key={mode} className={unavailable || pending ? "hidden" : "animate-fade-in-up"}>
            {mode === "login" ? (
              <LoginCard lang={lang} onSubmit={onLogin} onSwitchToRegister={() => setMode("register")} sessionEnd={sessionEnd} verifiedNotice={verifiedNotice} onStepBackChange={handleStepBackChange} />
            ) : (
              <RegistrationCard lang={lang} onSubmit={onRegister} onSwitchToLogin={() => setMode("login")} />
            )}
          </div>

        </div>
      </section>
    </div>
  );
}
