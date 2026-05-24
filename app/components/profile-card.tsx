"use client";

import * as React from "react";
import { Avatar, AvatarFallback, AvatarImage } from "../lib/ui/avatar";
import { Card, CardContent, CardHeader, CardTitle } from "../lib/ui/card";
import type { UserProfile } from "../lib/api/client";
import { t, getUserLanguage } from "../lib/i18n";

function getInitials(user: UserProfile): string {
  const f = user.first_name?.[0] ?? "";
  const l = user.last_name?.[0] ?? "";
  return (f + l).toUpperCase() || user.email[0].toUpperCase();
}

export function ProfileCard({ user }: { user: UserProfile }) {
  const avatarUrl = user.profile?.avatar_thumbnail_url ?? user.profile?.avatar_url;
  const lang = getUserLanguage(user.localization);

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("profile.title", lang)}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex items-center gap-4">
          <Avatar size="xl">
            {avatarUrl && <AvatarImage src={avatarUrl} />}
            <AvatarFallback className="text-xl">{getInitials(user)}</AvatarFallback>
          </Avatar>
          <div className="space-y-1">
            <h3 className="text-lg font-semibold">
              {user.full_name || `${user.first_name} ${user.last_name}`.trim()}
            </h3>
            <p className="text-sm text-muted-foreground">{user.email}</p>
            {user.username && user.username !== user.email && !user.username.includes("@") && (
              <p className="text-sm text-muted-foreground">@{user.username}</p>
            )}
            {user.profile?.company && (
              <p className="text-sm text-muted-foreground">{user.profile.company}</p>
            )}
            {user.billing_account && (
              <p className="text-xs text-muted-foreground mt-2">
                {t("profile.plan", lang)}: {user.billing_account.subscription_tier_detail?.name ?? "Free"}
                {user.billing_account.is_trial && ` (${t("profile.trial", lang)})`}
              </p>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
