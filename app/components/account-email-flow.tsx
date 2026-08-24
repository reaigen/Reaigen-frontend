"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "../lib/ui/button";
import { Input } from "../lib/ui/input";
import {
  ApiError,
  confirmPasswordReset,
  confirmPasswordResetSMS,
  requestPasswordReset,
  requestPasswordResetSMS,
  validatePasswordReset,
  verifyEmail,
} from "../lib/api/client";
import { getBrowserLanguage } from "../lib/i18n";

const INPUT_CLASS =
  "h-14 rounded-xl border-border bg-white px-4 text-[15px] text-foreground shadow-none placeholder:text-foreground/35 hover:border-foreground/35 focus-visible:border-foreground focus-visible:ring-0 focus-visible:shadow-[0_0_0_3px_rgba(0,0,0,0.08)]";

const COPY = {
  en: {
    workspace: "Creator workspace",
    brandTitle: "Turn spaces into stories.",
    verifying: "Verifying your email",
    verifyingBody: "Please wait while we confirm your Reaigen account.",
    verified: "Email verified",
    verifiedBody: "Your Reaigen account is active and ready to use.",
    verifyFailed: "This verification link is invalid or has expired.",
    verifyMissing: "The verification link is incomplete.",
    openWorkspace: "Open workspace",
    signIn: "Back to sign in",
    forgotTitle: "Reset your password",
    forgotBody: "Choose how you want to reset your password.",
    emailMethod: "Email",
    smsMethod: "SMS",
    email: "Email address",
    phone: "Verified phone number",
    phoneHint: "Use the international format, for example +421 901 234 567.",
    sendReset: "Send reset link",
    sendCode: "Send code",
    resetSent: "Check your inbox",
    resetSentBody: "If an account exists for this email, a reset link has been sent.",
    codeSent: "Enter the code",
    codeSentBody: "If this verified phone belongs to an account, a six-digit code has been sent.",
    code: "Six-digit code",
    resetWithCode: "Save new password",
    newPasswordTitle: "Create a new password",
    newPasswordBody: "Choose a strong password with at least 8 characters.",
    validatingReset: "Checking your link",
    validatingResetBody: "Please wait while we prepare your password reset.",
    invalidResetTitle: "Request a new reset link",
    invalidResetBody: "This link can no longer be used. Request a new one to continue.",
    requestNewLink: "Request new link",
    password: "New password",
    confirmPassword: "Confirm new password",
    savePassword: "Save new password",
    passwordChanged: "Password updated",
    passwordChangedBody: "Your password was changed successfully. You can now sign in.",
    mismatch: "The passwords do not match.",
    resetFailed: "This reset link is invalid or has expired.",
    codeFailed: "The code is invalid or has expired.",
    passwordRejected: "Choose a different password and try again.",
    samePassword: "Your new password must be different from your current password.",
    passwordHint: "Use at least 8 characters. Avoid common, entirely numeric, or account-related passwords.",
  },
  sk: {
    workspace: "Tvorivý priestor",
    brandTitle: "Premeňte priestory na príbehy.",
    verifying: "Overujeme váš e-mail",
    verifyingBody: "Počkajte, kým potvrdíme váš účet Reaigen.",
    verified: "E-mail bol overený",
    verifiedBody: "Váš účet Reaigen je aktívny a pripravený na používanie.",
    verifyFailed: "Tento overovací odkaz je neplatný alebo vypršal.",
    verifyMissing: "Overovací odkaz nie je úplný.",
    openWorkspace: "Otvoriť pracovný priestor",
    signIn: "Späť na prihlásenie",
    forgotTitle: "Obnovte svoje heslo",
    forgotBody: "Vyberte si spôsob obnovenia hesla.",
    emailMethod: "E-mail",
    smsMethod: "SMS",
    email: "E-mailová adresa",
    phone: "Overené telefónne číslo",
    phoneHint: "Použite medzinárodný formát, napríklad +421 901 234 567.",
    sendReset: "Poslať odkaz",
    sendCode: "Poslať kód",
    resetSent: "Skontrolujte si e-mail",
    resetSentBody: "Ak účet s týmto e-mailom existuje, poslali sme odkaz na obnovenie.",
    codeSent: "Zadajte kód",
    codeSentBody: "Ak toto overené číslo patrí k účtu, poslali sme naň šesťmiestny kód.",
    code: "Šesťmiestny kód",
    resetWithCode: "Uložiť nové heslo",
    newPasswordTitle: "Vytvorte nové heslo",
    newPasswordBody: "Zvoľte si silné heslo s najmenej 8 znakmi.",
    validatingReset: "Kontrolujeme odkaz",
    validatingResetBody: "Počkajte, kým pripravíme obnovenie vášho hesla.",
    invalidResetTitle: "Vyžiadajte si nový odkaz",
    invalidResetBody: "Tento odkaz už nie je možné použiť. Ak chcete pokračovať, vyžiadajte si nový.",
    requestNewLink: "Vyžiadať nový odkaz",
    password: "Nové heslo",
    confirmPassword: "Potvrďte nové heslo",
    savePassword: "Uložiť nové heslo",
    passwordChanged: "Heslo bolo aktualizované",
    passwordChangedBody: "Vaše heslo bolo úspešne zmenené. Teraz sa môžete prihlásiť.",
    mismatch: "Heslá sa nezhodujú.",
    resetFailed: "Tento odkaz na obnovenie je neplatný alebo vypršal.",
    codeFailed: "Kód je neplatný alebo vypršal.",
    passwordRejected: "Zvoľte si iné heslo a skúste to znova.",
    samePassword: "Nové heslo musí byť odlišné od vášho súčasného hesla.",
    passwordHint: "Použite aspoň 8 znakov. Heslo nesmie byť bežné, iba číselné ani podobné vašim osobným údajom.",
  },
  cs: {
    workspace: "Tvůrčí prostor",
    brandTitle: "Proměňte prostory v příběhy.",
    verifying: "Ověřujeme váš e-mail",
    verifyingBody: "Počkejte, než potvrdíme váš účet Reaigen.",
    verified: "E-mail byl ověřen",
    verifiedBody: "Váš účet Reaigen je aktivní a připravený k použití.",
    verifyFailed: "Tento ověřovací odkaz je neplatný nebo vypršel.",
    verifyMissing: "Ověřovací odkaz není úplný.",
    openWorkspace: "Otevřít pracovní prostor",
    signIn: "Zpět na přihlášení",
    forgotTitle: "Obnovte své heslo",
    forgotBody: "Vyberte způsob obnovení hesla.",
    emailMethod: "E-mail",
    smsMethod: "SMS",
    email: "E-mailová adresa",
    phone: "Ověřené telefonní číslo",
    phoneHint: "Použijte mezinárodní formát, například +421 901 234 567.",
    sendReset: "Poslat odkaz",
    sendCode: "Poslat kód",
    resetSent: "Zkontrolujte si e-mail",
    resetSentBody: "Pokud účet s tímto e-mailem existuje, poslali jsme odkaz pro obnovení.",
    codeSent: "Zadejte kód",
    codeSentBody: "Pokud toto ověřené číslo patří k účtu, poslali jsme na něj šestimístný kód.",
    code: "Šestimístný kód",
    resetWithCode: "Uložit nové heslo",
    newPasswordTitle: "Vytvořte nové heslo",
    newPasswordBody: "Zvolte si silné heslo s alespoň 8 znaky.",
    validatingReset: "Kontrolujeme odkaz",
    validatingResetBody: "Počkejte, než připravíme obnovení vašeho hesla.",
    invalidResetTitle: "Vyžádejte si nový odkaz",
    invalidResetBody: "Tento odkaz již nelze použít. Chcete-li pokračovat, vyžádejte si nový.",
    requestNewLink: "Vyžádat nový odkaz",
    password: "Nové heslo",
    confirmPassword: "Potvrďte nové heslo",
    savePassword: "Uložit nové heslo",
    passwordChanged: "Heslo bylo aktualizováno",
    passwordChangedBody: "Vaše heslo bylo úspěšně změněno. Nyní se můžete přihlásit.",
    mismatch: "Hesla se neshodují.",
    resetFailed: "Tento odkaz pro obnovení je neplatný nebo vypršel.",
    codeFailed: "Kód je neplatný nebo vypršel.",
    passwordRejected: "Zvolte jiné heslo a zkuste to znovu.",
    samePassword: "Nové heslo se musí lišit od vašeho současného hesla.",
    passwordHint: "Použijte alespoň 8 znaků. Heslo nesmí být běžné, pouze číselné ani podobné vašim osobním údajům.",
  },
  de: {
    workspace: "Kreativbereich",
    brandTitle: "Verwandeln Sie Räume in Geschichten.",
    verifying: "E-Mail wird bestätigt",
    verifyingBody: "Bitte warten Sie, während wir Ihr Reaigen-Konto bestätigen.",
    verified: "E-Mail bestätigt",
    verifiedBody: "Ihr Reaigen-Konto ist aktiv und einsatzbereit.",
    verifyFailed: "Dieser Bestätigungslink ist ungültig oder abgelaufen.",
    verifyMissing: "Der Bestätigungslink ist unvollständig.",
    openWorkspace: "Arbeitsbereich öffnen",
    signIn: "Zurück zur Anmeldung",
    forgotTitle: "Passwort zurücksetzen",
    forgotBody: "Wählen Sie, wie Sie Ihr Passwort zurücksetzen möchten.",
    emailMethod: "E-Mail",
    smsMethod: "SMS",
    email: "E-Mail-Adresse",
    phone: "Bestätigte Telefonnummer",
    phoneHint: "Verwenden Sie das internationale Format, zum Beispiel +421 901 234 567.",
    sendReset: "Link senden",
    sendCode: "Code senden",
    resetSent: "Posteingang prüfen",
    resetSentBody: "Wenn ein Konto für diese E-Mail existiert, wurde ein Link gesendet.",
    codeSent: "Code eingeben",
    codeSentBody: "Wenn diese bestätigte Nummer zu einem Konto gehört, wurde ein sechsstelliger Code gesendet.",
    code: "Sechsstelliger Code",
    resetWithCode: "Neues Passwort speichern",
    newPasswordTitle: "Neues Passwort erstellen",
    newPasswordBody: "Wählen Sie ein starkes Passwort mit mindestens 8 Zeichen.",
    validatingReset: "Link wird geprüft",
    validatingResetBody: "Bitte warten Sie, während wir das Zurücksetzen Ihres Passworts vorbereiten.",
    invalidResetTitle: "Neuen Link anfordern",
    invalidResetBody: "Dieser Link kann nicht mehr verwendet werden. Fordern Sie einen neuen Link an.",
    requestNewLink: "Neuen Link anfordern",
    password: "Neues Passwort",
    confirmPassword: "Neues Passwort bestätigen",
    savePassword: "Neues Passwort speichern",
    passwordChanged: "Passwort aktualisiert",
    passwordChangedBody: "Ihr Passwort wurde erfolgreich geändert. Sie können sich jetzt anmelden.",
    mismatch: "Die Passwörter stimmen nicht überein.",
    resetFailed: "Dieser Link ist ungültig oder abgelaufen.",
    codeFailed: "Der Code ist ungültig oder abgelaufen.",
    passwordRejected: "Wählen Sie ein anderes Passwort und versuchen Sie es erneut.",
    samePassword: "Das neue Passwort muss sich von Ihrem aktuellen Passwort unterscheiden.",
    passwordHint: "Verwenden Sie mindestens 8 Zeichen. Vermeiden Sie häufige, rein numerische oder kontobezogene Passwörter.",
  },
} as const;

