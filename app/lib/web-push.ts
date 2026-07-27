"use client";

import {
  deleteNotificationDevice,
  getWebPushConfig,
  registerWebPushDevice,
} from "./api/client";

const SERVICE_WORKER_PATH = "/reaigen-push-sw.js";
const DEVICE_KEY_PREFIX = "reaigen:web-push:device";
const VAPID_KEY_PREFIX = "reaigen:web-push:vapid";

export type WebPushResult =
  | { status: "enabled" }
  | { status: "unsupported" }
  | { status: "not_configured" }
  | { status: "denied" }
  | { status: "failed" };

export type WebPushState =
  | "enabled"
  | "available"
  | "denied"
  | "unsupported";

function storageKey(prefix: string, userId: number): string {
  return `${prefix}:user:${userId}`;
}

function isSupported(): boolean {
  return typeof window !== "undefined"
    && window.isSecureContext
    && "serviceWorker" in navigator
    && "PushManager" in window
    && "Notification" in window;
}

function applicationServerKey(value: string): ArrayBuffer {
  const padding = "=".repeat((4 - (value.length % 4)) % 4);
  const base64 = (value + padding)
    .replace(/-/g, "+")
    .replace(/_/g, "/");
  const decoded = window.atob(base64);
  const bytes = new Uint8Array(decoded.length);
  for (let index = 0; index < decoded.length; index += 1) {
    bytes[index] = decoded.charCodeAt(index);
  }
  return bytes.buffer;
}

async function subscribeAndRegister(
  userId: number,
  { mayPrompt }: { mayPrompt: boolean },
): Promise<WebPushResult> {
  if (!isSupported()) return { status: "unsupported" };
  if (Notification.permission === "denied") return { status: "denied" };
  if (Notification.permission === "default") {
    if (!mayPrompt) return { status: "failed" };
    const permission = await Notification.requestPermission();
    if (permission !== "granted") {
      return { status: permission === "denied" ? "denied" : "failed" };
    }
  }

  try {
    const config = await getWebPushConfig();
    if (!config.enabled || !config.public_key) {
      return { status: "not_configured" };
    }

    const registration = await navigator.serviceWorker.register(
      SERVICE_WORKER_PATH,
      { scope: "/" },
    );
    await navigator.serviceWorker.ready;

    const storedVapid = window.localStorage.getItem(
      storageKey(VAPID_KEY_PREFIX, userId),
    );
    let subscription = await registration.pushManager.getSubscription();
    if (subscription && storedVapid && storedVapid !== config.public_key) {
      await subscription.unsubscribe();
      subscription = null;
    }
    if (!subscription) {
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: applicationServerKey(config.public_key),
      });
    }

    const serialized = subscription.toJSON();
    const endpoint = serialized.endpoint ?? subscription.endpoint;
    const p256dh = serialized.keys?.p256dh;
    const auth = serialized.keys?.auth;
    if (!endpoint || !p256dh || !auth) {
      await subscription.unsubscribe();
      return { status: "failed" };
    }

    const device = await registerWebPushDevice({
      endpoint,
      p256dh,
      auth,
    });
    window.localStorage.setItem(
      storageKey(DEVICE_KEY_PREFIX, userId),
      String(device.id),
    );
    window.localStorage.setItem(
      storageKey(VAPID_KEY_PREFIX, userId),
      config.public_key,
    );
    return { status: "enabled" };
  } catch {
    return { status: "failed" };
  }
}

/** Explicit user action. This is the only path allowed to show a prompt. */
export function enableWebPushForUser(userId: number): Promise<WebPushResult> {
  return subscribeAndRegister(userId, { mayPrompt: true });
}

export async function getWebPushStateForUser(
  userId: number,
): Promise<WebPushState> {
  if (!isSupported()) return "unsupported";
  if (Notification.permission === "denied") return "denied";
  if (Notification.permission !== "granted") return "available";
  try {
    const registration = await navigator.serviceWorker.getRegistration("/");
    const subscription = await registration?.pushManager.getSubscription();
    const deviceId = window.localStorage.getItem(
      storageKey(DEVICE_KEY_PREFIX, userId),
    );
    return subscription && deviceId ? "enabled" : "available";
  } catch {
    return "available";
  }
}

/** Login/startup repair. Existing grants are reused without prompting. */
export async function restoreWebPushForUser(
  userId: number,
): Promise<WebPushResult> {
  if (!isSupported() || Notification.permission !== "granted") {
    return { status: "failed" };
  }
  return subscribeAndRegister(userId, { mayPrompt: false });
}

export async function disableWebPushForUser(
  userId: number,
  options: { unregisterBackend?: boolean } = {},
): Promise<void> {
  if (typeof window === "undefined") return;
  const deviceKey = storageKey(DEVICE_KEY_PREFIX, userId);
  const rawDeviceId = window.localStorage.getItem(deviceKey);

  if (options.unregisterBackend !== false && rawDeviceId) {
    const deviceId = Number(rawDeviceId);
    if (Number.isSafeInteger(deviceId) && deviceId > 0) {
      try {
        await deleteNotificationDevice(deviceId);
      } catch {
        // Continue with local unsubscribe. The backend disables invalid
        // endpoints automatically, and a future registration transfers the
        // same endpoint to the authenticated owner.
      }
    }
  }

  if (isSupported()) {
    try {
      const registration = await navigator.serviceWorker.getRegistration(
        SERVICE_WORKER_PATH,
      );
      const subscription = await registration?.pushManager.getSubscription();
      await subscription?.unsubscribe();
    } catch {
      // Best effort during logout/session expiry.
    }
  }

  window.localStorage.removeItem(deviceKey);
  window.localStorage.removeItem(storageKey(VAPID_KEY_PREFIX, userId));
}
