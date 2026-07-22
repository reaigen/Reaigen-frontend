"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ExitIcon } from "@radix-ui/react-icons";
import { Avatar, AvatarFallback, AvatarImage } from "../lib/ui/avatar";
import { getReaiAgentConsent, type UserProfile } from "../lib/api/client";
import type { DraftDetailItem } from "../lib/tour-types";
import { cn } from "../lib/utils";
import { t, getUserLanguage } from "../lib/i18n";
import { AppContentMessages } from "./content-documents";
import { ReaiAgentCard } from "./reai-agent-card";
import { CloseIcon, HomeIcon, LinkIcon, SettingsIcon, TourIcon, SparklesIcon } from "./icons";

function getInitials(user: UserProfile): string {
  const f = user.first_name?.[0] ?? "";
  const l = user.last_name?.[0] ?? "";
  return (f + l).toUpperCase() || (user.email?.[0] ?? "?").toUpperCase();
}

const SIDEBAR_COLLAPSED_W = 88;
const SIDEBAR_EXPANDED_W = 294;

export function AppShell({
  user,
  onLogout,
  hideMobileNav = false,
  reaiDraftId,
  reaiDraftTitle,
  reaiUploadId,
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
  /** Exact current gallery photo; never inferred from URL or pixels. */
  reaiUploadId?: number;
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
    { href: "/tours", label: t("nav.tours", lang), icon: TourIcon },
    { href: "/shares", label: t("nav.shares", lang), icon: LinkIcon },
  ];
  const reaiContext = pathname.startsWith("/settings") ? "settings" : (reaiDraftId ? "draft" : "creator");
  const settingsActive = pathname === "/settings" || pathname.startsWith("/settings/");

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

  React.useEffect(() => {
    if (!reaiOpen) return;
    const wideWorkspace = window.matchMedia("(min-width: 1536px)");
    const previousOverflow = document.body.style.overflow;
    const syncBodyLock = () => {
      document.body.style.overflow = wideWorkspace.matches ? previousOverflow : "hidden";
    };
    syncBodyLock();
    wideWorkspace.addEventListener("change", syncBodyLock);
    return () => {
      wideWorkspace.removeEventListener("change", syncBodyLock);
      document.body.style.overflow = previousOverflow;
    };
  }, [reaiOpen]);

  const reaiLauncher = reaiEnabled ? (
    <button
      type="button"
      onClick={() => setReaiOpen(true)}
      title={t("reai.openAgent", lang)}
      aria-label={t("reai.openAgent", lang)}
      aria-expanded={reaiOpen}
      className="group inline-flex h-11 items-center justify-center gap-2 rounded-full border border-border bg-card px-3.5 text-[12px] font-semibold text-foreground/80 transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 md:h-[58px] md:w-16 md:flex-col md:gap-1 md:border-transparent md:bg-transparent md:px-0 xl:h-12 xl:w-full xl:flex-row xl:justify-start xl:gap-3 xl:border-border xl:bg-card xl:px-3.5"
    >
      <SparklesIcon size={19} className="text-foreground/75 transition-colors group-hover:text-foreground" />
      <span className="md:text-[10px] md:leading-none xl:text-[13px] xl:leading-normal">{t("reai.title", lang)}</span>
    </button>
  ) : null;

  return (
    <div
      className="app-canvas min-h-screen transition-[padding] duration-200"
      style={{ paddingRight: reaiOpen ? "var(--reai-panel-width, 0px)" : 0 }}
    >
      {/* ── Desktop sidebar ──────────────────────────────────────── */}
      <aside
        className="fixed inset-y-0 left-0 z-40 hidden w-[88px] border-r border-border bg-card pl-safe text-foreground transition-[width] duration-200 md:flex md:flex-col xl:w-[294px]"
      >
        {/* Brand */}
        <div className="px-3 pb-6 pt-4">
          <Link
            href="/dashboard"
            aria-label="Reaigen"
            className="mx-auto flex h-12 w-16 items-center justify-center rounded-xl transition-colors hover:bg-foreground/[0.04] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 xl:w-full xl:justify-start xl:px-2"
          >
            <span
              aria-hidden="true"
              className="text-[20px] leading-none text-foreground xl:hidden"
              style={{ fontFamily: 'var(--font-brand), ui-serif, Georgia, serif', fontWeight: 500, letterSpacing: '0.005em' }}
            >
              Re
            </span>
            <span
              aria-hidden="true"
              className="hidden text-[25px] leading-none text-foreground xl:inline"
              style={{ fontFamily: 'var(--font-brand), ui-serif, Georgia, serif', fontWeight: 500, letterSpacing: '0.005em' }}
            >
              Reaigen
            </span>
          </Link>
        </div>

        {/* Nav links */}
        <nav className="flex-1 space-y-1 px-3">
          {NAV_ITEMS.map((item) => {
            const active = pathname === item.href || pathname.startsWith(item.href + "/") || (item.href === "/dashboard" && pathname.startsWith("/draft/"));
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                title={item.label}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "mx-auto flex min-h-[58px] w-16 flex-col items-center justify-center gap-1 rounded-xl text-[10px] leading-none transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 xl:h-12 xl:min-h-0 xl:w-full xl:flex-row xl:justify-start xl:gap-3.5 xl:px-3 xl:text-[14px] xl:leading-normal",
                  active
                    ? "bg-accent font-semibold text-foreground"
                    : "font-medium text-muted-foreground hover:bg-accent/80 hover:text-foreground"
                )}
              >
                <Icon size={22} strokeWidth={active ? 2.2 : 1.7} className={cn("shrink-0", active ? "text-foreground" : "text-foreground/55")} />
                <span className="max-w-full truncate xl:block">{item.label}</span>
              </Link>
            );
          })}
        </nav>

        {/* ReaUI utility stack with an X-like account position at the bottom. */}
        <div className="space-y-1 px-3 pb-4">
          {reaiLauncher && <div className="flex justify-center xl:block">{reaiLauncher}</div>}
          <Link
            href="/settings"
            title={t("nav.settings", lang)}
            aria-current={settingsActive ? "page" : undefined}
            className={cn(
              "mx-auto flex min-h-[58px] w-16 flex-col items-center justify-center gap-1 rounded-xl text-[10px] leading-none transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 xl:h-12 xl:min-h-0 xl:w-full xl:flex-row xl:justify-start xl:gap-3.5 xl:px-3 xl:text-[14px] xl:leading-normal",
              settingsActive
                ? "bg-accent font-semibold text-foreground"
                : "font-medium text-muted-foreground hover:bg-accent/80 hover:text-foreground"
            )}
          >
            <SettingsIcon size={22} strokeWidth={settingsActive ? 2.2 : 1.7} className={cn("shrink-0", settingsActive ? "text-foreground" : "text-foreground/55")} />
            <span className="max-w-full truncate xl:block">{t("nav.settings", lang)}</span>
          </Link>

          <Link
            href="/settings"
            title={displayName}
            aria-label={displayName}
            className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl transition-colors hover:bg-foreground/[0.04] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 xl:w-full xl:justify-start xl:gap-3 xl:px-2"
          >
            <Avatar size="sm" className="shrink-0">
              {avatarUrl && <AvatarImage src={avatarUrl as string} />}
              <AvatarFallback>{getInitials(user)}</AvatarFallback>
            </Avatar>
            <span className="hidden min-w-0 xl:block">
              <span className="block truncate text-[13px] font-semibold leading-tight">{displayName}</span>
              <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">{user.email}</span>
            </span>
          </Link>

          <button
            type="button"
            onClick={onLogout}
            title={t("nav.signout", lang)}
            aria-label={t("nav.signout", lang)}
            className="mx-auto flex h-12 w-12 items-center justify-center rounded-full text-foreground/55 transition-colors hover:bg-accent/80 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 xl:w-full xl:justify-start xl:gap-3.5 xl:px-3 xl:text-[13px] xl:font-medium"
          >
            <ExitIcon className="h-[21px] w-[21px] shrink-0" />
            <span className="hidden xl:block">{t("nav.signout", lang)}</span>
          </button>
        </div>
      </aside>

      {/* ── Top header (mobile only) ─────────────────────────────── */}
      <header
        className="sticky top-0 z-50 border-b border-border bg-card/95 pt-safe text-foreground backdrop-blur-xl md:hidden"
      >
        <div className="flex h-14 items-center justify-between pl-[max(1rem,env(safe-area-inset-left))] pr-[max(1rem,env(safe-area-inset-right))]">
          <Link href="/dashboard" className="flex items-center">
            <span
              className="text-[22px] text-foreground"
              style={{ fontFamily: 'var(--font-brand), ui-serif, Georgia, serif', fontWeight: 500, letterSpacing: '0.01em' }}
            >
              Reaigen
            </span>
          </Link>
          <div className="flex items-center gap-2">
            {reaiLauncher}
            <Link
              href="/settings"
              aria-label={t("nav.settings", lang)}
              className="flex h-11 w-11 items-center justify-center rounded-full p-1 transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              <Avatar size="sm">
                {avatarUrl && <AvatarImage src={avatarUrl as string} />}
                <AvatarFallback>{getInitials(user)}</AvatarFallback>
              </Avatar>
            </Link>
          </div>
        </div>
      </header>

      {/* ── Content ──────────────────────────────────────────────── */}
      <main
        className={cn(
          "min-h-[calc(100dvh-3.5rem)] pb-24 pt-6 pl-[max(1rem,env(safe-area-inset-left))] pr-[max(1rem,env(safe-area-inset-right))]",
          "md:min-h-dvh md:px-8 md:py-7 xl:px-10 2xl:px-12",
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
      <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-card/95 pb-safe text-foreground backdrop-blur-xl md:hidden">
        <div className="grid h-16 grid-cols-3 px-4">
          {NAV_ITEMS.map((item) => {
            const active = pathname === item.href || pathname.startsWith(item.href + "/") || (item.href === "/dashboard" && pathname.startsWith("/draft/"));
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex items-center justify-center rounded-lg text-[11px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                  active
                    ? "font-semibold text-foreground"
                    : "text-foreground/55 hover:text-foreground"
                )}
              >
                <Icon size={23} strokeWidth={active ? 2.25 : 1.75} />
                <span className="sr-only">{item.label}</span>
              </Link>
            );
          })}
        </div>
      </nav>
      )}

      {reaiEnabled && reaiOpen && (
        <>
          <button
            type="button"
            tabIndex={-1}
            onClick={() => setReaiOpen(false)}
            aria-label={t("reai.closeAgent", lang)}
            className="fixed inset-0 z-[65] bg-black/25 backdrop-blur-[1px] 2xl:hidden"
          />
          <aside
            role="complementary"
            aria-labelledby="reai-panel-title"
            className="agent-canvas fixed inset-y-0 right-0 z-[70] flex w-full flex-col border-l border-border shadow-[-18px_0_48px_-30px_rgba(0,0,0,0.28)] animate-[panelIn_0.22s_ease-out] sm:w-[400px] sm:max-w-[90vw] 2xl:shadow-none"
          >
            <div className="flex h-14 shrink-0 items-center justify-between border-b border-border bg-card px-4 pt-safe">
              <div className="flex min-w-0 items-center gap-2.5">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center text-foreground">
                  <SparklesIcon size={19} />
                </span>
                <div className="min-w-0">
                  <h2 id="reai-panel-title" className="text-[15px] font-semibold leading-tight">{t("reai.title", lang)}</h2>
                  <p className="max-w-[240px] truncate text-[11px] text-muted-foreground">
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
                className="flex h-11 w-11 items-center justify-center rounded-full text-foreground/45 transition-colors hover:bg-foreground/[0.05] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 sm:h-9 sm:w-9"
              >
                <CloseIcon size={18} />
              </button>
            </div>
            <div className="min-h-0 flex-1">
              <ReaiAgentCard draftId={reaiDraftId} currentUploadId={reaiUploadId} workspaceContext={reaiContext} lang={lang} onDraftUpdated={onReaiDraftUpdated} panel />
            </div>
          </aside>
        </>
      )}

      {/* CSS variables keep the ReaUI rail and X-style wide navigation aligned. */}
      <style>{`
        :root { --reai-panel-width: 0px; }
        @media (min-width: 768px) {
          :root { --sidebar-offset: ${SIDEBAR_COLLAPSED_W}px; }
        }
        /* Agent panel only pushes content side-by-side on wide desktop;
           on tablet it overlays as a drawer so the property isn't squeezed. */
        @media (min-width: 1280px) {
          :root {
            --sidebar-offset: ${SIDEBAR_EXPANDED_W}px;
          }
        }
        @media (min-width: 1536px) {
          :root {
            --reai-panel-width: 400px;
          }
        }
      `}</style>
    </div>
  );
}
