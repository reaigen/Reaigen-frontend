"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Avatar, AvatarFallback, AvatarImage } from "../lib/ui/avatar";
import { Separator } from "../lib/ui/separator";
import type { UserProfile } from "../lib/api/client";
import { cn } from "../lib/utils";
import { t, getUserLanguage } from "../lib/i18n";

function getInitials(user: UserProfile): string {
  const f = user.first_name?.[0] ?? "";
  const l = user.last_name?.[0] ?? "";
  return (f + l).toUpperCase() || (user.email?.[0] ?? "?").toUpperCase();
}

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
  const [mobileMenuOpen, setMobileMenuOpen] = React.useState(false);

  const NAV_ITEMS = [
    { href: "/dashboard", label: t("nav.dashboard", lang), icon: "grid" as const },
    { href: "/shares", label: t("nav.shares", lang), icon: "link" as const },
    { href: "/settings", label: t("nav.settings", lang), icon: "gear" as const },
  ];

  function NavIcon({ type, active }: { type: "grid" | "link" | "gear"; active: boolean }) {
    const color = active ? "currentColor" : "currentColor";
    if (type === "grid") {
      return (
        <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
          <rect x="2.25" y="2.25" width="5.5" height="5.5" rx="1.4" stroke={color} strokeWidth="1.4" />
          <rect x="10.25" y="2.25" width="5.5" height="5.5" rx="1.4" stroke={color} strokeWidth="1.4" />
          <rect x="2.25" y="10.25" width="5.5" height="5.5" rx="1.4" stroke={color} strokeWidth="1.4" />
          <rect x="10.25" y="10.25" width="5.5" height="5.5" rx="1.4" stroke={color} strokeWidth="1.4" />
        </svg>
      );
    }
    if (type === "link") {
      return (
        <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
          <path d="M7 11L11 7M5.4 12.6L4.1 13.9a2.6 2.6 0 103.68 3.68L9.1 16.3M12.6 5.4L13.9 4.1a2.6 2.6 0 10-3.68-3.68L8.9 1.7" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
    }
    return (
      <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
        <path d="M9 2.5l1 .6 1.2-.2.7 1 .9.8-.3 1.1.3 1.1-.9.8-.7 1-1.2-.2-1 .6-1-.6-1.2.2-.7-1-.9-.8.3-1.1-.3-1.1.9-.8.7-1 1.2.2 1-.6z" stroke={color} strokeWidth="1.4" />
        <circle cx="9" cy="9" r="2.2" stroke={color} strokeWidth="1.4" />
      </svg>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      {/* ── header ──────────────────────────────────────────────── */}
      <header className="sticky top-0 z-50 border-b border-border/50 bg-background/92 pt-safe backdrop-blur-xl supports-[backdrop-filter]:bg-background/70">
        <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-4 sm:h-16 sm:px-6 pl-safe pr-safe">
          <div className="flex min-w-0 items-center gap-3 sm:gap-8">
            <Link href="/dashboard" className="flex items-center">
              <span
                className="text-[19px] sm:text-[21px]"
                style={{ fontFamily: 'var(--font-brand), ui-serif, Georgia, serif', fontWeight: 500, letterSpacing: '0.02em' }}
              >
                Reaigen
              </span>
            </Link>
            <nav className="hidden sm:flex items-center gap-0.5">
              {NAV_ITEMS.slice(0, 2).map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    "px-3 py-1.5 rounded-lg text-[13px] font-medium transition-colors",
                    pathname === item.href
                      ? "bg-foreground/[0.06] text-foreground"
                      : "text-foreground/45 hover:text-foreground hover:bg-foreground/[0.04]"
                  )}
                >
                  {item.label}
                </Link>
              ))}
            </nav>
          </div>

          <div className="flex items-center gap-2 sm:gap-3">
            <div className="hidden sm:flex items-center gap-2.5">
              <Avatar size="sm">
                {(user.profile?.avatar_thumbnail_url || user.profile?.avatar_url) && (
                  <AvatarImage src={(user.profile?.avatar_thumbnail_url ?? user.profile?.avatar_url) as string} />
                )}
                <AvatarFallback>{getInitials(user)}</AvatarFallback>
              </Avatar>
              <span className="text-[13px] font-medium text-foreground/80">{user.first_name || user.email}</span>
            </div>
            <Separator orientation="vertical" className="h-4 hidden sm:block opacity-40" />
            <Link
              href="/settings"
              className={cn(
                "hidden sm:inline-flex text-[13px] transition-colors",
                pathname === "/settings" ? "text-foreground font-medium" : "text-foreground/40 hover:text-foreground"
              )}
            >
              {t("nav.settings", lang)}
            </Link>
            <button
              onClick={onLogout}
              className="hidden sm:inline-flex text-[13px] text-foreground/40 hover:text-foreground transition-colors"
            >
              {t("nav.signout", lang)}
            </button>

            <Link
              href="/settings"
              className="sm:hidden flex items-center gap-2 rounded-full bg-foreground/[0.04] px-2.5 py-1.5 text-[12px] text-foreground/70"
            >
              <Avatar size="sm">
                {(user.profile?.avatar_thumbnail_url || user.profile?.avatar_url) && (
                  <AvatarImage src={(user.profile?.avatar_thumbnail_url ?? user.profile?.avatar_url) as string} />
                )}
                <AvatarFallback>{getInitials(user)}</AvatarFallback>
              </Avatar>
              <span className="max-w-[7rem] truncate">{user.first_name || user.email}</span>
            </Link>

            <button
              className="sm:hidden p-2 -mr-2 rounded-lg hover:bg-foreground/[0.04] transition-colors"
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              aria-label="Account actions"
            >
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none" className="text-foreground/60">
                {mobileMenuOpen ? (
                  <path d="M5 5L15 15M15 5L5 15" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                ) : (
                  <path d="M3 5.5H17M3 10H17M3 14.5H17" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                )}
              </svg>
            </button>
          </div>
        </div>
      </header>

      {/* ── mobile menu (animated) ─────────────────────────────── */}
      <div
        className={cn(
          "sm:hidden overflow-hidden transition-all duration-200 ease-out border-b border-border/40 bg-background",
          mobileMenuOpen ? "max-h-56 opacity-100" : "max-h-0 opacity-0 border-b-0"
        )}
      >
        <div className="space-y-1 px-4 py-3 pl-safe pr-safe">
          <div className="rounded-2xl border border-border/60 bg-card/80 p-2 shadow-sm">
            <div className="flex items-center gap-3 rounded-xl px-3 py-2.5">
              <Avatar size="sm">
                {(user.profile?.avatar_thumbnail_url || user.profile?.avatar_url) && (
                  <AvatarImage src={(user.profile?.avatar_thumbnail_url ?? user.profile?.avatar_url) as string} />
                )}
                <AvatarFallback>{getInitials(user)}</AvatarFallback>
              </Avatar>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13px] font-medium text-foreground">{user.first_name || user.email}</p>
                <p className="truncate text-[11px] text-muted-foreground">{user.email}</p>
              </div>
            </div>
            <button
              onClick={onLogout}
              className="mt-1 flex w-full items-center justify-center rounded-xl px-3 py-2.5 text-[13px] font-medium text-foreground/60 transition-colors hover:bg-foreground/[0.04] hover:text-foreground"
            >
              {t("nav.signout", lang)}
            </button>
          </div>
        </div>
      </div>

      {/* ── content ─────────────────────────────────────────────── */}
      <main className="mx-auto max-w-4xl px-4 py-5 pb-24 sm:px-6 sm:py-8 sm:pb-8 pl-safe pr-safe">
        {children}
      </main>

      <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-border/50 bg-background/92 pb-safe backdrop-blur-xl sm:hidden">
        <div className="grid grid-cols-3 gap-1 px-3 pb-2 pt-2 pl-safe pr-safe">
          {NAV_ITEMS.map((item) => {
            const active = pathname === item.href;
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
                <NavIcon type={item.icon} active={active} />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
