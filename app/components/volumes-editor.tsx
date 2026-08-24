"use client";

import * as React from "react";

import {
  archiveDraftVolume,
  listDraftVolumes,
  moveRoomToVolume,
  renameFloorplanRoom,
  splitRoomIntoNewVolume,
  updateDraftVolume,
  type DraftVolume,
  type VolumeRoom,
} from "../lib/api/client";
import { t } from "../lib/i18n";
import { Button } from "../lib/ui/button";
import { useConfirm } from "../lib/ui/confirm-dialog";
import { Input } from "../lib/ui/input";
import { cn } from "../lib/utils";

/**
 * Volume and room editor.
 *
 * A volume is one capture unit — one splat, one 3D scene — and open-plan
 * spaces are captured as a single volume holding several rooms. The operations
 * here mirror the iOS VolumesStepView exactly: rename, move a room to another
 * volume, split a room into its own volume, archive.
 *
 * Structural edits (move, split, archive) are desktop-only. They rewrite a
 * volume's whole room membership, which is easy to trigger by accident on a
 * touch target and awkward to undo on a phone; renaming carries no such risk
 * and stays available everywhere.
 *
 * Everything routes through the regular authenticated draft endpoints, never
 * the staff-gated /web-creation/ ones, so any owner can edit after creation.
 */

type Busy = { kind: "volume" | "room"; id: number } | null;

