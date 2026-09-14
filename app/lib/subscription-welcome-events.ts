export const SUBSCRIPTION_WELCOME_REFRESH_EVENT =
  "reaigen:subscription-welcome-refresh";

export function requestSubscriptionWelcomeRefresh() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(SUBSCRIPTION_WELCOME_REFRESH_EVENT));
}
