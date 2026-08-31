"use client";

import * as React from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Avatar, AvatarFallback, AvatarImage } from "../lib/ui/avatar";
import { BottomSheet } from "../lib/ui/bottom-sheet";
import { getReaiAgentConsent, type UserProfile } from "../lib/api/client";
import { clearAgentSession, readAgentPanelOpen, writeAgentPanelOpen } from "../lib/agent-session";
import type { DraftDetailItem } from "../lib/tour-types";
import { cn } from "../lib/utils";
import { t, getUserLanguage } from "../lib/i18n";
import { AppContentMessages } from "./content-documents";
import { REAI_COMPOSE_EVENT } from "../lib/reai-compose";
import { ReaigenWordmark } from "./reaigen-wordmark";
import { SearchField } from "./search-field";
import { AgentIcon, ArrowLeftIcon, CloseIcon, DocumentIcon, MainHomeIcon, MainSettingsIcon, MainSignOutIcon, MainTourIcon, PlusIcon, TourIcon } from "./icons";

// The agent contains its own composer, media tooling, history, and orchestration
// client. Loading all of that on every collection page made a closed drawer one
// of the largest pieces of startup JavaScript. Keep the shell control instant,
// then fetch the agent implementation only after the drawer is first opened.
const ReaiAgentCard = dynamic(
  () => import("./reai-agent-card").then((module) => module.ReaiAgentCard),
  {
    ssr: false,
    loading: () => (
      <div
        className="async-stable-region h-full min-h-40 bg-card"
        role="status"
        aria-busy="true"
      />
    ),
  },
);

function NavRailItem({ href, label, icon: Icon, active }: {
  href: string;
  label: string;
  icon: React.ComponentType<{ size?: number; filled?: boolean; strokeWidth?: number; className?: string }>;
  active: boolean;
}) {
  return (
    <Link
      href={href}
      title={label}
      aria-current={active ? "page" : undefined}
      className={cn(
        "group/nav relative flex min-h-14 w-full shrink-0 items-center justify-center rounded-full p-1 text-[12px] leading-none",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
        active ? "font-semibold text-foreground" : "font-medium text-foreground/58 hover:text-foreground",
      )}
    >
      <span
        className={cn(
          "app-sidebar-nav-icon flex h-12 w-12 shrink-0 items-center justify-center rounded-full border border-transparent transition-colors duration-150",
          active
            ? "border-border/55 bg-card text-foreground shadow-control"
            : "text-foreground/52 group-hover/nav:bg-surface-subtle/70 group-hover/nav:text-foreground",
        )}
      >
        <Icon size={26} filled={active} strokeWidth={1.9} className="shrink-0" />
      </span>
      <span className="app-sidebar-label pointer-events-none absolute left-[calc(100%+0.55rem)] top-1/2 z-[75] -translate-y-1/2 whitespace-nowrap rounded-full border border-border/60 bg-card/95 px-3 py-2 text-[12px] font-semibold text-foreground opacity-0 shadow-control backdrop-blur-xl transition-opacity duration-100 group-hover/nav:opacity-100 group-focus-visible/nav:opacity-100">
        {label}
      </span>
    </Link>
  );
}

function getInitials(user: UserProfile): string {
  const f = user.first_name?.[0] ?? "";
  const l = user.last_name?.[0] ?? "";
  return (f + l).toUpperCase() || (user.email?.[0] ?? "?").toUpperCase();
}

const SIDEBAR_W = 88;
const REAI_PANEL_MIN_W = 420;
const REAI_PANEL_MAX_W = 960;
const REAI_PANEL_WIDTH_KEY = "reaigen:agentPanelWidth.v2";

/**
 * Narrowest the page may become while the agent is docked beside it.
 *
 * The resize handle already refuses to leave less than this, so it is the
 * shell's existing answer to "how much room does the page actually need" and
 * the dock threshold below is derived from it rather than being a second,
 * independent opinion.
 */
const AGENT_MIN_CONTENT_W = 480;

/**
 * Narrowest the docked panel itself is drawn, before the user resizes it.
 *
 * Deliberately not REAI_PANEL_MIN_W: that is how far the resize handle may be
 * dragged, whereas this is the width the panel opens at. The threshold below
 * has to be built from this one, or the panel opens wider than the space the
 * threshold reserved for it and eats the difference out of the page.
 */
const AGENT_PANEL_BASE_W = 480;

/**
 * Width at which the agent stops overlaying the page and becomes part of it.
 *
 * The panel used to dock only past 1440px, so on every laptop below that it
 * slid over the page instead — reading as something covering the work rather
 * than sitting beside it, and hiding the very content it is meant to talk
 * about. There is nothing special about 1440: the real question is whether the
 * sidebar, the panel at its opening width and a usable page fit at once, so
 * that is what this asks. Below it the viewport genuinely cannot hold all three
 * and the overlay is the right composition.
 */
const AGENT_DOCK_MIN_W =
  SIDEBAR_W + AGENT_PANEL_BASE_W + AGENT_MIN_CONTENT_W;

