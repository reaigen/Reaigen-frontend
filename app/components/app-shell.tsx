"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ExitIcon, GearIcon } from "@radix-ui/react-icons";
import { Avatar, AvatarFallback, AvatarImage } from "../lib/ui/avatar";
import type { UserProfile } from "../lib/api/client";
import { cn } from "../lib/utils";
import { t, getUserLanguage } from "../lib/i18n";
import { AppContentMessages } from "./content-documents";

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

const SIDEBAR_W = 180; // px

export function AppShell({
  user,
  onLogout,
  children,
}: {
  user: UserProfile;
  onLogout: () => void;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const lang = getUserLanguage(user.localization);
  const displayName = user.full_name || `${user.first_name ?? ""} ${user.last_name ?? ""}`.trim() || user.first_name || user.email;
  const avatarUrl = user.profile?.avatar_thumbnail_url ?? user.profile?.avatar_url;

  const NAV_ITEMS = [
    { href: "/dashboard", label: t("nav.dashboard", lang), icon: HomeIcon },
    { href: "/shares", label: t("nav.shares", lang), icon: ShareIcon },
  ];

  return (
    <div className="min-h-screen bg-background">
      {/* ── Desktop sidebar ──────────────────────────────────────── */}
      <aside
        className="fixed inset-y-0 left-0 z-40 hidden border-r border-border/40 bg-background md:flex md:flex-col pl-safe"
        style={{ width: SIDEBAR_W }}
      >
        {/* Brand */}
        <div className="flex h-12 items-center px-5">
          <Link href="/dashboard">
            <span
              className="text-[21px]"
              style={{ fontFamily: 'var(--font-brand), ui-serif, Georgia, serif', fontWeight: 400, letterSpacing: '0.01em' }}
            >
              Reaigen
            </span>
          </Link>
        </div>

        {/* Nav links */}
        <nav className="flex-1 space-y-0.5 px-3 pt-3">
          {NAV_ITEMS.map((item) => {
            const active = pathname === item.href;
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] font-medium transition-colors",
                  active
                    ? "bg-foreground/[0.06] text-foreground"
                    : "text-foreground/45 hover:bg-foreground/[0.04] hover:text-foreground"
                )}
              >
                <Icon className={active ? "text-foreground" : "text-foreground/35"} />
                {item.label}
              </Link>
            );
          })}
        </nav>

        {/* Bottom: settings */}
        <div className="border-t border-border/40 px-3 py-2">
          <Link
            href="/settings"
            className={cn(
              "flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] font-medium transition-colors",
              pathname === "/settings"
                ? "bg-foreground/[0.06] text-foreground"
                : "text-foreground/45 hover:bg-foreground/[0.04] hover:text-foreground"
            )}
          >
            <GearIcon className="h-[18px] w-[18px]" />
            {t("nav.settings", lang)}
          </Link>
        </div>
      </aside>

      {/* ── Top header ───────────────────────────────────────────── */}
      <header
        className="sticky top-0 z-50 border-b border-border/40 bg-background/92 pt-safe backdrop-blur-xl supports-[backdrop-filter]:bg-background/70"
        style={{ marginLeft: `var(--sidebar-offset, 0px)` }}
      >
        <div className="flex h-12 items-center justify-between px-4 sm:px-5 pl-safe pr-safe">
          {/* Mobile/tablet: logo (sidebar hidden below md) */}
          <Link href="/dashboard" className="flex items-center md:hidden">
            <span
              className="text-[19px]"
              style={{ fontFamily: 'var(--font-brand), ui-serif, Georgia, serif', fontWeight: 400, letterSpacing: '0.01em' }}
            >
              Reaigen
            </span>
          </Link>
          {/* Desktop: spacer (logo in sidebar) */}
          <div className="hidden md:block" />

          {/* Right: user + sign out */}
          <div className="flex items-center gap-1.5">
            <Link
              href="/settings"
              className="flex items-center gap-2 rounded-full py-1 pl-1 pr-2.5 text-foreground/70 hover:bg-foreground/[0.04] transition-colors"
            >
              <Avatar size="sm">
                {avatarUrl && <AvatarImage src={avatarUrl as string} />}
                <AvatarFallback>{getInitials(user)}</AvatarFallback>
              </Avatar>
              <span className="hidden md:block text-[12px] font-medium text-foreground/55 max-w-[10rem] truncate">{displayName}</span>
            </Link>
            <button
              type="button"
              onClick={onLogout}
              title={t("nav.signout", lang)}
              className="hidden md:flex h-8 w-8 items-center justify-center rounded-full text-foreground/30 hover:text-foreground hover:bg-foreground/[0.04] transition-colors"
            >
              <ExitIcon className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      </header>

      {/* ── Content ──────────────────────────────────────────────── */}
      <main className="min-h-[calc(100dvh-3rem)] w-full px-4 py-5 pb-24 md:px-6 md:py-8 md:pb-8 pl-safe pr-safe" style={{ marginLeft: `var(--sidebar-offset, 0px)` }}>
        <div className="mx-auto max-w-4xl">
          <AppContentMessages lang={lang} countryCode={user.profile?.country} regionCode={user.profile?.state} />
          {children}
        </div>
      </main>

      {/* ── Mobile bottom tab bar ────────────────────────────────── */}
      <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-border/50 bg-background/92 pb-safe backdrop-blur-xl md:hidden">
        <div className="grid grid-cols-2 gap-1 px-3 pb-2 pt-2 pl-safe pr-safe">
          {NAV_ITEMS.map((item) => {
            const active = pathname === item.href;
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "flex flex-col items-center justify-center gap-1 rounded-2xl px-2 py-2.5 text-[11px] font-medium transition-all",
                  active
                    ? "bg-foreground text-background shadow-sm"
                    : "text-foreground/45 hover:bg-foreground/[0.04] hover:text-foreground"
                )}
              >
                <Icon className="h-4 w-4" />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </div>
      </nav>

      {/* CSS variable for sidebar offset (desktop only) */}
      <style>{`@media (min-width: 768px) { :root { --sidebar-offset: ${SIDEBAR_W}px; } }`}</style>
    </div>
  );
}
