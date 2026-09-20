export const AGENT_MESSAGE_LIMIT = 2000;
export const AGENT_COMPOSER_MIN_HEIGHT = 64;
export const AGENT_COMPOSER_MAX_HEIGHT = 160;

export function canSendAgentMessage(message: string, busy: boolean): boolean {
  return !busy && message.trim().length > 0 && message.length <= AGENT_MESSAGE_LIMIT;
}

/** Confirming an IME candidate or holding Enter must not send a message. */
export function shouldSendAgentMessage(
  event: { key: string; shiftKey: boolean; altKey: boolean; isComposing: boolean; keyCode: number; repeat: boolean },
  message: string,
  busy: boolean,
): boolean {
  return event.key === "Enter" && !event.shiftKey && !event.altKey
    && !event.isComposing && event.keyCode !== 229 && !event.repeat
    && canSendAgentMessage(message, busy);
}

/** Shrink after sending, grow with text, then scroll without pushing chat away. */
export function resizeAgentComposer(textarea: Pick<HTMLTextAreaElement, "style" | "scrollHeight">): void {
  textarea.style.height = "0px";
  const contentHeight = textarea.scrollHeight;
  textarea.style.height = `${Math.min(AGENT_COMPOSER_MAX_HEIGHT, Math.max(AGENT_COMPOSER_MIN_HEIGHT, contentHeight))}px`;
  textarea.style.overflowY = contentHeight > AGENT_COMPOSER_MAX_HEIGHT ? "auto" : "hidden";
}