type Language = keyof typeof COPY;

function normalizeLanguage(value?: string): Language | undefined {
  const language = value?.trim().toLowerCase().split("-")[0] as Language | undefined;
  return language && language in COPY ? language : undefined;
}

function useCopy(initialLanguage?: string) {
  const [language, setLanguage] = React.useState<Language>(
    normalizeLanguage(initialLanguage) ?? "en",
  );
  React.useEffect(() => {
    if (!normalizeLanguage(initialLanguage)) {
      setLanguage(getBrowserLanguage() as Language);
    }
  }, [initialLanguage]);
  return COPY[language] ?? COPY.en;
}

function FlowShell({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  const copy = useCopy();
  return (
    <main className="grid min-h-[100dvh] bg-white lg:grid-cols-[minmax(0,1.05fr)_minmax(28rem,0.95fr)]">
      <aside className="relative hidden overflow-hidden bg-[#11110f] lg:block">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_34%_28%,rgba(255,255,255,0.14),transparent_32%),linear-gradient(145deg,#242421_0%,#0f0f0e_58%,#000_100%)]" />
        <div className="absolute left-12 top-11 font-serif text-[25px] font-medium tracking-[0.005em] text-white">Reaigen</div>
        <div className="absolute inset-x-0 bottom-0 p-12">
          <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-white/50">{copy.workspace}</p>
          <h2 className="mt-4 max-w-[32rem] text-[clamp(2.6rem,4.2vw,5rem)] font-semibold leading-[0.94] tracking-[-0.06em] text-white">
            {copy.brandTitle}
          </h2>
        </div>
      </aside>
      <section className="flex min-h-[100dvh] items-center justify-center px-5 py-12 sm:px-10 lg:px-16">
        <div className="w-full max-w-[27rem]">
          <div className="mb-12 font-serif text-[26px] font-medium tracking-[0.005em] lg:hidden">Reaigen</div>
          <p className="mb-4 text-[10px] font-bold uppercase tracking-[0.16em] text-foreground/40">{copy.workspace}</p>
          <h1 className="text-[clamp(2.35rem,6vw,3.55rem)] font-semibold leading-[0.98] tracking-[-0.055em] text-foreground">{title}</h1>
          <p className="mt-3 text-[15px] leading-relaxed text-muted-foreground">{subtitle}</p>
          <div className="mt-8">{children}</div>
          <a href="mailto:support@reaigen.com" className="mt-9 inline-block text-[12px] font-medium text-muted-foreground underline underline-offset-4">
            support@reaigen.com
          </a>
        </div>
      </section>
    </main>
  );
}

function ErrorNotice({ children }: { children: React.ReactNode }) {
  return (
    <p role="alert" className="rounded-xl border border-destructive/20 bg-destructive/[0.045] px-4 py-3 text-[12px] font-medium leading-relaxed text-destructive">
      {children}
    </p>
  );
}

function apiErrorCode(error: unknown): string | undefined {
  if (!(error instanceof ApiError)) return undefined;
  try {
    return (JSON.parse(error.body) as { code?: string }).code;
  } catch {
    return undefined;
  }
}

export function VerifyEmailFlow({ token, language }: { token: string; language?: string }) {
  const copy = useCopy(language);
  const router = useRouter();
  const [state, setState] = React.useState<"loading" | "success" | "error">(
    token ? "loading" : "error",
  );

  React.useEffect(() => {
    if (!token) return;
    let active = true;
    void verifyEmail(token)
      .then(() => active && setState("success"))
      .catch(() => active && setState("error"));
    return () => {
      active = false;
    };
  }, [token]);

  const title = state === "success" ? copy.verified : copy.verifying;
  const subtitle = state === "success" ? copy.verifiedBody : copy.verifyingBody;
  return (
    <FlowShell title={title} subtitle={subtitle}>
      {state === "loading" && (
        <div className="h-2 overflow-hidden rounded-full bg-foreground/[0.08]">
          <div className="h-full w-1/2 animate-pulse rounded-full bg-foreground" />
        </div>
      )}
      {state === "error" && (
        <div className="space-y-5">
          <ErrorNotice>{token ? copy.verifyFailed : copy.verifyMissing}</ErrorNotice>
          <Link href="/" className="inline-flex h-[3.25rem] w-full items-center justify-center rounded-full border border-border bg-white px-5 text-[14px] font-semibold text-foreground">
            {copy.signIn}
          </Link>
        </div>
      )}
      {state === "success" && (
        <Button className="h-[3.25rem] w-full rounded-full text-[14px] font-semibold shadow-none" onClick={() => router.replace("/dashboard")}>
          {copy.openWorkspace}
        </Button>
      )}
    </FlowShell>
  );
}

export function ForgotPasswordFlow({ language }: { language?: string }) {
  const copy = useCopy(language);
  const [method, setMethod] = React.useState<"email" | "sms">("email");
  const [email, setEmail] = React.useState("");
  const [phone, setPhone] = React.useState("");
  const [code, setCode] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [confirm, setConfirm] = React.useState("");
  const [loading, setLoading] = React.useState(false);
  const [stage, setStage] = React.useState<"request" | "email-sent" | "code" | "complete">("request");
  const [failed, setFailed] = React.useState(false);
  const [samePassword, setSamePassword] = React.useState(false);
  const mismatch = confirm.length > 0 && password !== confirm;

  async function requestRecovery(event: React.FormEvent) {
    event.preventDefault();
    if (method === "email" && !/\S+@\S+\.\S+/.test(email.trim())) return;
    if (method === "sms" && !phone.trim().startsWith("+")) return;
    setLoading(true);
    setFailed(false);
    setSamePassword(false);
    try {
      if (method === "email") {
        await requestPasswordReset(email.trim());
        setStage("email-sent");
      } else {
        await requestPasswordResetSMS(phone.trim());
        setStage("code");
      }
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }

  async function confirmCode(event: React.FormEvent) {
    event.preventDefault();
    if (!/^\d{6}$/.test(code) || password.length < 8 || password !== confirm) return;
    setLoading(true);
    setFailed(false);
    setSamePassword(false);
    try {
      await confirmPasswordResetSMS(phone.trim(), code, password, confirm);
      setStage("complete");
    } catch (error) {
      if (apiErrorCode(error) === "password_unchanged") {
        setSamePassword(true);
      } else {
        setFailed(true);
      }
    } finally {
      setLoading(false);
    }
  }

  const title =
    stage === "email-sent"
      ? copy.resetSent
      : stage === "code"
        ? copy.codeSent
        : stage === "complete"
          ? copy.passwordChanged
          : copy.forgotTitle;
  const subtitle =
    stage === "email-sent"
      ? copy.resetSentBody
      : stage === "code"
        ? copy.codeSentBody
        : stage === "complete"
          ? copy.passwordChangedBody
          : copy.forgotBody;

  return (
    <FlowShell title={title} subtitle={subtitle}>
      {stage === "email-sent" || stage === "complete" ? (
        <Link href="/" className="inline-flex h-[3.25rem] w-full items-center justify-center rounded-full bg-foreground px-5 text-[14px] font-semibold text-background">
          {copy.signIn}
        </Link>
      ) : stage === "code" ? (
        <form onSubmit={confirmCode} className="space-y-4">
          <label className="block space-y-1.5 text-[13px] font-medium">
            <span>{copy.code}</span>
            <Input inputMode="numeric" value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))} autoComplete="one-time-code" className={INPUT_CLASS} />
          </label>
          <label className="block space-y-1.5 text-[13px] font-medium">
            <span>{copy.password}</span>
            <Input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="new-password" className={INPUT_CLASS} />
          </label>
          <label className="block space-y-1.5 text-[13px] font-medium">
            <span>{copy.confirmPassword}</span>
            <Input type="password" value={confirm} onChange={(event) => setConfirm(event.target.value)} autoComplete="new-password" className={INPUT_CLASS} />
          </label>
          {mismatch && <ErrorNotice>{copy.mismatch}</ErrorNotice>}
          {samePassword && <ErrorNotice>{copy.samePassword}</ErrorNotice>}
          {failed && <ErrorNotice>{copy.codeFailed}</ErrorNotice>}
          <Button type="submit" loading={loading} disabled={loading || !/^\d{6}$/.test(code) || password.length < 8 || password !== confirm} className="h-[3.25rem] w-full rounded-full text-[14px] font-semibold shadow-none">
            {copy.resetWithCode}
          </Button>
        </form>
      ) : (
        <form onSubmit={requestRecovery} className="space-y-5">
          <div className="grid grid-cols-2 rounded-full bg-foreground/[0.055] p-1" role="group" aria-label={copy.forgotTitle}>
            {(["email", "sms"] as const).map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => {
                  setMethod(option);
                  setFailed(false);
                }}
                className={`h-10 rounded-full text-[13px] font-semibold transition-colors ${method === option ? "bg-white text-foreground shadow-sm" : "text-muted-foreground"}`}
              >
                {option === "email" ? copy.emailMethod : copy.smsMethod}
              </button>
            ))}
          </div>
          {method === "email" ? (
            <label className="block space-y-1.5 text-[13px] font-medium">
              <span>{copy.email}</span>
              <Input type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" className={INPUT_CLASS} />
            </label>
          ) : (
            <label className="block space-y-1.5 text-[13px] font-medium">
              <span>{copy.phone}</span>
              <Input type="tel" value={phone} onChange={(event) => setPhone(event.target.value)} autoComplete="tel" placeholder="+421 901 234 567" className={INPUT_CLASS} />
              <span className="block text-[11px] font-normal leading-relaxed text-muted-foreground">{copy.phoneHint}</span>
            </label>
          )}
          {failed && <ErrorNotice>{copy.resetFailed}</ErrorNotice>}
          <Button type="submit" loading={loading} disabled={loading || (method === "email" ? !/\S+@\S+\.\S+/.test(email.trim()) : !phone.trim().startsWith("+"))} className="h-[3.25rem] w-full rounded-full text-[14px] font-semibold shadow-none">
            {method === "email" ? copy.sendReset : copy.sendCode}
          </Button>
        </form>
      )}
    </FlowShell>
  );
}

