export const REAI_COMPOSE_EVENT = "reai-agent-compose";

export type ReaiComposeDetail = {
  prompt: string;
};

export function openReaiComposer(prompt: string) {
  window.dispatchEvent(new CustomEvent<ReaiComposeDetail>(REAI_COMPOSE_EVENT, {
    detail: { prompt },
  }));
}

export function readReaiComposeDetail(event: Event): ReaiComposeDetail | null {
  const detail = (event as CustomEvent<Partial<ReaiComposeDetail>>).detail;
  return typeof detail?.prompt === "string" && detail.prompt.trim()
    ? { prompt: detail.prompt.trim() }
    : null;
}