function clampAgentPanelWidth(width: number) {
  const viewportLimit = typeof window === "undefined"
    ? REAI_PANEL_MAX_W
    : Math.max(
      REAI_PANEL_MIN_W,
      Math.min(
        window.innerWidth * 0.58,
        window.innerWidth - SIDEBAR_W - AGENT_MIN_CONTENT_W,
      ),
    );
  return Math.round(Math.min(Math.max(width, REAI_PANEL_MIN_W), Math.min(REAI_PANEL_MAX_W, viewportLimit)));
}

export type AppShellProps = {
  user: UserProfile;
  onLogout: () => void;
  /** Remove global chrome for camera/viewer workspaces that supply their own controls. */
  immersive?: boolean;
  /** Hide the mobile bottom tab bar — for detail screens that provide their own bottom action bar */
  hideMobileNav?: boolean;
  /** Current draft context. Reai stays read-only outside a draft page. */
  reaiDraftId?: number;
  /** Human-readable title for the current creation context. */
  reaiDraftTitle?: string;
  /** Exact current gallery photo; never inferred from URL or pixels. */
  reaiUploadId?: number;
  /** Viewer surface currently controlled by Agent. */
  reaiWorkspaceContext?: "creator" | "draft" | "settings" | "floorplan" | "virtual_tour";
  /** Owner-scoped tour resource currently open in the viewer. */
  reaiTourId?: number;
  onReaiDraftUpdated?: (draft: DraftDetailItem) => void;
  /** Optional route-owned search rendered in the desktop top navigation. */
  headerSearch?: {
    value: string;
    onChange: (value: string) => void;
    onClear?: () => void;
    placeholder: string;
    clearLabel: string;
  };
  /** Stable route context rendered in the desktop top bar instead of an empty header. */
  headerBackHref?: string;
  headerBackLabel?: string;
  headerTitle?: string;
  /** Reserve the title line while route data is loading. */
  headerTitleLoading?: boolean;
  headerMeta?: string;
  children: React.ReactNode;
};

type AppShellOverrides = Pick<
  AppShellProps,
  "immersive" | "hideMobileNav" | "reaiDraftId" | "reaiDraftTitle" | "reaiUploadId" | "reaiWorkspaceContext" | "reaiTourId" | "onReaiDraftUpdated" | "headerSearch" | "headerBackHref" | "headerBackLabel" | "headerTitle" | "headerTitleLoading" | "headerMeta"
>;

type PersistentShellBridge = {
  register: (overrides: AppShellOverrides) => () => void;
};

const PersistentShellContext = React.createContext<PersistentShellBridge | null>(null);

function NestedAppShell({
  immersive,
  hideMobileNav,
  reaiDraftId,
  reaiDraftTitle,
  reaiUploadId,
  reaiWorkspaceContext,
  reaiTourId,
  onReaiDraftUpdated,
  headerSearch,
  headerBackHref,
  headerBackLabel,
  headerTitle,
  headerTitleLoading,
  headerMeta,
  children,
}: AppShellProps) {
  const bridge = React.useContext(PersistentShellContext);
  const draftUpdatedRef = React.useRef(onReaiDraftUpdated);
  React.useLayoutEffect(() => {
    draftUpdatedRef.current = onReaiDraftUpdated;
  }, [onReaiDraftUpdated]);
  const forwardDraftUpdate = React.useCallback((draft: DraftDetailItem) => {
    draftUpdatedRef.current?.(draft);
  }, []);
  const registeredDraftUpdate = onReaiDraftUpdated ? forwardDraftUpdate : undefined;

  React.useLayoutEffect(() => {
    if (!bridge) return;
    return bridge.register({
      immersive,
      hideMobileNav,
      reaiDraftId,
      reaiDraftTitle,
      reaiUploadId,
      reaiWorkspaceContext,
      reaiTourId,
      onReaiDraftUpdated: registeredDraftUpdate,
      headerSearch,
      headerBackHref,
      headerBackLabel,
      headerTitle,
      headerTitleLoading,
      headerMeta,
    });
  }, [
    bridge,
    forwardDraftUpdate,
    hideMobileNav,
    headerSearch,
    headerBackHref,
    headerBackLabel,
    headerTitle,
    headerTitleLoading,
    headerMeta,
    immersive,
    registeredDraftUpdate,
    reaiDraftId,
    reaiDraftTitle,
    reaiTourId,
    reaiUploadId,
    reaiWorkspaceContext,
  ]);

  return <>{children}</>;
}

export function AppShell(props: AppShellProps) {
  const bridge = React.useContext(PersistentShellContext);
  return bridge ? <NestedAppShell {...props} /> : <AppShellFrame {...props} />;
}

