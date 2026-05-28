"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Avatar, AvatarFallback, AvatarImage } from "../lib/ui/avatar";
import { Button } from "../lib/ui/button";
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

  const NAV_ITEMS = [
    { href: "/dashboard", label: t("nav.dashboard", lang) },
    { href: "/settings", label: t("nav.settings", lang) },
  ];

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-50 h-16 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="flex h-full items-center justify-between px-6 max-w-7xl mx-auto">
          <div className="flex items-center gap-8">
            <Link href="/dashboard" className="flex items-center">
              <span className="text-[21px]" style={{ fontFamily: 'var(--font-brand), ui-serif, Georgia, serif', fontWeight: 500, letterSpacing: '0.02em' }}>Reaigen</span>
            </Link>
            <nav className="flex items-center gap-1">
              {NAV_ITEMS.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    "px-3 py-1.5 rounded-lg text-sm font-medium transition-colors",
                    pathname === item.href
                      ? "bg-accent text-foreground"
                      : "text-muted-foreground hover:text-foreground hover:bg-accent/50"
                  )}
                >
                  {item.label}
                </Link>
              ))}
            </nav>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              <Avatar size="sm">
                {(user.profile?.avatar_thumbnail_url || user.profile?.avatar_url) && (
                  <AvatarImage src={(user.profile?.avatar_thumbnail_url ?? user.profile?.avatar_url) as string} />
                )}
                <AvatarFallback>{getInitials(user)}</AvatarFallback>
              </Avatar>
              <span className="text-sm font-medium">{user.first_name || user.email}</span>
            </div>
            <Separator orientation="vertical" className="h-5" />
            <Button variant="ghost" size="sm" onClick={onLogout}>
              {t("nav.signout", lang)}
            </Button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-8">
        {children}
      </main>
    </div>
  );
}
