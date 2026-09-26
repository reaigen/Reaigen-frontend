import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";

// The API client imports its siblings without file extensions (bundler
// resolution). Resolve those to the .ts sources so the real helper is
// exercised, not a copy of its logic.
registerHooks({
  resolve(specifier, context, nextResolve) {
    try {
      return nextResolve(specifier, context);
    } catch (error) {
      if (specifier.startsWith(".") && !/\.[cm]?[jt]sx?$/.test(specifier)) {
        try {
          return nextResolve(`${specifier}.ts`, context);
        } catch {
          return nextResolve(`${specifier}/index.ts`, context);
        }
      }
      throw error;
    }
  },
});

const { ApiError } = await import("./client.ts");
const { getSafeApiErrorMessage, isEmailVerificationError, classifyApiError } = await import("./error-message.ts");

const refusal = (status, body) => new ApiError(status, JSON.stringify(body));

test("the backend's English sign-in refusals are shown in the creator's language", () => {
  const unverified = refusal(400, { non_field_errors: ["Email verification required before you can sign in."] });
  assert.equal(getSafeApiErrorMessage(unverified, "sk"), "Táto adresa ešte nie je overená. Skontrolujte schránku alebo si nechajte overovací e-mail poslať znova.");
  assert.equal(getSafeApiErrorMessage(unverified, "de").startsWith("Diese Adresse ist noch nicht bestätigt"), true);
  assert.equal(getSafeApiErrorMessage(refusal(400, { non_field_errors: ["Invalid credentials."] }), "cs"), "E-mail a heslo se neshodují. Zkuste to prosím znovu.");
  assert.equal(getSafeApiErrorMessage(refusal(400, { detail: "Invalid credentials." }), "en"), "That email and password don't match. Please try again.");
});

test("verification is known from the refusal, not from the words on screen", () => {
  assert.equal(isEmailVerificationError(refusal(400, { non_field_errors: ["Email verification required before you can sign in."] })), true);
  assert.equal(isEmailVerificationError(refusal(403, { detail: "Email verification required before using Reaigen features.", code: "email_not_verified" })), true);
  assert.equal(isEmailVerificationError(refusal(400, { non_field_errors: ["Invalid credentials."] })), false);
  assert.equal(isEmailVerificationError(new Error("verify")), false);
});

test("a throttle, by status or by wording, asks the creator to wait", () => {
  const byStatus = refusal(429, { error: "Too many requests. Please wait before retrying.", reason: "throttled", retry_after_seconds: 3600 });
  assert.equal(classifyApiError(byStatus)?.kind, "throttled");
  assert.equal(getSafeApiErrorMessage(byStatus, "sk"), "Príliš veľa pokusov. Počkajte, prosím, chvíľu a skúste to znova.");
  assert.equal(classifyApiError(refusal(400, { detail: "Request was throttled. Expected available in 20s." }))?.kind, "throttled");
});

test("a disabled account and duplicate sign-ups map to their own messages", () => {
  assert.equal(classifyApiError(refusal(403, { detail: "User account is disabled." }))?.kind, "disabled");
  assert.equal(classifyApiError(refusal(400, { email: ["A user with this email already exists."] }))?.kind, "conflict");
  assert.equal(getSafeApiErrorMessage(refusal(400, { code: ["Code must contain 6 digits."] }), "sk"), "Zadajte 6-miestny kód.");
});

test("an unknown but readable message still passes through, technical ones do not", () => {
  assert.equal(getSafeApiErrorMessage(refusal(400, { detail: "Choose a valid IANA time zone." }), "sk"), "Choose a valid IANA time zone.");
  assert.notEqual(getSafeApiErrorMessage(refusal(400, { detail: "Traceback (most recent call last)" }), "sk"), "Traceback (most recent call last)");
  assert.equal(getSafeApiErrorMessage(refusal(503, { detail: "nginx/1.25 bad gateway" }), "en").length > 0, true);
});

test("a dropped connection reads as one localized sentence, never the browser's text", () => {
  assert.equal(
    getSafeApiErrorMessage(new TypeError("Failed to fetch"), "sk"),
    "Spojenie sa prerušilo. Skontrolujte pripojenie na internet a skúste to znova.",
  );
  assert.equal(
    getSafeApiErrorMessage(new TypeError("Load failed"), "en"),
    "The connection was interrupted. Check your internet connection and try again.",
  );
});
