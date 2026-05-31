"use client";

import * as React from "react";
import { Avatar, AvatarFallback, AvatarImage } from "../lib/ui/avatar";
import type { UserProfile } from "../lib/api/client";
import { t, getUserLanguage } from "../lib/i18n";
import { listSplats } from "../lib/api/client";

function getInitials(user: UserProfile): string {
  const f = user.first_name?.[0] ?? "";
  const l = user.last_name?.[0] ?? "";
  return (f + l).toUpperCase() || (user.email?.[0] ?? "?").toUpperCase();
}

export function ProfileCard({ user }: { user: UserProfile }) {
  const avatarUrl = user.profile?.avatar_thumbnail_url ?? user.profile?.avatar_url;
  const lang = getUserLanguage(user.localization);
  const [stats, setStats] = React.useState<{ total: number; live: number; processing: number } | null>(null);

  React.useEffect(() => {
    listSplats(1, 1).then((data) => {
      setStats({ total: data.count ?? 0, live: 0, processing: 0 });
    }).catch(() => {});
  }, []);

  const b = user.billing_account;
  const tier = b?.subscription_tier_detail;

  return (
    <div className="flex flex-col items-start gap-4 rounded-[1.75rem] border border-border/70 bg-card px-4 py-4 shadow-[0_10px_30px_rgba(15,23,42,0.05)] sm:flex-row sm:items-center sm:px-5">
      <Avatar size="lg">
        {avatarUrl && <AvatarImage src={avatarUrl} />}
        <AvatarFallback className="text-lg">{getInitials(user)}</AvatarFallback>
      </Avatar>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <p className="text-[15px] font-semibold truncate">
            {user.full_name || `${user.first_name} ${user.last_name}`.trim() || user.email}
          </p>
          {user.username && user.username !== user.email && !user.username.includes("@") && (
            <span className="text-[12px] text-muted-foreground">@{user.username}</span>
          )}
        </div>
        <div className="flex items-center gap-3 mt-1 text-[12px] text-muted-foreground">
          {tier && <span>{tier.name}{b.is_trial ? ` (${t("profile.trial", lang)})` : ""}</span>}
        </div>
      </div>

      {/* Stats */}
      {stats && (
        <div className="flex shrink-0 items-center gap-5 self-stretch rounded-2xl bg-muted/55 px-3 py-2.5 sm:self-auto">
          <div className="text-left sm:text-center">
            <p className="text-[18px] font-semibold tabular-nums">{stats.total}</p>
            <p className="text-[10px] text-muted-foreground">{t("dashboard.statTotal", lang)}</p>
          </div>
        </div>
      )}
    </div>
  );
}
