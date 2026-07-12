"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Cross2Icon, DashboardIcon, ExitIcon, GearIcon, HamburgerMenuIcon, Link2Icon } from "@radix-ui/react-icons";
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
  const displayName = user.full_name || `${user.first_name ?? ""} ${user.last_name ?? ""}`.trim() || user.first_name || user.email;
  const avatarUrl = user.profile?.avatar_thumbnail_url ?? user.profile?.avatar_url;

  const PRIMARY_NAV_ITEMS = [
    { href: "/dashboard", label: t("nav.dashboard", lang), icon: DashboardIcon },
    { href: "/shares", label: t("nav.shares", lang), icon: Link2Icon },
  ];

  React.useEffect(() => {
    setMobileMenuOpen(false);
  }, [pathname]);

  return (
    <div className="min-h-screen bg-background">
      {/* ── header ──────────────────────────────────────────────── */}
      <header className="sticky top-0 z-50 border-b border-border/50 bg-background/92 pt-safe backdrop-blur-xl supports-[backdrop-filter]:bg-background/70">
        <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-4 sm:h-16 sm:px-6 pl-safe pr-safe">
          <div className="flex min-w-0 items-center gap-3 sm:gap-8">
            <Link href="/dashboard" className="flex items-center">
              <span
                className="text-[19px] sm:text-[21px]"
                style={{ fontFamily: 'var(--font-brand), ui-serif, Georgia, serif', fontWeight: 400, letterSpacing: '0.01em' }}
              >
                Reaigen
              </span>
            </Link>
            <nav className="hidden sm:flex items-center gap-0.5">
              {PRIMARY_NAV_ITEMS.map((item) => (
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
            <div className="hidden items-center gap-1.5 sm:flex">
              <Link
                href="/settings"
                aria-label={t("nav.settings", lang)}
                title={t("nav.settings", lang)}
                className={cn(
                  "flex max-w-[15rem] items-center gap-2 rounded-full py-1 pl-1 pr-2.5 text-left transition-colors",
                  pathname === "/settings" ? "bg-foreground/[0.06] text-foreground" : "text-foreground/70 hover:bg-foreground/[0.04] hover:text-foreground"
                )}
              >
                <Avatar size="sm">
                  {avatarUrl && <AvatarImage src={avatarUrl as string} />}
                  <AvatarFallback>{getInitials(user)}</AvatarFallback>
                </Avatar>
                <span className="min-w-0">
                  <span className="block truncate text-[13px] font-medium">{displayName}</span>
                </span>
              </Link>
              <button
                type="button"
                onClick={onLogout}
                aria-label={t("nav.signout", lang)}
                title={t("nav.signout", lang)}
                className="inline-flex h-9 w-9 items-center justify-center rounded-full text-foreground/45 transition-colors hover:bg-foreground/[0.04] hover:text-foreground"
              >
                <ExitIcon className="h-4 w-4" />
              </button>
            </div>

            <button
              className="sm:hidden p-2 -mr-2 rounded-lg hover:bg-foreground/[0.04] transition-colors"
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              aria-label={t("nav.accountActions", lang)}
            >
              {mobileMenuOpen ? (
                <Cross2Icon className="h-5 w-5 text-foreground/60" />
              ) : (
                <HamburgerMenuIcon className="h-5 w-5 text-foreground/60" />
              )}
            </button>
          </div>
        </div>
      </header>

      {/* ── mobile menu (animated) ─────────────────────────────── */}
      <div
        className={cn(
          "sm:hidden overflow-hidden transition-all duration-200 ease-out border-b border-border/40 bg-background",
          mobileMenuOpen ? "max-h-96 opacity-100" : "max-h-0 opacity-0 border-b-0"
        )}
      >
        <div className="space-y-3 px-4 py-3 pl-safe pr-safe">
          <div className="flex items-center gap-3 border-b border-border/60 pb-3">
            <Avatar size="sm">
              {avatarUrl && <AvatarImage src={avatarUrl as string} />}
              <AvatarFallback>{getInitials(user)}</AvatarFallback>
            </Avatar>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[13px] font-medium text-foreground">{displayName}</p>
              <p className="truncate text-[11px] text-muted-foreground">{user.email}</p>
            </div>
          </div>
          <div className="grid gap-1">
            {PRIMARY_NAV_ITEMS.map((item) => {
              const active = pathname === item.href;
              const Icon = item.icon;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    "flex items-center gap-2 rounded-md px-3 py-2 text-[13px] font-medium transition-colors",
                    active ? "bg-foreground/[0.06] text-foreground" : "text-foreground/62 hover:bg-foreground/[0.04] hover:text-foreground"
                  )}
                >
                  <Icon className="h-4 w-4" />
                  {item.label}
                </Link>
              );
            })}
            <Link
              href="/settings"
              className={cn(
                "flex items-center gap-2 rounded-md px-3 py-2 text-[13px] font-medium transition-colors",
                pathname === "/settings" ? "bg-foreground/[0.06] text-foreground" : "text-foreground/62 hover:bg-foreground/[0.04] hover:text-foreground"
              )}
            >
              <GearIcon className="h-4 w-4" />
              {t("nav.settings", lang)}
            </Link>
            <button
              onClick={onLogout}
              className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-[13px] font-medium text-foreground/60 transition-colors hover:bg-foreground/[0.04] hover:text-foreground"
            >
              <ExitIcon className="h-4 w-4" />
              {t("nav.signout", lang)}
            </button>
          </div>
        </div>
      </div>

      {/* ── content ─────────────────────────────────────────────── */}
      <main className="mx-auto min-h-[calc(100dvh-3.5rem)] w-full max-w-4xl px-4 py-5 pb-24 sm:min-h-[calc(100dvh-4rem)] sm:px-6 sm:py-8 sm:pb-8 pl-safe pr-safe">
        <AppContentMessages lang={lang} countryCode={user.profile?.country} regionCode={user.profile?.state} />
        {children}
      </main>

      <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-border/50 bg-background/92 pb-safe backdrop-blur-xl sm:hidden">
        <div className="grid grid-cols-2 gap-1 px-3 pb-2 pt-2 pl-safe pr-safe">
          {PRIMARY_NAV_ITEMS.map((item) => {
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
    </div>
  );
}