export function ResetPasswordFlow({ token, language }: { token: string; language?: string }) {
  const copy = useCopy(language);
  const submittingRef = React.useRef(false);
  const completedRef = React.useRef(false);
  const [password, setPassword] = React.useState("");
  const [confirm, setConfirm] = React.useState("");
  const [loading, setLoading] = React.useState(false);
  const [state, setState] = React.useState<"checking" | "ready" | "invalid" | "success">(
    token ? "checking" : "invalid",
  );
  const [passwordError, setPasswordError] = React.useState<"same" | "rejected" | null>(null);
  const mismatch = confirm.length > 0 && password !== confirm;

  React.useEffect(() => {
    if (completedRef.current) return;
    if (!token) {
      setState("invalid");
      return;
    }
    let active = true;
    setState("checking");
    void validatePasswordReset(token)
      .then(() => active && setState("ready"))
      .catch(() => active && setState("invalid"));
    return () => {
      active = false;
    };
  }, [token]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (
      submittingRef.current ||
      completedRef.current ||
      state !== "ready" ||
      !token ||
      password.length < 8 ||
      password !== confirm
    ) return;
    submittingRef.current = true;
    setLoading(true);
    setPasswordError(null);
    try {
      await confirmPasswordReset(token, password, confirm);
      completedRef.current = true;
      setState("success");
    } catch (error) {
      const errorCode = apiErrorCode(error);
      if (errorCode === "invalid_reset_token") {
        setState("invalid");
      } else if (errorCode === "password_unchanged") {
        setPasswordError("same");
      } else {
        setPasswordError("rejected");
      }
    } finally {
      if (!completedRef.current) submittingRef.current = false;
      setLoading(false);
    }
  }

  const title =
    state === "success"
      ? copy.passwordChanged
      : state === "invalid"
        ? copy.invalidResetTitle
        : state === "checking"
          ? copy.validatingReset
          : copy.newPasswordTitle;
  const subtitle =
    state === "success"
      ? copy.passwordChangedBody
      : state === "invalid"
        ? copy.invalidResetBody
        : state === "checking"
          ? copy.validatingResetBody
          : copy.newPasswordBody;

  return (
    <FlowShell title={title} subtitle={subtitle}>
      {state === "success" ? (
        <Link href="/" className="inline-flex h-[3.25rem] w-full items-center justify-center rounded-full bg-foreground px-5 text-[14px] font-semibold text-background">
          {copy.signIn}
        </Link>
      ) : state === "invalid" ? (
        <Link href="/forgot-password" className="inline-flex h-[3.25rem] w-full items-center justify-center rounded-full bg-foreground px-5 text-[14px] font-semibold text-background">
          {copy.requestNewLink}
        </Link>
      ) : state === "checking" ? (
        <div className="h-2 overflow-hidden rounded-full bg-foreground/[0.08]">
          <div className="h-full w-1/2 animate-pulse rounded-full bg-foreground" />
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-4">
          <label className="block space-y-1.5 text-[13px] font-medium">
            <span>{copy.password}</span>
            <Input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="new-password" className={INPUT_CLASS} />
            <span className="block text-[11px] font-normal leading-relaxed text-muted-foreground">{copy.passwordHint}</span>
          </label>
          <label className="block space-y-1.5 text-[13px] font-medium">
            <span>{copy.confirmPassword}</span>
            <Input type="password" value={confirm} onChange={(event) => setConfirm(event.target.value)} autoComplete="new-password" className={INPUT_CLASS} />
          </label>
          {mismatch && <ErrorNotice>{copy.mismatch}</ErrorNotice>}
          {passwordError === "same" && <ErrorNotice>{copy.samePassword}</ErrorNotice>}
          {passwordError === "rejected" && <ErrorNotice>{copy.passwordRejected}</ErrorNotice>}
          <Button type="submit" loading={loading} disabled={loading || password.length < 8 || password !== confirm} className="h-[3.25rem] w-full rounded-full text-[14px] font-semibold shadow-none">
            {copy.savePassword}
          </Button>
        </form>
      )}
    </FlowShell>
  );
}
