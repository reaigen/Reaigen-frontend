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
const SIDEBAR_EXPANDED_W = 260;

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
  const [mobileAccountOpen, setMobileAccountOpen] = React.useState(false);
  const [reaiViewport, setReaiViewport] = React.useState<{ height: number | null; offsetTop: number }>({ height: null, offsetTop: 0 });
  const [compactAgentViewport, setCompactAgentViewport] = React.useState(false);
  const [dockedAgentViewport, setDockedAgentViewport] = React.useState(false);
  const reaiPanelRef = React.useRef<HTMLElement>(null);
  const reaiCloseRef = React.useRef<HTMLButtonElement>(null);
  const reaiReturnFocusRef = React.useRef<HTMLElement | null>(null);
  const mobileAccountRef = React.useRef<HTMLDivElement>(null);
  const mobileAccountButtonRef = React.useRef<HTMLButtonElement>(null);
  const mobileAccountItemRefs = React.useRef<Array<HTMLAnchorElement | HTMLButtonElement | null>>([]);
  const lang = getUserLanguage(user.localization);
  const displayName = user.full_name || `${user.first_name ?? ""} ${user.last_name ?? ""}`.trim() || user.first_name || user.email;
  const avatarUrl = user.profile?.avatar_thumbnail_url ?? user.profile?.avatar_url;

  const NAV_ITEMS = [
    { href: "/dashboard", label: t("nav.dashboard", lang), icon: HomeIcon },
    { href: "/tours", label: t("nav.tours", lang), icon: TourIcon },
    { href: "/shares", label: t("nav.shares", lang), icon: LinkIcon },
  ];
  const reaiContext = pathname.startsWith("/settings") ? "settings" : (reaiDraftId ? "draft" : "creator");
  const reaiContextLabel = reaiContext === "settings"
    ? t("reai.settingsContext", lang)
    : reaiDraftId
      ? (reaiDraftTitle || t("reai.draftContext", lang))
      : t("reai.noDraftContext", lang);
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
    // Width determines composition. Pointer media queries are unreliable on
    // touchscreen laptops, remote browsers, and desktop device emulation.
    const compactQuery = window.matchMedia("(max-width: 767px)");
    const dockedQuery = window.matchMedia("(min-width: 1440px)");
    const syncAgentViewport = () => {
      setCompactAgentViewport(compactQuery.matches);
      setDockedAgentViewport(dockedQuery.matches);
    };
    syncAgentViewport();
    compactQuery.addEventListener("change", syncAgentViewport);
    dockedQuery.addEventListener("change", syncAgentViewport);
    return () => {
      compactQuery.removeEventListener("change", syncAgentViewport);
      dockedQuery.removeEventListener("change", syncAgentViewport);
    };
  }, []);

  React.useEffect(() => {
    if (!reaiOpen) return;
    const focusFrame = window.requestAnimationFrame(() => {
      if (!dockedAgentViewport) reaiCloseRef.current?.focus({ preventScroll: true });
    });
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setReaiOpen(false);
    };
    const keepFocusInDrawer = (event: KeyboardEvent) => {
      if (event.key !== "Tab" || !compactAgentViewport) return;
      const panel = reaiPanelRef.current;
      if (!panel) return;
      const focusable = Array.from(
        panel.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((element) => element.getAttribute("aria-hidden") !== "true");
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!first || !last) return;

      if (!panel.contains(document.activeElement)) {
        event.preventDefault();
        first.focus();
      } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", closeOnEscape);
    window.addEventListener("keydown", keepFocusInDrawer);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      window.removeEventListener("keydown", closeOnEscape);
      window.removeEventListener("keydown", keepFocusInDrawer);
    };
  }, [compactAgentViewport, dockedAgentViewport, reaiOpen]);

  React.useEffect(() => {
    if (reaiOpen) return;
    const returnTarget = reaiReturnFocusRef.current;
    if (!returnTarget?.isConnected) return;
    const focusFrame = window.requestAnimationFrame(() => {
      returnTarget.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(focusFrame);
  }, [reaiOpen]);

  React.useEffect(() => {
    if (!reaiOpen) return;
    const viewport = window.visualViewport;
    if (!viewport) return;
    const syncViewport = () => {
      setReaiViewport({
        height: Math.round(viewport.height),
        offsetTop: Math.round(viewport.offsetTop),
      });
    };
    syncViewport();
    viewport.addEventListener("resize", syncViewport);
    viewport.addEventListener("scroll", syncViewport);
    return () => {
      viewport.removeEventListener("resize", syncViewport);
      viewport.removeEventListener("scroll", syncViewport);
    };
  }, [reaiOpen]);

  React.useEffect(() => {
    if (!mobileAccountOpen) return;
    const focusFrame = window.requestAnimationFrame(() => {
      mobileAccountItemRefs.current[0]?.focus({ preventScroll: true });
    });
    const closeOutside = (event: PointerEvent) => {
      if (event.target instanceof Node && !mobileAccountRef.current?.contains(event.target)) {
        setMobileAccountOpen(false);
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setMobileAccountOpen(false);
      mobileAccountButtonRef.current?.focus({ preventScroll: true });
    };
    const navigateMenu = (event: KeyboardEvent) => {
      if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
      const items = mobileAccountItemRefs.current.filter(
        (item): item is HTMLAnchorElement | HTMLButtonElement => Boolean(item?.isConnected),
      );
      if (items.length === 0) return;
      event.preventDefault();
      const currentIndex = items.indexOf(document.activeElement as HTMLAnchorElement | HTMLButtonElement);
      const nextIndex = event.key === "Home"
        ? 0
        : event.key === "End"
          ? items.length - 1
          : event.key === "ArrowUp"
            ? (currentIndex <= 0 ? items.length - 1 : currentIndex - 1)
            : (currentIndex + 1) % items.length;
      items[nextIndex]?.focus({ preventScroll: true });
    };
    document.addEventListener("pointerdown", closeOutside);
    window.addEventListener("keydown", closeOnEscape);
    window.addEventListener("keydown", navigateMenu);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.removeEventListener("pointerdown", closeOutside);
      window.removeEventListener("keydown", closeOnEscape);
      window.removeEventListener("keydown", navigateMenu);
    };
  }, [mobileAccountOpen]);

  React.useEffect(() => {
    setMobileAccountOpen(false);
  }, [pathname]);

  React.useEffect(() => {
    if (!reaiOpen || !compactAgentViewport) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [compactAgentViewport, reaiOpen]);

  const reaiLauncher = reaiEnabled ? (
    <button
      type="button"
      onClick={(event) => {
        reaiReturnFocusRef.current = event.currentTarget;
        setMobileAccountOpen(false);
        setReaiOpen(true);
        if (!window.matchMedia("(min-width: 1440px)").matches) {
          window.setTimeout(() => reaiCloseRef.current?.focus({ preventScroll: true }), 0);
        }
      }}
      title={t("reai.openAgent", lang)}
      aria-label={t("reai.openAgent", lang)}
      aria-expanded={reaiOpen}
      className="group inline-flex h-11 items-center justify-center gap-2 rounded-2xl border border-border bg-card px-3.5 text-[12px] font-semibold text-foreground/80 transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 md:h-[58px] md:w-16 md:flex-col md:gap-1 md:border-transparent md:bg-transparent md:px-0 min-[1728px]:h-12 min-[1728px]:w-full min-[1728px]:flex-row min-[1728px]:justify-start min-[1728px]:gap-3 min-[1728px]:border-border min-[1728px]:bg-card min-[1728px]:px-3.5"
    >
      <SparklesIcon size={19} className="text-foreground/75 transition-colors group-hover:text-foreground" />
      <span className="md:text-[10px] md:leading-none min-[1728px]:text-[13px] min-[1728px]:leading-normal">{t("reai.title", lang)}</span>
    </button>
  ) : null;

  return (
    <div
      className="app-canvas min-h-screen transition-[padding] duration-200"
      style={{ paddingRight: reaiOpen && dockedAgentViewport ? "var(--reai-panel-width)" : 0 }}
    >
      {/* ── Desktop sidebar ──────────────────────────────────────── */}
      <aside
        className="fixed inset-y-0 left-0 z-40 hidden w-[88px] border-r border-border bg-card pl-safe text-foreground transition-[width] duration-200 md:flex md:flex-col min-[1728px]:w-[260px]"
      >
        {/* Brand */}
        <div className="px-3 pb-6 pt-4">
          <Link
            href="/dashboard"
            aria-label="Reaigen"
            className="mx-auto flex h-12 w-16 items-center justify-center rounded-xl transition-colors hover:bg-foreground/[0.04] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 min-[1728px]:w-full min-[1728px]:justify-start min-[1728px]:px-2"
          >
            <span
              aria-hidden="true"
              className="text-[20px] leading-none text-foreground min-[1728px]:hidden"
              style={{ fontFamily: 'var(--font-brand), ui-serif, Georgia, serif', fontWeight: 500, letterSpacing: '0.005em' }}
            >
              Re
            </span>
            <span
              aria-hidden="true"
              className="hidden text-[25px] leading-none text-foreground min-[1728px]:inline"
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
                  "mx-auto flex min-h-[58px] w-16 flex-col items-center justify-center gap-1 rounded-xl text-[10px] leading-none transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 min-[1728px]:h-12 min-[1728px]:min-h-0 min-[1728px]:w-full min-[1728px]:flex-row min-[1728px]:justify-start min-[1728px]:gap-3.5 min-[1728px]:px-3 min-[1728px]:text-[14px] min-[1728px]:leading-normal",
                  active
                    ? "bg-accent font-semibold text-foreground"
                    : "font-medium text-muted-foreground hover:bg-accent/80 hover:text-foreground"
                )}
              >
                <Icon size={22} strokeWidth={active ? 2.2 : 1.7} className={cn("shrink-0", active ? "text-foreground" : "text-foreground/55")} />
                <span className="max-w-full truncate min-[1728px]:block">{item.label}</span>
              </Link>
            );
          })}
        </nav>

        {/* ReaUI utility stack with an X-like account position at the bottom. */}
        <div className="space-y-1 px-3 pb-4">
          {reaiLauncher && <div className="flex justify-center min-[1728px]:block">{reaiLauncher}</div>}
          <Link
            href="/settings"
            title={t("nav.settings", lang)}
            aria-current={settingsActive ? "page" : undefined}
            className={cn(
              "mx-auto flex min-h-[58px] w-16 flex-col items-center justify-center gap-1 rounded-xl text-[10px] leading-none transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 min-[1728px]:h-12 min-[1728px]:min-h-0 min-[1728px]:w-full min-[1728px]:flex-row min-[1728px]:justify-start min-[1728px]:gap-3.5 min-[1728px]:px-3 min-[1728px]:text-[14px] min-[1728px]:leading-normal",
              settingsActive
                ? "bg-accent font-semibold text-foreground"
                : "font-medium text-muted-foreground hover:bg-accent/80 hover:text-foreground"
            )}
          >
            <SettingsIcon size={22} strokeWidth={settingsActive ? 2.2 : 1.7} className={cn("shrink-0", settingsActive ? "text-foreground" : "text-foreground/55")} />
            <span className="max-w-full truncate min-[1728px]:block">{t("nav.settings", lang)}</span>
          </Link>

          <Link
            href="/settings"
            title={displayName}
            aria-label={displayName}
            className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl transition-colors hover:bg-foreground/[0.04] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 min-[1728px]:w-full min-[1728px]:justify-start min-[1728px]:gap-3 min-[1728px]:px-2"
          >
            <Avatar size="sm" className="shrink-0">
              {avatarUrl && <AvatarImage src={avatarUrl as string} />}
              <AvatarFallback>{getInitials(user)}</AvatarFallback>
            </Avatar>
            <span className="hidden min-w-0 min-[1728px]:block">
              <span className="block truncate text-[13px] font-semibold leading-tight">{displayName}</span>
              <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">{user.email}</span>
            </span>
          </Link>

          <button
            type="button"
            onClick={onLogout}
            title={t("nav.signout", lang)}
            aria-label={t("nav.signout", lang)}
            className="mx-auto flex h-12 w-12 items-center justify-center rounded-full text-foreground/55 transition-colors hover:bg-accent/80 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 min-[1728px]:w-full min-[1728px]:justify-start min-[1728px]:gap-3.5 min-[1728px]:px-3 min-[1728px]:text-[13px] min-[1728px]:font-medium"
          >
            <ExitIcon className="h-[21px] w-[21px] shrink-0" />
            <span className="hidden min-[1728px]:block">{t("nav.signout", lang)}</span>
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
            <div ref={mobileAccountRef} className="relative">
              <button
                ref={mobileAccountButtonRef}
                type="button"
                aria-label={displayName}
                aria-haspopup="menu"
                aria-expanded={mobileAccountOpen}
                aria-controls="mobile-account-menu"
                onClick={() => setMobileAccountOpen((open) => !open)}
                className="flex h-11 w-11 items-center justify-center rounded-2xl p-1 transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              >
                <Avatar size="sm">
                  {avatarUrl && <AvatarImage src={avatarUrl as string} />}
                  <AvatarFallback>{getInitials(user)}</AvatarFallback>
                </Avatar>
              </button>
              {mobileAccountOpen && (
                <div
                  id="mobile-account-menu"
                  role="menu"
                  aria-label={displayName}
                  className="absolute right-0 top-[calc(100%+0.5rem)] w-72 max-w-[calc(100vw-2rem)] overflow-hidden rounded-2xl border border-border bg-card p-2 shadow-xl animate-fade-in"
                >
                  <div role="presentation" className="min-w-0 border-b border-border/60 px-3 py-2.5">
                    <p className="truncate text-sm font-semibold text-foreground">{displayName}</p>
                    <p className="mt-0.5 truncate text-xs text-muted-foreground">{user.email}</p>
                  </div>
                  <div className="pt-1.5">
                    <Link
                      ref={(node) => {
                        mobileAccountItemRefs.current[0] = node;
                      }}
                      href="/settings"
                      role="menuitem"
                      onClick={() => setMobileAccountOpen(false)}
                      className="flex min-h-11 items-center gap-3 rounded-2xl px-3 text-sm font-medium text-foreground/75 transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <SettingsIcon size={19} className="shrink-0 text-foreground/55" />
                      {t("nav.settings", lang)}
                    </Link>
                    <button
                      ref={(node) => {
                        mobileAccountItemRefs.current[1] = node;
                      }}
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        setMobileAccountOpen(false);
                        onLogout();
                      }}
                      className="flex min-h-11 w-full items-center gap-3 rounded-2xl px-3 text-left text-sm font-medium text-foreground/75 transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <ExitIcon className="h-[19px] w-[19px] shrink-0 text-foreground/55" />
                      {t("nav.signout", lang)}
                    </button>
                  </div>
                </div>
              )}
            </div>
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
                  "flex flex-col items-center justify-center gap-1 rounded-lg text-[10px] font-medium leading-none transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                  active
                    ? "font-semibold text-foreground"
                    : "text-foreground/55 hover:text-foreground"
                )}
              >
                <Icon size={23} strokeWidth={active ? 2.25 : 1.75} />
                <span className="max-w-full truncate px-1">{item.label}</span>
              </Link>
            );
          })}
        </div>
      </nav>
      )}

      {reaiEnabled && (
        <>
          {reaiOpen && compactAgentViewport && (
            <div
              onClick={() => setReaiOpen(false)}
              aria-hidden="true"
              className="fixed inset-0 z-[65] bg-black/25 backdrop-blur-[1px]"
            />
          )}
          <aside
            ref={reaiPanelRef}
            role={compactAgentViewport ? "dialog" : "complementary"}
            aria-modal={compactAgentViewport ? true : undefined}
            aria-labelledby="reai-panel-title"
            aria-hidden={!reaiOpen}
            onTransitionEnd={(event) => {
              if (event.target === event.currentTarget && reaiOpen && !dockedAgentViewport) {
                reaiCloseRef.current?.focus({ preventScroll: true });
              }
            }}
            style={{
              bottom: "auto",
              height: reaiViewport.height == null ? "100dvh" : `${reaiViewport.height}px`,
              maxWidth: compactAgentViewport ? "none" : undefined,
              top: `${reaiViewport.offsetTop}px`,
              width: compactAgentViewport
                ? "100%"
                : dockedAgentViewport
                  ? "var(--reai-panel-width)"
                  : undefined,
            }}
            className={cn(
              "agent-canvas fixed inset-y-0 right-0 z-[70] flex w-full flex-col border-l border-border transition-[transform,visibility] duration-200 sm:w-[400px] sm:max-w-[90vw]",
              dockedAgentViewport ? "shadow-none" : "shadow-[-18px_0_48px_-30px_rgba(0,0,0,0.28)]",
              reaiOpen ? "visible translate-x-0" : "pointer-events-none invisible translate-x-full",
            )}
          >
            <div className="flex h-14 shrink-0 items-center justify-between border-b border-border bg-card px-4 pt-safe">
              <div className="flex min-w-0 items-center gap-2.5">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center text-foreground">
                  <SparklesIcon size={19} />
                </span>
                <h2 id="reai-panel-title" className="flex min-w-0 items-baseline gap-2 leading-tight">
                  <span className="shrink-0 text-[15px] font-semibold">{t("reai.title", lang)}</span>
                  <span className="truncate text-[11px] font-normal text-muted-foreground">{reaiContextLabel}</span>
                </h2>
              </div>
              <button
                ref={reaiCloseRef}
                type="button"
                onClick={() => setReaiOpen(false)}
                aria-label={t("reai.closeAgent", lang)}
                className="flex h-11 w-11 items-center justify-center rounded-2xl text-foreground/45 transition-colors hover:bg-foreground/[0.05] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 sm:h-9 sm:w-9"
              >
                <CloseIcon size={18} />
              </button>
            </div>
            <div className="min-h-0 flex-1">
              <ReaiAgentCard draftId={reaiDraftId} currentUploadId={reaiUploadId} workspaceContext={reaiContext} lang={lang} onDraftUpdated={onReaiDraftUpdated} panel compact={compactAgentViewport} />
            </div>
          </aside>
        </>
      )}

      {/* CSS variables keep the ReaUI rail and X-style wide navigation aligned. */}
      <style>{`
        :root { --reai-panel-width: clamp(360px, 25vw, 400px); }
        @media (min-width: 768px) {
          :root { --sidebar-offset: ${SIDEBAR_COLLAPSED_W}px; }
        }
        /* The Agent width is consumed by the app canvas in desktop-width
           workspaces; phones and tablets keep the focused drawer composition. */
        @media (min-width: 1728px) {
          :root {
            --sidebar-offset: ${SIDEBAR_EXPANDED_W}px;
          }
        }
      `}</style>
    </div>
  );
}
