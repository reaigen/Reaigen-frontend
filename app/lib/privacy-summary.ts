import type { LocaleKey } from "./locales";

export interface PrivacyToggles {
  isPublic: boolean;
  emailAvailable: boolean;
  showEmail: boolean;
  phoneAvailable: boolean;
  showPhone: boolean;
  allowContact: boolean;
}

/**
 * The Privacy summary, read from the switches themselves.
 *
 * It used to pick one of three headlines; with a public profile, email
 * hidden and messages allowed it said "Public contact details" while its
 * own next sentence said direct contact details stay hidden (Bench 06
 * B06-F07). The headline now lists each switch's state — profile, email,
 * phone (when there is one), messages — and the hint explains the one
 * combination in effect.
 */
export function privacySummary(toggles: PrivacyToggles): { parts: LocaleKey[]; hint: LocaleKey } {
  if (!toggles.isPublic) {
    return { parts: ["settings.privacy.summary.profilePrivate"], hint: "settings.privacy.statusPrivateHint" };
  }
  const emailShown = toggles.emailAvailable && toggles.showEmail;
  const phoneShown = toggles.phoneAvailable && toggles.showPhone;
  const parts: LocaleKey[] = ["settings.privacy.summary.profilePublic"];
  if (toggles.emailAvailable) parts.push(emailShown ? "settings.privacy.summary.emailShown" : "settings.privacy.summary.emailHidden");
  if (toggles.phoneAvailable) parts.push(phoneShown ? "settings.privacy.summary.phoneShown" : "settings.privacy.summary.phoneHidden");
  parts.push(toggles.allowContact ? "settings.privacy.summary.messagesOn" : "settings.privacy.summary.messagesOff");
  const hint: LocaleKey = emailShown || phoneShown
    ? "settings.privacy.statusPublicContactHint"
    : toggles.allowContact
      ? "settings.privacy.statusMessagesOnlyHint"
      : "settings.privacy.statusNoContactHint";
  return { parts, hint };
}
