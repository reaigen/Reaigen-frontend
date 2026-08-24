"use client";

import { usePathname } from "next/navigation";

import { PersistentAppShell } from "./app-shell";
import { useAuth } from "./hooks/use-auth";

function isWorkspacePath(pathname: string): boolean {
  return pathname === "/dashboard"
    || pathname === "/tours"
    || pathname === "/settings"
    || pathname === "/create"
    || pathname.startsWith("/draft/");
}

function hasDetailActionBar(pathname: string): boolean {
  return /^\/draft\/[^/]+\/?$/.test(pathname);
}

export function WorkspaceShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { user, isLoading, logout } = useAuth();

  if (!isWorkspacePath(pathname) || isLoading || !user) return <>{children}</>;

  return (
    <PersistentAppShell
      user={user}
      onLogout={logout}
      hideMobileNav={hasDetailActionBar(pathname)}
    >
      {children}
    </PersistentAppShell>
  );
}