export function PersistentAppShell({
  user,
  onLogout,
  hideMobileNav = false,
  children,
}: Pick<AppShellProps, "user" | "onLogout" | "hideMobileNav" | "children">) {
  const [overrides, setOverrides] = React.useState<AppShellOverrides>({});
  const activeRegistration = React.useRef<symbol | null>(null);

  const bridge = React.useMemo<PersistentShellBridge>(() => ({
    register(next) {
      const registration = Symbol("app-shell-page");
      activeRegistration.current = registration;
      setOverrides(next);
      return () => {
        if (activeRegistration.current !== registration) return;
        activeRegistration.current = null;
        setOverrides({});
      };
    },
  }), []);

  return (
    <PersistentShellContext.Provider value={bridge}>
      <AppShellFrame
        user={user}
        onLogout={onLogout}
        immersive={overrides.immersive ?? false}
        hideMobileNav={overrides.hideMobileNav ?? hideMobileNav}
        reaiDraftId={overrides.reaiDraftId}
        reaiDraftTitle={overrides.reaiDraftTitle}
        reaiUploadId={overrides.reaiUploadId}
        reaiWorkspaceContext={overrides.reaiWorkspaceContext}
        reaiTourId={overrides.reaiTourId}
        onReaiDraftUpdated={overrides.onReaiDraftUpdated}
        headerSearch={overrides.headerSearch}
        headerBackHref={overrides.headerBackHref}
        headerBackLabel={overrides.headerBackLabel}
        headerTitle={overrides.headerTitle}
        headerTitleLoading={overrides.headerTitleLoading}
        headerMeta={overrides.headerMeta}
      >
        {children}
      </AppShellFrame>
    </PersistentShellContext.Provider>
  );
}