export function VolumesEditor({
  draftId,
  floorplanId,
  lang,
  className,
}: {
  draftId: number | string;
  floorplanId?: number | null;
  lang: string;
  className?: string;
}) {
  const { confirm, dialog: confirmDialog } = useConfirm();
  const [volumes, setVolumes] = React.useState<DraftVolume[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState<Busy>(null);
  const [editing, setEditing] = React.useState<string | null>(null);
  const [draftName, setDraftName] = React.useState("");

  const reload = React.useCallback(async () => {
    try {
      setVolumes(await listDraftVolumes(draftId));
      setError(null);
    } catch {
      setError(t("volumes.loadFailed", lang));
    } finally {
      setLoading(false);
    }
  }, [draftId, lang]);

  React.useEffect(() => {
    void reload();
  }, [reload]);

  /**
   * Reload after every mutation rather than patching local state. Moving a
   * room writes both the source and destination volume, so the server is the
   * only place the resulting membership is authoritative.
   */
  const run = React.useCallback(
    async (marker: Busy, action: () => Promise<unknown>) => {
      setBusy(marker);
      setError(null);
      try {
        await action();
        await reload();
      } catch {
        setError(t("volumes.saveFailed", lang));
        await reload();
      } finally {
        setBusy(null);
      }
    },
    [reload, lang],
  );

  const commitVolumeName = (volume: DraftVolume) => {
    const label = draftName.trim();
    setEditing(null);
    if (!label || label === volume.label) return;
    void run({ kind: "volume", id: volume.id }, () =>
      updateDraftVolume(draftId, volume.id, { label }),
    );
  };

  const commitRoomName = (room: VolumeRoom) => {
    const label = draftName.trim();
    setEditing(null);
    if (!floorplanId || !label || label === room.room_label) return;
    void run({ kind: "room", id: room.id }, () =>
      renameFloorplanRoom(floorplanId, room.room, label),
    );
  };

  if (loading) {
    return (
      <div className={cn("text-sm text-foreground/60", className)} aria-busy="true">
        {t("volumes.title", lang)}…
      </div>
    );
  }

  return (
    <section className={cn("flex flex-col gap-4", className)}>
      <header className="flex flex-col gap-1">
        <h2 className="text-base font-medium">{t("volumes.title", lang)}</h2>
        <p className="text-[13px] leading-relaxed text-foreground/60">
          {t("volumes.subtitle", lang)}
        </p>
      </header>

      {/* Structural edits are desktop-only; say so rather than hiding controls silently. */}
      <p className="text-[12px] text-foreground/50 sm:hidden">
        {t("volumes.mobileHint", lang)}
      </p>

      {error ? (
        <p role="alert" className="text-[13px] text-destructive">
          {error}
        </p>
      ) : null}

      {volumes.length === 0 ? (
        <p className="text-sm text-foreground/60">{t("volumes.empty", lang)}</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {volumes.map((volume) => {
            const volumeBusy = busy?.kind === "volume" && busy.id === volume.id;
            const renaming = editing === `v:${volume.id}`;
            return (
              <li
                key={volume.id}
                className={cn(
                  "rounded-lg border border-border/60 bg-card/40 p-4",
                  volumeBusy && "opacity-60",
                )}
              >
                <div className="flex flex-wrap items-center gap-2">
                  {renaming ? (
                    <Input
                      autoFocus
                      value={draftName}
                      aria-label={t("volumes.renameVolume", lang)}
                      placeholder={t("volumes.namePlaceholder", lang)}
                      className="h-8 max-w-[240px]"
                      onChange={(e) => setDraftName(e.target.value)}
                      onBlur={() => commitVolumeName(volume)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") commitVolumeName(volume);
                        if (e.key === "Escape") setEditing(null);
                      }}
                    />
                  ) : (
                    <button
                      type="button"
                      className="rounded text-left text-sm font-medium underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2"
                      onClick={() => {
                        setDraftName(volume.label);
                        setEditing(`v:${volume.id}`);
                      }}
                      title={t("volumes.renameVolume", lang)}
                    >
                      {volume.label || `#${volume.volume_number}`}
                    </button>
                  )}

                  <span className="text-[12px] text-foreground/50">
                    {volume.volume_rooms.length} {t("volumes.rooms", lang)}
                  </span>

                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={volumeBusy}
                    className="ml-auto hidden text-[12px] text-foreground/60 sm:inline-flex"
                    onClick={async () => {
                      const proceed = await confirm({
                        title: t("volumes.archiveConfirm", lang),
                        confirmLabel: t("volumes.archive", lang),
                        cancelLabel: t("common.cancel", lang),
                        destructive: true,
                      });
                      if (!proceed) return;
                      void run({ kind: "volume", id: volume.id }, () =>
                        archiveDraftVolume(draftId, volume.id),
                      );
                    }}
                  >
                    {t("volumes.archive", lang)}
                  </Button>
                </div>

                {volume.volume_rooms.length === 0 ? (
                  <p className="mt-3 text-[13px] text-foreground/50">
                    {t("volumes.noRooms", lang)}
                  </p>
                ) : (
                  <ul className="mt-3 flex flex-col divide-y divide-border/40">
                    {volume.volume_rooms.map((room) => {
                      const roomBusy = busy?.kind === "room" && busy.id === room.id;
                      const roomRenaming = editing === `r:${room.id}`;
                      const otherVolumes = volumes.filter((v) => v.id !== volume.id);
                      return (
                        <li
                          key={room.id}
                          className={cn(
                            "flex flex-wrap items-center gap-2 py-2",
                            roomBusy && "opacity-60",
                          )}
                        >
                          {roomRenaming && floorplanId ? (
                            <Input
                              autoFocus
                              value={draftName}
                              aria-label={t("volumes.renameRoom", lang)}
                              placeholder={t("volumes.namePlaceholder", lang)}
                              className="h-8 max-w-[220px]"
                              onChange={(e) => setDraftName(e.target.value)}
                              onBlur={() => commitRoomName(room)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") commitRoomName(room);
                                if (e.key === "Escape") setEditing(null);
                              }}
                            />
                          ) : (
                            <button
                              type="button"
                              disabled={!floorplanId}
                              className="rounded text-left text-[13px] underline-offset-4 enabled:hover:underline disabled:cursor-default focus-visible:outline-2 focus-visible:outline-offset-2"
                              onClick={() => {
                                setDraftName(room.room_label);
                                setEditing(`r:${room.id}`);
                              }}
                              title={floorplanId ? t("volumes.renameRoom", lang) : undefined}
                            >
                              {room.room_label || `#${room.room_number}`}
                            </button>
                          )}

                          {/* Structural controls: desktop only. */}
                          <div className="ml-auto hidden items-center gap-2 sm:flex">
                            {otherVolumes.length > 0 ? (
                              <select
                                aria-label={t("volumes.moveTo", lang)}
                                disabled={roomBusy}
                                value=""
                                className="h-8 rounded-md border border-border/60 bg-transparent px-2 text-[12px]"
                                onChange={(e) => {
                                  const target = otherVolumes.find(
                                    (v) => String(v.id) === e.target.value,
                                  );
                                  if (!target) return;
                                  void run({ kind: "room", id: room.id }, () =>
                                    moveRoomToVolume(draftId, room, volume, target),
                                  );
                                }}
                              >
                                <option value="">{t("volumes.moveTo", lang)}</option>
                                {otherVolumes.map((v) => (
                                  <option key={v.id} value={v.id}>
                                    {v.label || `#${v.volume_number}`}
                                  </option>
                                ))}
                              </select>
                            ) : null}

                            {volume.volume_rooms.length > 1 ? (
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                disabled={roomBusy}
                                className="text-[12px] text-foreground/60"
                                onClick={() =>
                                  void run({ kind: "room", id: room.id }, () =>
                                    splitRoomIntoNewVolume(draftId, room, volume, volumes),
                                  )
                                }
                              >
                                {t("volumes.splitOut", lang)}
                              </Button>
                            ) : null}
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {confirmDialog}
    </section>
  );
}

export default VolumesEditor;
