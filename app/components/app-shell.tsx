"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ExitIcon, GearIcon } from "@radix-ui/react-icons";
import { Avatar, AvatarFallback, AvatarImage } from "../lib/ui/avatar";
import { getReaiAgentConsent, type UserProfile } from "../lib/api/client";
import type { DraftDetailItem } from "../lib/tour-types";
import { cn } from "../lib/utils";
import { t, getUserLanguage } from "../lib/i18n";
import { AppContentMessages } from "./content-documents";
import { ReaiAgentCard } from "./reai-agent-card";

function getInitials(user: UserProfile): string {
  const f = user.first_name?.[0] ?? "";
  const l = user.last_name?.[0] ?? "";
  return (f + l).toUpperCase() || (user.email?.[0] ?? "?").toUpperCase();
}

// ── Icons ──
const HomeIcon = (props: { className?: string }) => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={props.className}>
    <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
    <polyline points="9 22 9 12 15 12 15 22" />
  </svg>
);

const ShareIcon = (props: { className?: string }) => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={props.className}>
    <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
    <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
  </svg>
);

const SIDEBAR_W = 220; // px

export function AppShell({
  user,
  onLogout,
  hideMobileNav = false,
  reaiDraftId,
  reaiDraftTitle,
  onReaiDraftUpdated,
  children,
}: {
  user: UserProfile;
  onLogout: () => void;
  /** Hide the mobile bottom tab bar — for detail screens that provide their own bottom action bar */
  hideMobileNav?: boolean;
  /** Current draft context. Reai stays read-only outside a draft page. */
  reaiDraftId?: number;
  /** Human-readable title for the current creation context. */
  reaiDraftTitle?: string;
  onReaiDraftUpdated?: (draft: DraftDetailItem) => void;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const [reaiEnabled, setReaiEnabled] = React.useState(false);
  const [reaiOpen, setReaiOpen] = React.useState(false);
  const lang = getUserLanguage(user.localization);
  const displayName = user.full_name || `${user.first_name ?? ""} ${user.last_name ?? ""}`.trim() || user.first_name || user.email;
  const avatarUrl = user.profile?.avatar_thumbnail_url ?? user.profile?.avatar_url;

  const NAV_ITEMS = [
    { href: "/dashboard", label: t("nav.dashboard", lang), icon: HomeIcon },
    { href: "/shares", label: t("nav.shares", lang), icon: ShareIcon },
  ];
  const workspaceTitle = pathname.startsWith("/shares")
    ? t("nav.shares", lang)
      : pathname.startsWith("/settings")
      ? t("nav.settings", lang)
      : pathname.startsWith("/draft/")
        ? t("nav.creation", lang)
        : t("nav.dashboard", lang);
  const reaiContext = pathname.startsWith("/settings") ? "settings" : (reaiDraftId ? "draft" : "creator");

  React.useEffect(() => {
    let active = true;
    const refresh = () => {
      void getReaiAgentConsent()
        .then((value) => {
          if (!active) return;
          setReaiEnabled(value.consented);
          if (!value.consented) setReaiOpen(false);
        })
        .catch(() => {
          if (active) setReaiEnabled(false);
        });
    };
    const permissionChanged = (event: Event) => {
      const enabled = (event as CustomEvent<{ enabled?: boolean }>).detail?.enabled;
      if (typeof enabled === "boolean") {
        setReaiEnabled(enabled);
        if (!enabled) setReaiOpen(false);
      } else {
        refresh();
      }
    };
    refresh();
    window.addEventListener("reai-consent-changed", permissionChanged);
    return () => {
      active = false;
      window.removeEventListener("reai-consent-changed", permissionChanged);
    };
  }, [pathname]);

  React.useEffect(() => {
    if (!reaiOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setReaiOpen(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [reaiOpen]);

  const reaiLauncher = reaiEnabled ? (
    <button
      type="button"
      onClick={() => setReaiOpen(true)}
      title={t("reai.openAgent", lang)}
      aria-label={t("reai.openAgent", lang)}
      aria-expanded={reaiOpen}
      className="group flex h-10 items-center gap-2 rounded-full border border-border/60 bg-background px-3.5 text-foreground/65 transition hover:border-foreground/25 hover:text-foreground"
    >
      <span className="px-0.5 text-[12px] font-semibold">Agent</span>
    </button>
  ) : null;

  return (
    <div
      className="min-h-screen bg-background transition-[padding] duration-200"
      style={{ paddingRight: reaiOpen ? "var(--reai-panel-width, 0px)" : 0 }}
    >
      {/* ── Desktop sidebar ──────────────────────────────────────── */}
      <aside
        className="fixed inset-y-0 left-0 z-40 hidden border-r border-border/10 bg-background md:flex md:flex-col pl-safe"
        style={{ width: SIDEBAR_W }}
      >
        {/* Brand */}
        <div className="pt-5 px-5 pb-6">
          <Link href="/dashboard" className="inline-block">
            <span
              className="text-[32px]"
              style={{ fontFamily: 'var(--font-brand), ui-serif, Georgia, serif', fontWeight: 400, letterSpacing: '0.01em' }}
            >
              Reaigen
            </span>
          </Link>
        </div>

        {/* Nav links */}
        <nav className="flex-1 space-y-1 px-3">
          {NAV_ITEMS.map((item) => {
            const active = pathname === item.href || pathname.startsWith(item.href + "/");
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "flex items-center gap-3.5 rounded-full px-3.5 py-2.5 text-[15px] transition-colors",
                  active
                    ? "font-bold text-foreground"
                    : "font-medium text-foreground/50 hover:bg-foreground/[0.04] hover:text-foreground"
                )}
              >
                <Icon className={cn("h-[22px] w-[22px]", active ? "text-foreground" : "text-foreground/40")} />
                {item.label}
              </Link>
            );
          })}
        </nav>

        {/* Bottom: settings + user */}
        <div className="px-3 pb-5 space-y-1">
          <Link
            href="/settings"
            className={cn(
              "flex items-center gap-3.5 rounded-full px-3.5 py-2.5 text-[15px] transition-colors",
              pathname === "/settings"
                ? "font-bold text-foreground"
                : "font-medium text-foreground/50 hover:bg-foreground/[0.04] hover:text-foreground"
            )}
          >
            <GearIcon className="h-[22px] w-[22px]" />
            {t("nav.settings", lang)}
          </Link>
          {/* User pill */}
          <div className="flex items-center gap-2 rounded-full px-2 py-2">
            <Link href="/settings" className="flex items-center gap-2.5 flex-1 min-w-0 hover:opacity-80 transition-opacity">
              <Avatar size="sm">
                {avatarUrl && <AvatarImage src={avatarUrl as string} />}
                <AvatarFallback>{getInitials(user)}</AvatarFallback>
              </Avatar>
              <div className="flex-1 min-w-0">
                <p className="text-[13px] font-semibold truncate leading-tight">{displayName}</p>
                <p className="text-[11px] text-foreground/35 truncate leading-tight">{user.email}</p>
              </div>
            </Link>
            <button
              type="button"
              onClick={onLogout}
              title={t("nav.signout", lang)}
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-foreground/20 hover:text-foreground/60 hover:bg-foreground/[0.05] transition-colors"
            >
              <ExitIcon className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      </aside>

      {/* ── Top header (mobile only) ─────────────────────────────── */}
      <header
        className="sticky top-0 z-50 border-b border-border/10 bg-background/95 pt-safe backdrop-blur-xl md:hidden supports-[backdrop-filter]:bg-background/75"
      >
        <div className="flex h-12 items-center justify-between px-4 sm:px-5 pl-safe pr-safe">
          <Link href="/dashboard" className="flex items-center">
            <span
              className="text-[20px]"
              style={{ fontFamily: 'var(--font-brand), ui-serif, Georgia, serif', fontWeight: 400, letterSpacing: '0.01em' }}
            >
              Reaigen
            </span>
          </Link>
          <div className="flex items-center gap-2">
            {reaiLauncher}
            <Link
              href="/settings"
              className="flex items-center rounded-full p-1 hover:bg-foreground/[0.04] transition-colors"
            >
              <Avatar size="sm">
                {avatarUrl && <AvatarImage src={avatarUrl as string} />}
                <AvatarFallback>{getInitials(user)}</AvatarFallback>
              </Avatar>
            </Link>
          </div>
        </div>
      </header>

      {/* ── Desktop workspace header ────────────────────────────── */}
      <header
        className="fixed top-0 z-40 hidden h-14 items-center justify-between border-b border-border/30 bg-background px-6 transition-[right] duration-200 md:flex"
        style={{ left: SIDEBAR_W, right: reaiOpen ? "var(--reai-panel-width)" : 0 }}
      >
        <p className="text-[14px] font-semibold text-foreground/70">{workspaceTitle}</p>
        {reaiLauncher}
      </header>

      {/* ── Content ──────────────────────────────────────────────── */}
      <main
        className={cn(
          "min-h-[calc(100dvh-3rem)] px-4 py-5 pb-24 md:min-h-dvh md:px-8 md:pb-8 pl-safe pr-safe",
          "md:pt-16",
        )}
        style={{ marginLeft: `var(--sidebar-offset, 0px)` }}
      >
        <AppContentMessages lang={lang} countryCode={user.profile?.country} regionCode={user.profile?.state} />
        <div key={pathname} className="animate-fade-in">
          {children}
        </div>
      </main>

      {/* ── Mobile bottom tab bar ────────────────────────────────── */}
      {!hideMobileNav && (
      <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-border/20 bg-background/92 pb-safe backdrop-blur-xl md:hidden">
        <div className="grid grid-cols-2 gap-1 px-3 pb-2 pt-2 pl-safe pr-safe">
          {NAV_ITEMS.map((item) => {
            const active = pathname === item.href;
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "flex flex-col items-center justify-center gap-1 rounded-xl px-2 py-2 text-[11px] font-medium transition-colors",
                  active
                    ? "text-foreground"
                    : "text-foreground/45"
                )}
              >
                <Icon className="h-[18px] w-[18px]" />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </div>
      </nav>
      )}

      {reaiEnabled && reaiOpen && (
          <aside
            role="complementary"
            aria-labelledby="reai-panel-title"
            className="fixed inset-y-0 right-0 z-[70] flex w-full flex-col border-l border-border/50 bg-background md:w-[var(--reai-panel-width)]"
          >
            <div className="flex h-14 shrink-0 items-center justify-between border-b border-border/40 px-4 pt-safe">
              <div className="flex items-center gap-2.5">
                <div>
                  <h2 id="reai-panel-title" className="text-[14px] font-semibold">Agent</h2>
                  <p className="max-w-[260px] truncate text-[11px] text-muted-foreground">
                    {reaiContext === "settings"
                      ? t("reai.settingsContext", lang)
                      : reaiDraftId
                        ? (reaiDraftTitle || t("reai.draftContext", lang))
                        : t("reai.noDraftContext", lang)}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setReaiOpen(false)}
                aria-label={t("reai.closeAgent", lang)}
                className="flex h-9 w-9 items-center justify-center rounded-full text-foreground/45 transition hover:bg-foreground/[0.05] hover:text-foreground"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"><path d="m6 6 12 12M18 6 6 18" /></svg>
              </button>
            </div>
            <div className="min-h-0 flex-1">
              <ReaiAgentCard draftId={reaiDraftId} workspaceContext={reaiContext} lang={lang} onDraftUpdated={onReaiDraftUpdated} panel />
            </div>
          </aside>
      )}

      {/* CSS variable for sidebar offset (desktop only) */}
      <style>{`
        :root { --reai-panel-width: 0px; }
        @media (min-width: 768px) {
          :root { --sidebar-offset: ${SIDEBAR_W}px; --reai-panel-width: clamp(360px, 30vw, 420px); }
        }
      `}</style>
    </div>
  );
}