function AppShellFrame({
  user,
  onLogout,
  immersive = false,
  hideMobileNav = false,
  reaiDraftId,
  reaiDraftTitle,
  reaiUploadId,
  reaiWorkspaceContext,
  reaiTourId,
  onReaiDraftUpdated,
  headerSearch,
  headerBackHref,
  headerBackLabel,
  headerTitle,
  headerTitleLoading,
  headerMeta,
  children,
}: AppShellProps) {
  const pathname = usePathname();
  const [reaiEnabled, setReaiEnabled] = React.useState(false);
  const [reaiOpen, setReaiOpen] = React.useState(false);
  const [reaiCardMounted, setReaiCardMounted] = React.useState(false);
  const [createOpen, setCreateOpen] = React.useState(false);
  const [mobileAccountOpen, setMobileAccountOpen] = React.useState(false);
  const [reaiViewport, setReaiViewport] = React.useState<{ height: number | null; offsetTop: number }>({ height: null, offsetTop: 0 });
  const [compactAgentViewport, setCompactAgentViewport] = React.useState(false);
  const [dockedAgentViewport, setDockedAgentViewport] = React.useState(false);
  const [reaiPanelWidth, setReaiPanelWidth] = React.useState<number | null>(null);
  const [reaiResizing, setReaiResizing] = React.useState(false);
  const reaiPanelRef = React.useRef<HTMLDivElement>(null);
  const reaiCloseRef = React.useRef<HTMLButtonElement>(null);
  const reaiReturnFocusRef = React.useRef<HTMLElement | null>(null);
  const reaiPanelWidthRef = React.useRef<number | null>(null);
  const reaiResizeActiveRef = React.useRef(false);
  const lang = getUserLanguage(user.localization);
  const displayName = user.full_name || `${user.first_name ?? ""} ${user.last_name ?? ""}`.trim() || user.first_name || user.email;
  const avatarUrl = user.profile?.avatar_thumbnail_url ?? user.profile?.avatar_url;

  const NAV_ITEMS = [
    { href: "/dashboard", label: t("nav.dashboard", lang), icon: MainHomeIcon },
    { href: "/tours", label: t("nav.tours", lang), icon: MainTourIcon },
  ];
  const settingsActive = pathname === "/settings" || pathname.startsWith("/settings/");
  const reaiContext = reaiWorkspaceContext
    ?? (pathname.startsWith("/settings") ? "settings" : (reaiDraftId ? "draft" : "creator"));
  const reaiContextLabel = reaiContext === "settings"
    ? t("reai.settingsContext", lang)
    : reaiDraftId
      ? (reaiDraftTitle || t("reai.draftContext", lang))
      : t("reai.noDraftContext", lang);
  React.useLayoutEffect(() => {
    const stored = Number(window.localStorage.getItem(REAI_PANEL_WIDTH_KEY));
    if (!Number.isFinite(stored) || stored <= 0) return;
    const next = clampAgentPanelWidth(stored);
    reaiPanelWidthRef.current = next;
    setReaiPanelWidth(next);
  }, []);

  // The shell is mounted per page, so a navigation would otherwise slam the
  // panel shut mid-conversation. Restore before paint to avoid it flashing
  // open, and mirror every later change back.
  React.useLayoutEffect(() => {
    if (readAgentPanelOpen()) setReaiOpen(true);
  }, []);

  React.useEffect(() => {
    writeAgentPanelOpen(reaiOpen);
  }, [reaiOpen]);

  // Once opened, retain the mounted card while the drawer is hidden so its
  // conversation and draft state survive a close/reopen in the same route.
  React.useEffect(() => {
    if (reaiOpen) setReaiCardMounted(true);
  }, [reaiOpen]);

  React.useEffect(() => {
    const openComposer = () => {
      setMobileAccountOpen(false);
      setReaiOpen(true);
    };
    window.addEventListener(REAI_COMPOSE_EVENT, openComposer);
    return () => window.removeEventListener(REAI_COMPOSE_EVENT, openComposer);
  }, []);

  React.useEffect(() => {
    if (!reaiResizing) return;
    const previousCursor = document.body.style.cursor;
    const previousUserSelect = document.body.style.userSelect;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    return () => {
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousUserSelect;
    };
  }, [reaiResizing]);

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
        if (!enabled) {
          // Withdrawing consent must not leave a parked transcript behind for
          // the next navigation to restore.
          clearAgentSession();
          setReaiOpen(false);
        }
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
    const dockedQuery = window.matchMedia(`(min-width: ${AGENT_DOCK_MIN_W}px)`);
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
    setMobileAccountOpen(false);
    setCreateOpen(false);
  }, [pathname]);

  React.useEffect(() => {
    if (!createOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setCreateOpen(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [createOpen]);

  React.useEffect(() => {
    if (!reaiOpen || !compactAgentViewport) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [compactAgentViewport, reaiOpen]);

  const openReai = (event: React.MouseEvent<HTMLButtonElement>) => {
    reaiReturnFocusRef.current = event.currentTarget;
    setMobileAccountOpen(false);
    setCreateOpen(false);
    setReaiOpen(true);
    if (!window.matchMedia("(min-width: 1440px)").matches) {
      window.setTimeout(() => reaiCloseRef.current?.focus({ preventScroll: true }), 0);
    }
  };

  const reaiLauncher = (variant: "header" | "floating") => reaiEnabled ? (
    <button
      type="button"
      data-testid="agent-launcher"
      onClick={openReai}
      title={t("reai.openAgent", lang)}
      aria-label={t("reai.openAgent", lang)}
      aria-expanded={reaiOpen}
      className={cn(
        "group inline-flex shrink-0 items-center justify-center gap-2 rounded-full font-semibold transition-[transform,box-shadow,background-color,color] duration-200",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
        variant === "header"
          ? "floating-capsule h-11 w-11 gap-0 p-0 text-foreground/80 shadow-control hover:bg-card hover:text-foreground"
          : cn(
            "glossy-primary-capsule fixed bottom-6 right-6 z-40 hidden h-14 w-14 gap-0 overflow-visible border border-white/20 p-0 text-white md:inline-flex",
            "shadow-[inset_0_1px_0_rgba(255,255,255,0.18),0_0_0_1px_rgba(0,0,0,0.12),0_0_20px_5px_rgba(255,255,255,0.32),0_14px_34px_rgba(0,0,0,0.24)]",
            "hover:-translate-y-0.5 hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.22),0_0_0_1px_rgba(0,0,0,0.12),0_0_26px_7px_rgba(255,255,255,0.42),0_16px_38px_rgba(0,0,0,0.28)] active:translate-y-0",
            "min-[1728px]:bottom-8 min-[1728px]:right-8 min-[1728px]:h-16 min-[1728px]:w-16",
          ),
      )}
    >
      <AgentIcon
        size={21}
        strokeWidth={1.95}
        className={cn(
          "shrink-0 transition-colors",
          variant === "header"
            ? "text-foreground/75 group-hover:text-foreground"
            : "h-[23px] w-[23px] text-current drop-shadow-[0_0_7px_rgba(255,255,255,0.52)] min-[1728px]:h-7 min-[1728px]:w-7",
        )}
      />
    </button>
  ) : null;

  const setAgentPanelWidth = (width: number) => {
    const next = clampAgentPanelWidth(width);
    reaiPanelWidthRef.current = next;
    setReaiPanelWidth(next);
    return next;
  };

  const finishAgentResize = () => {
    if (!reaiResizeActiveRef.current) return;
    reaiResizeActiveRef.current = false;
    setReaiResizing(false);
    const width = reaiPanelWidthRef.current;
    if (width) window.localStorage.setItem(REAI_PANEL_WIDTH_KEY, String(width));
  };

  const resetAgentPanelWidth = () => {
    reaiResizeActiveRef.current = false;
    reaiPanelWidthRef.current = null;
    setReaiResizing(false);
    setReaiPanelWidth(null);
    window.localStorage.removeItem(REAI_PANEL_WIDTH_KEY);
  };

  return (
    <div
      className={cn(
        "app-canvas min-h-screen transition-[padding] duration-200",
        reaiResizing && "transition-none",
      )}
      style={{
        // Room for the fixed header (plus the notch inset it absorbs).
        paddingTop: immersive
          ? "0px"
          : "var(--header-total-h)",
        paddingRight: "var(--reai-docked-width, 0px)",
        /*
          How much room the docked agent is actually taking, or 0px when it is
          closed or overlaying. Padding alone only helps children in normal
          flow; a full-screen editor is positioned, so it needs the number
          itself to know where the page now ends.
        */
        "--reai-docked-width": !immersive && reaiOpen && dockedAgentViewport ? "var(--reai-panel-width)" : "0px",
        "--sidebar-offset": immersive ? "0px" : undefined,
        ...(reaiPanelWidth ? { "--reai-panel-width": `${reaiPanelWidth}px` } : {}),
      } as React.CSSProperties}
    >
      {!immersive ? (
        <aside className="app-sidebar fixed inset-y-0 left-0 z-[60] hidden flex-col overflow-visible bg-card text-foreground md:flex">
          <Link
            href="/dashboard"
            aria-label="Reaigen"
            className="app-sidebar-brand relative flex h-[var(--header-total-h)] shrink-0 items-center justify-center pt-safe focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
          >
            <span
              className="app-sidebar-brand-short text-[28px] font-normal leading-none tracking-[-0.025em]"
              style={{ fontFamily: "var(--font-brand), ui-serif, Georgia, serif" }}
            >
              Re
            </span>
          </Link>
          <div className="flex min-h-0 flex-1 flex-col px-2.5 pb-3 pt-4">
            <nav className="min-h-0 flex-1 space-y-3 overflow-visible" aria-label={t("nav.dashboard", lang)}>
              {NAV_ITEMS.map((item) => {
                const active = pathname === item.href || pathname.startsWith(item.href + "/") || (item.href === "/dashboard" && pathname.startsWith("/draft/"));
                return <NavRailItem key={item.href} href={item.href} label={item.label} icon={item.icon} active={active} />;
              })}
              <button
                type="button"
                aria-expanded={createOpen}
                aria-controls="app-create-panel"
                onClick={(event) => {
                  setCreateOpen((open) => !open);
                  setReaiOpen(false);
                  event.currentTarget.blur();
                }}
                className={cn(
                  "group/nav relative flex min-h-14 w-full items-center justify-center rounded-full p-1 text-[12px] font-medium leading-none",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                  createOpen ? "font-semibold text-foreground" : "text-foreground/58 hover:text-foreground",
                )}
              >
                <span className={cn(
                  "app-sidebar-nav-icon flex h-12 w-12 shrink-0 items-center justify-center rounded-full border transition-colors duration-150",
                  createOpen
                    ? "glossy-primary-capsule border-foreground/15 text-background"
                    : "border-transparent text-foreground/52 group-hover/nav:bg-surface-subtle/70 group-hover/nav:text-foreground",
                )}>
                  <PlusIcon size={26} />
                </span>
                <span className="app-sidebar-label pointer-events-none absolute left-[calc(100%+0.55rem)] top-1/2 z-[75] -translate-y-1/2 whitespace-nowrap rounded-full border border-border/60 bg-card/95 px-3 py-2 text-[12px] font-semibold text-foreground opacity-0 shadow-control backdrop-blur-xl transition-opacity duration-100 group-hover/nav:opacity-100 group-focus-visible/nav:opacity-100">
                  {t("webCreate.menuTitle", lang)}
                </span>
              </button>
            </nav>
            <div className="mt-3 shrink-0 pt-3">
              <NavRailItem href="/settings" label={t("nav.settings", lang)} icon={MainSettingsIcon} active={settingsActive} />
            </div>
          </div>
        </aside>
      ) : null}

      {!immersive && createOpen ? (
        <section
          id="app-create-panel"
          role="dialog"
          aria-modal="false"
          aria-labelledby="app-create-title"
          className="fixed bottom-0 left-[var(--sidebar-offset)] top-0 z-[55] hidden w-[min(28rem,calc(100vw-var(--sidebar-offset)-2rem))] flex-col border-r border-border/70 bg-card/[0.98] text-foreground shadow-[20px_0_55px_rgba(0,0,0,0.10)] backdrop-blur-2xl md:flex"
        >
          <header className="flex h-[var(--header-total-h)] shrink-0 items-center justify-between border-b border-border/70 px-6 pt-safe">
            <h2 id="app-create-title" className="text-[26px] font-bold tracking-[-0.03em]">{t("webCreate.menuTitle", lang)}</h2>
            <button
              type="button"
              onClick={() => setCreateOpen(false)}
              aria-label={t("common.close", lang)}
              className="floating-icon-button flex items-center justify-center text-foreground/55 transition-colors hover:bg-foreground/[0.055] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              <CloseIcon size={18} />
            </button>
          </header>
          <nav className="space-y-3 overflow-y-auto p-5" aria-label={t("webCreate.menuTitle", lang)}>
            {([
              ["/create?mode=draft", DocumentIcon, "webCreate.draftTitle", "webCreate.draftDescription"],
              ["/create?mode=tour", TourIcon, "webCreate.tourTitle", "webCreate.tourDescription"],
            ] as const).map(([href, Icon, titleKey, descriptionKey]) => (
              <Link
                key={href}
                href={href}
                onClick={() => setCreateOpen(false)}
                className="group flex items-center gap-4 rounded-[1.35rem] p-3 transition-colors hover:bg-foreground/[0.045] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span className="glossy-capsule flex h-16 w-16 shrink-0 items-center justify-center rounded-[1.2rem] text-foreground/72 transition-transform group-hover:scale-[1.03]">
                  <Icon size={25} />
                </span>
                <span className="min-w-0">
                  <span className="block text-[16px] font-semibold tracking-[-0.015em]">{t(titleKey, lang)}</span>
                  <span className="mt-1 block text-[12px] leading-relaxed text-muted-foreground">{t(descriptionKey, lang)}</span>
                </span>
              </Link>
            ))}
          </nav>
        </section>
      ) : null}

      {/* ── Top header (all widths — the YouTube frame) ──────────── */}
      {!immersive ? <header
        /*
         * Opaque, not glass. At 95% fill the blur was contributing almost
         * nothing visually, but a backdrop-filter on a sticky bar makes the
         * compositor re-blur that strip on every scrolled frame — the single
         * biggest source of scroll jank on a phone.
         */
        /*
         * Fixed, not sticky. Sticky ties the bar's fate to every ancestor's
         * overflow behavior — one `overflow-x: hidden` anywhere up the chain
         * and it silently scrolls away again. Fixed cannot move, in any
         * browser; the canvas below compensates with matching top padding.
         */
        className="fixed inset-x-0 top-0 z-50 bg-card text-foreground md:left-[var(--sidebar-offset)] md:right-[var(--reai-docked-width)]"
      >
        {/*
          Sized from --header-h, which the theme already defined but nothing
          used. At 56px the wordmark and the 44px agent capsule left barely
          6px of air between them and the rules above and below.
        */}
        <div className="flex h-[var(--header-total-h)] items-center gap-3 pl-[max(1rem,env(safe-area-inset-left))] pr-[max(1rem,env(safe-area-inset-right))] pt-safe md:gap-5 md:pl-5">
          <Link href="/dashboard" aria-label="Reaigen" className="flex min-h-11 min-w-0 items-center md:hidden">
            <ReaigenWordmark className="text-[29px] leading-none text-foreground min-[390px]:text-[31px]" />
          </Link>
          <div className="hidden min-w-0 flex-1 items-center md:flex">
            {headerSearch ? (
              <SearchField
                value={headerSearch.value}
                onChange={headerSearch.onChange}
                onClear={headerSearch.onClear}
                placeholder={headerSearch.placeholder}
                clearLabel={headerSearch.clearLabel}
                appearance="navbar"
                className="w-full"
              />
            ) : headerBackHref ? (
              <div className="flex min-w-0 items-center gap-3">
                <Link
                  href={headerBackHref}
                  aria-label={headerBackLabel || t("common.back", lang)}
                  title={headerBackLabel || t("common.back", lang)}
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-border/60 bg-card text-foreground/65 shadow-control transition-colors hover:bg-surface-subtle hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                >
                  <ArrowLeftIcon size={18} />
                </Link>
                <div className="min-w-0 leading-tight">
                  {headerBackLabel ? (
                    <p className="truncate text-[11px] font-semibold text-muted-foreground">{headerBackLabel}</p>
                  ) : null}
                  {headerTitleLoading ? (
                    <span
                      aria-label={t("common.loading", lang)}
                      className="mt-1 block h-4 w-48 max-w-[28vw] animate-pulse rounded-full bg-foreground/10"
                    />
                  ) : headerTitle ? (
                    <p className="truncate text-[14px] font-semibold tracking-[-0.015em] text-foreground">{headerTitle}</p>
                  ) : null}
                </div>
                {headerMeta ? (
                  <span className="ml-1 max-w-[22rem] truncate rounded-full bg-surface-subtle px-3 py-1.5 text-[11px] font-medium text-foreground/58">
                    {headerMeta}
                  </span>
                ) : null}
              </div>
            ) : <span aria-hidden="true" />}
          </div>
          <div className="ml-auto flex items-center gap-2">
            <span className="inline-flex md:hidden">{reaiLauncher("header")}</span>
            <button
              type="button"
              data-testid="mobile-account-open"
              aria-label={displayName}
              aria-haspopup="dialog"
              aria-expanded={mobileAccountOpen}
              onClick={() => setMobileAccountOpen((open) => !open)}
              className="floating-icon-button gap-2 p-1 transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 md:w-auto md:pl-3"
            >
              <span className="hidden max-w-40 truncate text-[12px] font-semibold text-foreground/70 md:block">{displayName}</span>
              <Avatar size="sm">
                {avatarUrl && <AvatarImage src={avatarUrl as string} />}
                <AvatarFallback>{getInitials(user)}</AvatarFallback>
              </Avatar>
            </button>
            <BottomSheet
              open={mobileAccountOpen}
              onOpenChange={setMobileAccountOpen}
              title={displayName}
              hideTitle
              data-testid="mobile-account-menu"
            >
              <div className="flex min-w-0 items-center gap-3.5 px-1 pb-3">
                <Avatar size="lg" className="shrink-0">
                  {avatarUrl && <AvatarImage src={avatarUrl as string} />}
                  <AvatarFallback>{getInitials(user)}</AvatarFallback>
                </Avatar>
                <div className="min-w-0">
                  <p className="truncate text-[15px] font-semibold text-foreground">{displayName}</p>
                  <p className="mt-0.5 truncate text-[13px] text-muted-foreground">{user.email}</p>
                </div>
              </div>
              <div className="border-t border-border/60 pt-2">
                <Link
                  href="/settings"
                  onClick={() => setMobileAccountOpen(false)}
                  className="flex min-h-12 items-center gap-3.5 rounded-2xl px-2 text-[15px] font-medium text-foreground/80 transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <MainSettingsIcon size={22} strokeWidth={1.9} className="shrink-0 text-foreground/55" />
                  {t("nav.settings", lang)}
                </Link>
                <button
                  type="button"
                  onClick={() => {
                    setMobileAccountOpen(false);
                    onLogout();
                  }}
                  className="flex min-h-12 w-full items-center gap-3.5 rounded-2xl px-2 text-left text-[15px] font-medium text-foreground/80 transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <MainSignOutIcon size={22} strokeWidth={1.9} className="shrink-0 text-foreground/55" />
                  {t("nav.signout", lang)}
                </button>
              </div>
            </BottomSheet>
          </div>
        </div>
      </header> : null}

      {/* ── Content ──────────────────────────────────────────────── */}
      <main
        className={cn(
          "[container-name:app-workspace] [container-type:inline-size]",
          immersive
            ? "min-h-dvh p-0"
            : "min-h-[calc(100dvh-var(--header-total-h))] pb-24 pt-6 pl-[max(1rem,env(safe-area-inset-left))] pr-[max(1rem,env(safe-area-inset-right))] md:px-8 md:pb-7 md:pt-5 xl:px-10 2xl:px-12",
          // The labeled rail stays stable across desktop widths. Only its
          // outer gutter grows slightly on a wide canvas.
        )}
        style={{ marginLeft: immersive ? 0 : "var(--sidebar-offset, 0px)" }}
      >
        {!immersive ? <AppContentMessages
          lang={lang}
          countryCode={user.profile?.country}
          regionCode={user.profile?.state}
          // Stacks above the floating agent launcher, which owns the corner.
          className="pointer-events-none fixed bottom-20 right-4 z-[70] mb-0 max-h-[min(28rem,65dvh)] w-[min(28rem,calc(100vw-2rem))] overflow-y-auto [&>section]:pointer-events-auto md:bottom-24 md:right-6"
        /> : null}
        <div key={pathname} className="async-stable-region animate-fade-in">
          {children}
        </div>
      </main>

      {/* ── Mobile bottom tab bar ────────────────────────────────── */}
      {!immersive && !hideMobileNav && (
      /* Opaque for the same reason as the header — on screen for every scrolled frame. */
      <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-card pb-safe text-foreground md:hidden">
        <div className="grid h-16 grid-cols-3 px-4">
          {[...NAV_ITEMS, { href: "/settings", label: t("nav.settings", lang), icon: MainSettingsIcon }].map((item) => {
            const active = pathname === item.href || pathname.startsWith(item.href + "/") || (item.href === "/dashboard" && pathname.startsWith("/draft/"));
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex flex-col items-center justify-center gap-1.5 rounded-lg text-[11px] font-medium leading-none transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                  active
                    ? "font-semibold text-foreground"
                    : "text-foreground/70 hover:text-foreground"
                )}
              >
                {/*
                  27px, not 23. This is the app's primary navigation on a phone
                  and the only always-visible way between sections, but the
                  glyphs were drawn smaller than the iOS tab bar they mirror —
                  small enough that the tour glyph's play triangle inside its
                  frame turned to mush. The row's height is set by the 44px
                  touch target, so this costs no space.
                */}
                <Icon size={27} filled={active} strokeWidth={1.9} />
                <span className="max-w-full truncate px-1">{item.label}</span>
              </Link>
            );
          })}
        </div>
      </nav>
      )}

      {!immersive && !reaiOpen && reaiLauncher("floating")}

      {!immersive && reaiEnabled && (
        <>
          {reaiOpen && compactAgentViewport && (
            <div
              onClick={() => setReaiOpen(false)}
              aria-hidden="true"
              className="fixed inset-0 z-[95] bg-black/25 backdrop-blur-[1px]"
            />
          )}
          <div
            ref={reaiPanelRef}
            data-testid="agent-panel"
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
              height: dockedAgentViewport
                ? "100dvh"
                : reaiViewport.height == null
                  ? "100dvh"
                  : `${reaiViewport.height}px`,
              maxWidth: compactAgentViewport ? "none" : undefined,
              top: dockedAgentViewport ? "0px" : `${reaiViewport.offsetTop}px`,
              width: compactAgentViewport
                ? "100%"
                : dockedAgentViewport
                  ? "var(--reai-panel-width)"
                  : "min(460px, calc(100vw - 4rem))",
            }}
            className={cn(
              "agent-canvas fixed inset-y-0 right-0 z-[100] flex w-full flex-col bg-background transition-[transform,visibility] duration-200",
              dockedAgentViewport
                ? "shadow-none"
                : "border-l border-border shadow-[-18px_0_48px_-30px_rgba(0,0,0,0.28)]",
              reaiOpen ? "visible translate-x-0" : "pointer-events-none invisible translate-x-full",
            )}
          >
            {dockedAgentViewport && reaiOpen ? (
              <button
                type="button"
                role="separator"
                aria-orientation="vertical"
                aria-label={t("reai.resizePanel", lang)}
                aria-valuemin={REAI_PANEL_MIN_W}
                aria-valuemax={REAI_PANEL_MAX_W}
                aria-valuenow={reaiPanelWidth ?? 560}
                title={t("reai.resizePanel", lang)}
                className="group absolute inset-y-0 left-0 z-20 w-11 -translate-x-1/2 cursor-col-resize touch-none focus-visible:outline-none"
                onPointerDown={(event) => {
                  if (event.button !== 0) return;
                  event.preventDefault();
                  reaiResizeActiveRef.current = true;
                  setReaiResizing(true);
                  event.currentTarget.setPointerCapture(event.pointerId);
                }}
                onPointerMove={(event) => {
                  if (!reaiResizeActiveRef.current) return;
                  setAgentPanelWidth(window.innerWidth - event.clientX);
                }}
                onPointerUp={(event) => {
                  if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                    event.currentTarget.releasePointerCapture(event.pointerId);
                  }
                  finishAgentResize();
                }}
                onPointerCancel={finishAgentResize}
                onLostPointerCapture={finishAgentResize}
                onDoubleClick={resetAgentPanelWidth}
                onKeyDown={(event) => {
                  const current = reaiPanelWidth
                    ?? Math.min(720, Math.max(480, window.innerWidth * 0.33));
                  if (event.key === "ArrowLeft") {
                    event.preventDefault();
                    window.localStorage.setItem(REAI_PANEL_WIDTH_KEY, String(setAgentPanelWidth(current + 16)));
                  } else if (event.key === "ArrowRight") {
                    event.preventDefault();
                    window.localStorage.setItem(REAI_PANEL_WIDTH_KEY, String(setAgentPanelWidth(current - 16)));
                  } else if (event.key === "Home") {
                    event.preventDefault();
                    window.localStorage.setItem(REAI_PANEL_WIDTH_KEY, String(setAgentPanelWidth(REAI_PANEL_MIN_W)));
                  } else if (event.key === "End") {
                    event.preventDefault();
                    window.localStorage.setItem(REAI_PANEL_WIDTH_KEY, String(setAgentPanelWidth(REAI_PANEL_MAX_W)));
                  }
                }}
              >
                <span
                  aria-hidden="true"
                  className={cn(
                    "pointer-events-none absolute left-1/2 top-1/2 h-16 w-[3px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-foreground/35 opacity-0 transition-[opacity,transform,background-color] duration-150 group-hover:opacity-45 group-focus-visible:opacity-60",
                    reaiResizing && "scale-y-110 bg-foreground/45 opacity-60",
                  )}
                />
              </button>
            ) : null}
            {/* Same height and surface as the app navbar, without a dividing rule. */}
            <div className="flex h-[var(--header-total-h)] shrink-0 items-center justify-between bg-card px-4 pt-safe">
              <div className="flex min-w-0 items-center gap-2.5">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center text-foreground">
                  <AgentIcon size={20} strokeWidth={1.8} />
                </span>
                <h2 id="reai-panel-title" className="flex min-w-0 items-baseline gap-2 leading-tight">
                  <span className="shrink-0 text-[15px] font-semibold">{t("reai.title", lang)}</span>
                  <span className="truncate text-[11px] font-normal text-muted-foreground">{reaiContextLabel}</span>
                </h2>
              </div>
              <div className="flex shrink-0 items-center gap-0.5">
                {/*
                  A conversation otherwise accumulated until sign-out, with no
                  way to drop context that had drifted. The card owns the
                  transcript, so this signals it the same way the rest of the
                  app talks to the agent surfaces.
                */}
                <button
                  type="button"
                  onClick={() => window.dispatchEvent(new Event("reai-new-conversation"))}
                  aria-label={t("reai.newConversation", lang)}
                  title={t("reai.newConversation", lang)}
                  className="floating-icon-button flex items-center justify-center text-foreground/45 transition-colors hover:bg-foreground/[0.05] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                >
                  <PlusIcon size={18} />
                </button>
                <button
                  ref={reaiCloseRef}
                  type="button"
                  onClick={() => setReaiOpen(false)}
                  aria-label={t("reai.closeAgent", lang)}
                  className="floating-icon-button flex items-center justify-center text-foreground/45 transition-colors hover:bg-foreground/[0.05] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                >
                  <CloseIcon size={18} />
                </button>
              </div>
            </div>
            {/*
              The navigation rail and docked Agent now follow the same edge
              rule: their vertical divider begins below the shared app header.
              Keeping the panel-level border only for the overlay composition
              prevents a stray vertical line from cutting through one header
              while the opposite side stays open for the full wordmark.
            */}
            <div className={cn("min-h-0 flex-1", dockedAgentViewport && "border-l border-border")}>
              {reaiCardMounted ? (
                <ReaiAgentCard draftId={reaiDraftId} currentUploadId={reaiUploadId} currentTourId={reaiTourId} workspaceContext={reaiContext} lang={lang} onDraftUpdated={onReaiDraftUpdated} panel compact={compactAgentViewport} />
              ) : null}
            </div>
          </div>
        </>
      )}

      <style>{`
        :root { --reai-panel-width: clamp(${AGENT_PANEL_BASE_W}px, 33vw, 720px); }
        @media (min-width: 768px) {
          :root { --sidebar-offset: ${SIDEBAR_W}px; }
        }
        /* The Agent width is consumed by the app canvas in desktop-width
           workspaces; phones and tablets keep the focused drawer composition. */
      `}</style>
    </div>
  );
}
