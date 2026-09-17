import assert from "node:assert/strict";
import test from "node:test";

import { isPlanConfirmation, isPlanStop } from "./agent-plan-confirmation.ts";

test("a plain yes approves a plan in English and in the account language", () => {
  assert.equal(isPlanConfirmation("yes", "en"), true);
  assert.equal(isPlanConfirmation("Yes, go ahead!", "en"), true);
  assert.equal(isPlanConfirmation("OK.", "de"), true);
  assert.equal(isPlanConfirmation("áno, spusti", "sk"), true);
  assert.equal(isPlanConfirmation("Pokračuj", "sk"), true);
  assert.equal(isPlanConfirmation("spusť to", "cs"), true);
  assert.equal(isPlanConfirmation("Ano, udělej to", "cs"), true);
  assert.equal(isPlanConfirmation("ja, los", "de"), true);
  assert.equal(isPlanConfirmation("Passt.", "de"), true);
});

test("hedged, refused or deferred replies never approve a plan", () => {
  assert.equal(isPlanConfirmation("don't do it yet", "en"), false);
  assert.equal(isPlanConfirmation("Don’t do it", "en"), false);
  assert.equal(isPlanConfirmation("yes but change the price", "en"), false);
  assert.equal(isPlanConfirmation("ja chcem najprv zmeniť cenu", "sk"), false);
  assert.equal(isPlanConfirmation("áno ale nie teraz", "sk"), false);
  assert.equal(isPlanConfirmation("ano ale ne teď", "cs"), false);
  assert.equal(isPlanConfirmation("ja, aber später", "de"), false);
  assert.equal(isPlanConfirmation("no", "en"), false);
  assert.equal(isPlanConfirmation("nie", "sk"), false);
  assert.equal(isPlanConfirmation("stop", "en"), false);
  assert.equal(isPlanConfirmation("", "en"), false);
});

test("a yes from another language does not count, so Slovak 'ja' (I) is not German 'ja'", () => {
  assert.equal(isPlanConfirmation("ja", "sk"), false);
  assert.equal(isPlanConfirmation("ja", "de"), true);
  assert.equal(isPlanConfirmation("spusti", "de"), false);
});

test("only a short, whole-message approval counts", () => {
  assert.equal(isPlanConfirmation("yes please do it now", "en"), false);
  assert.equal(isPlanConfirmation("yes make it shorter", "en"), false);
  assert.equal(isPlanConfirmation("confirmed the price", "en"), false);
});

test("stop is recognised only as the whole message", () => {
  assert.equal(isPlanStop("Stop"), true);
  assert.equal(isPlanStop("zruš!"), true);
  assert.equal(isPlanStop("zastaviť"), true);
  assert.equal(isPlanStop("Zastavit"), true);
  assert.equal(isPlanStop("abbrechen."), true);
  assert.equal(isPlanStop("cancel"), true);
  assert.equal(isPlanStop("stop the video"), false);
  assert.equal(isPlanStop("don't stop"), false);
});
