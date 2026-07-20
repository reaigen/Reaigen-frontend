"use client";

import * as React from "react";

import {
  acceptAppContentDocument,
  listAppContentDocuments,
  type AppContentAudience,
  type AppContentDocument,
  type AppContentDocumentType,
  type AppContentScope,
} from "../lib/api/client";
import { formatDate, t, type LocaleKey } from "../lib/i18n";
import { Button } from "../lib/ui/button";
import { cn } from "../lib/utils";
import { useAuth } from "./hooks/use-auth";

const LEGAL_DOCUMENT_KEYS = ["terms", "privacy", "gdpr", "license"];
const ALLOWED_HTML_TAGS = new Set([
  "a",
  "b",
  "blockquote",
  "br",
  "code",
  "dd",
  "div",
  "dl",
  "dt",
  "em",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "hr",
  "i",
  "li",
  "ol",
  "p",
  "pre",
  "s",
  "span",
  "strong",
  "table",
  "tbody",
  "td",
  "th",
  "thead",
  "tr",
  "u",
  "ul",
]);
const DROP_HTML_CONTENT_TAGS = new Set(["script", "style", "iframe", "object", "embed", "svg", "math", "link", "meta"]);
const GLOBAL_HTML_ATTRIBUTES = new Set(["aria-label", "title"]);
const TABLE_CELL_ATTRIBUTES = new Set(["colspan", "rowspan"]);

function isSafeHref(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return false;
  if (trimmed.startsWith("#") || trimmed.startsWith("/")) return true;
  try {
    const parsed = new URL(trimmed, window.location.origin);
    return ["http:", "https:", "mailto:", "tel:"].includes(parsed.protocol);
  } catch {
    return false;
  }
}

function sanitizeElementAttributes(element: Element, tagName: string) {
  for (const attribute of Array.from(element.attributes)) {
    const name = attribute.name.toLowerCase();
    const value = attribute.value;
    const allowed =
      GLOBAL_HTML_ATTRIBUTES.has(name) ||
      (tagName === "a" && ["href", "target", "rel"].includes(name)) ||
      ((tagName === "td" || tagName === "th") && TABLE_CELL_ATTRIBUTES.has(name));

    if (!allowed || name.startsWith("on") || name === "style" || name === "srcdoc") {
      element.removeAttribute(attribute.name);
      continue;
    }

    if (tagName === "a" && name === "href" && !isSafeHref(value)) {
      element.removeAttribute(attribute.name);
    }
  }

  if (tagName === "a") {
    element.setAttribute("rel", "noopener noreferrer");
    if (element.getAttribute("target") && element.getAttribute("target") !== "_blank") {
      element.removeAttribute("target");
    }
  }
}

function sanitizeHtml(html: string) {
  if (typeof window === "undefined") return "";
  const template = window.document.createElement("template");
  template.innerHTML = html;

  function walk(parent: Node) {
    for (const child of Array.from(parent.childNodes)) {
      if (child.nodeType === Node.TEXT_NODE) continue;
      if (child.nodeType !== Node.ELEMENT_NODE) {
        child.remove();
        continue;
      }

      const element = child as Element;
      const tagName = element.tagName.toLowerCase();

      if (DROP_HTML_CONTENT_TAGS.has(tagName)) {
        element.remove();
        continue;
      }

      if (!ALLOWED_HTML_TAGS.has(tagName)) {
        while (element.firstChild) parent.insertBefore(element.firstChild, element);
        element.remove();
        walk(parent);
        continue;
      }

      sanitizeElementAttributes(element, tagName);
      walk(element);
    }
  }

  walk(template.content);
  return template.innerHTML;
}

function formatDocumentDate(value: string | null | undefined, lang: string, dateFormat?: string | null) {
  return formatDate(value, dateFormat, lang) || t("common.notRecorded", lang);
}

function metadataString(metadata: Record<string, unknown> | null | undefined, key: string) {
  const value = metadata?.[key];
  return typeof value === "string" ? value : "";
}

function fallbackTitle(key: string, lang: string) {
  if (key === "terms") return t("content.titleTerms", lang);
  if (key === "privacy") return t("content.titlePrivacy", lang);
  if (key === "gdpr") return t("content.titleGdpr", lang);
  if (key === "license") return t("content.titleLicense", lang);
  return key.replace(/[-_.]+/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

function browserCountryCode() {
  if (typeof navigator === "undefined") return "";
  const locale = navigator.language || "";
  const parts = locale.split("-");
  return (parts[1] || "").slice(0, 2).toUpperCase();
}

function useDocuments(params: {
  keys?: string[];
  documentType?: AppContentDocumentType;
  language: string;
  countryCode?: string;
  regionCode?: string;
  appScope?: AppContentScope;
  audience?: AppContentAudience;
}) {
  const [documents, setDocuments] = React.useState<AppContentDocument[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [failed, setFailed] = React.useState(false);
  const keysKey = params.keys?.join(",") ?? "";
  const appScope = params.appScope ?? "reaigen";
  const audience = params.audience ?? "all";
  const countryCode = (params.countryCode ?? "").trim().toUpperCase();
  const regionCode = (params.regionCode ?? "").trim();

  React.useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setFailed(false);

    listAppContentDocuments({
      keys: keysKey ? keysKey.split(",") : undefined,
      document_type: params.documentType,
      language: params.language,
      country_code: countryCode,
      region_code: regionCode,
      platform: "web",
      app_scope: appScope,
      audience,
    })
      .then((nextDocuments) => {
        if (!cancelled) setDocuments(nextDocuments);
      })
      .catch(() => {
        if (!cancelled) {
          setDocuments([]);
          setFailed(true);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [keysKey, params.documentType, params.language, countryCode, regionCode, appScope, audience]);

  return { documents, loading, failed };
}

function DocumentBody({ document, compact = false }: { document: AppContentDocument; compact?: boolean }) {
  const sanitizedHtml = React.useMemo(
    () => document.body_format === "html" ? sanitizeHtml(document.body) : "",
    [document.body, document.body_format],
  );
  const className = cn(
    "max-w-none text-foreground",
    compact ? "text-[13px] leading-relaxed" : "text-[14px] leading-7",
    "[&_a]:font-medium [&_a]:underline [&_a]:underline-offset-4",
    "[&_h1]:mb-3 [&_h1]:text-xl [&_h2]:mb-2 [&_h2]:mt-5 [&_h2]:text-lg [&_p]:mb-3 [&_ul]:mb-3 [&_ul]:list-disc [&_ul]:pl-5",
  );

  if (document.body_format === "html") {
    return <div className={className} dangerouslySetInnerHTML={{ __html: sanitizedHtml }} />;
  }

  return <div className={cn(className, "whitespace-pre-wrap")}>{document.body}</div>;
}

export function ContentDocumentDialog({
  document,
  lang,
  onClose,
}: {
  document: AppContentDocument;
  lang: string;
  onClose: () => void;
}) {
  const { user } = useAuth();
  const dialogRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  React.useEffect(() => {
    const previousOverflow = window.document.body.style.overflow;
    window.document.body.style.overflow = "hidden";
    dialogRef.current?.focus();
    return () => {
      window.document.body.style.overflow = previousOverflow;
    };
  }, []);

  return (
    <div className="fixed inset-0 z-[10000] flex items-end bg-black/25 backdrop-blur-[2px] animate-fade-in sm:items-center sm:justify-center" role="dialog" aria-modal="true">
      <button className="absolute inset-0 cursor-default" type="button" aria-label={t("common.close", lang)} onClick={onClose} />
      <div ref={dialogRef} tabIndex={-1} className="relative max-h-[88dvh] w-full overflow-hidden rounded-t-2xl border border-border/60 bg-background shadow-2xl outline-none animate-fade-in sm:max-w-3xl sm:rounded-2xl">
        <div className="flex items-start justify-between gap-4 border-b border-border/40 px-5 py-4 sm:px-6">
          <div className="min-w-0">
            <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
              {document.document_type_display}
            </p>
            <h2 className="mt-1 text-[20px] font-semibold tracking-tight text-foreground">
              {document.title || fallbackTitle(document.key, lang)}
            </h2>
            <p className="mt-1 text-[12px] text-muted-foreground">
              {t("common.version", lang)} {document.version} · {t("common.updated", lang)} {formatDocumentDate(document.updated_at, lang, user?.localization?.date_format)}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 rounded-lg px-2 py-1 text-[13px] font-medium text-foreground/55 transition-colors hover:bg-foreground/[0.04] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            {t("common.close", lang)}
          </button>
        </div>
        <div className="max-h-[calc(88dvh-5.8rem)] overflow-y-auto px-5 py-5 sm:px-6">
          {document.summary && (
            <p className="mb-5 rounded-xl border border-border/60 bg-muted/25 px-3 py-2 text-[13px] leading-relaxed text-muted-foreground">
              {document.summary}
            </p>
          )}
          <DocumentBody document={document} />
        </div>
      </div>
    </div>
  );
}

export function RegistrationLegalText({ lang }: { lang: string }) {
  const [countryCode, setCountryCode] = React.useState("");
  React.useEffect(() => {
    setCountryCode(browserCountryCode());
  }, []);

  const { documents } = useDocuments({
    keys: ["terms", "privacy", "gdpr"],
    language: lang,
    countryCode,
    audience: "guest",
  });
  const [selectedDocument, setSelectedDocument] = React.useState<AppContentDocument | null>(null);

  const byKey = React.useMemo(() => new Map(documents.map((document) => [document.key, document])), [documents]);

  function legalButton(key: string, label: string) {
    const document = byKey.get(key);
    if (!document) return <span>{label}</span>;
    return (
      <button
        type="button"
        onClick={() => setSelectedDocument(document)}
        className="font-medium text-foreground underline underline-offset-4 transition-colors hover:text-foreground/70"
      >
        {document.title || label}
      </button>
    );
  }

  return (
    <>
      <span>
        {t("auth.register.agreePrefix", lang)} {legalButton("terms", t("content.titleTerms", lang))} {t("auth.register.agreeAnd", lang)} {legalButton("privacy", t("content.titlePrivacy", lang))}
      </span>
      {byKey.has("gdpr") && <span>, {t("auth.register.agreeIncluding", lang)} {legalButton("gdpr", t("content.titleGdpr", lang))}</span>}
      {selectedDocument && <ContentDocumentDialog document={selectedDocument} lang={lang} onClose={() => setSelectedDocument(null)} />}
    </>
  );
}

export function ManagedLegalDocuments({
  lang,
  countryCode,
  regionCode,
  onAccepted,
}: {
  lang: string;
  countryCode?: string;
  regionCode?: string;
  onAccepted?: () => void;
}) {
  const { documents, loading, failed } = useDocuments({
    keys: LEGAL_DOCUMENT_KEYS,
    language: lang,
    countryCode,
    regionCode,
    audience: "authenticated",
  });
  const [selectedDocument, setSelectedDocument] = React.useState<AppContentDocument | null>(null);
  const [acceptingId, setAcceptingId] = React.useState<number | null>(null);
  const [acceptError, setAcceptError] = React.useState<string | null>(null);
  const [acceptedIds, setAcceptedIds] = React.useState<Set<number>>(() => new Set());
  const orderedDocuments = React.useMemo(
    () => [...documents].sort((a, b) => LEGAL_DOCUMENT_KEYS.indexOf(a.key) - LEGAL_DOCUMENT_KEYS.indexOf(b.key)),
    [documents],
  );

  async function acceptDocument(document: AppContentDocument) {
    setAcceptingId(document.id);
    setAcceptError(null);
    try {
      await acceptAppContentDocument({
        document_id: document.id,
        country_code: countryCode,
        region_code: regionCode,
        metadata: { surface: "settings" },
      });
      setAcceptedIds((current) => new Set(current).add(document.id));
      onAccepted?.();
    } catch {
      setAcceptError(t("content.acceptFailed", lang));
    } finally {
      setAcceptingId(null);
    }
  }

  if (loading) {
    return <p className="text-[12px] text-muted-foreground">{t("content.loadingDocuments", lang)}</p>;
  }

  if (failed) {
    return <p className="text-[12px] text-muted-foreground">{t("content.documentsUnavailable", lang)}</p>;
  }

  if (orderedDocuments.length === 0) {
    return <p className="text-[12px] text-muted-foreground">{t("content.noManagedDocuments", lang)}</p>;
  }

  return (
    <>
      {acceptError ? (
        <p role="alert" className="mb-3 rounded-xl border border-destructive/20 bg-destructive/[0.045] px-3 py-2.5 text-[12px] text-destructive">{acceptError}</p>
      ) : null}
      <div className="divide-y divide-border/70 rounded-lg border border-border/70">
        {orderedDocuments.map((document) => {
          const accepted = acceptedIds.has(document.id);
          return (
            <div key={document.id} className="grid grid-cols-1 gap-3 px-4 py-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-[13px] font-medium text-foreground/88">{document.title || fallbackTitle(document.key, lang)}</p>
                  {document.requires_acceptance && (
                    <span className="rounded-full bg-foreground/[0.07] px-2 py-0.5 text-[11px] font-medium text-foreground/60">
                      {t("common.required", lang)}
                    </span>
                  )}
                </div>
                <p className="mt-1 text-[11px] text-muted-foreground">
                  {document.document_type_display} - v{document.version} - {t("common.updated", lang)} {formatDocumentDate(document.updated_at, lang)}
                  {document.country_code ? ` - ${document.country_code}${document.region_code ? `/${document.region_code}` : ""}` : ""}
                </p>
              </div>
              <div className="flex flex-wrap gap-2 sm:justify-end">
                <Button type="button" variant="outline" size="xs" onClick={() => setSelectedDocument(document)}>
                  {t("common.open", lang)}
                </Button>
                {document.requires_acceptance && (
                  <Button
                    type="button"
                    variant={accepted ? "secondary" : "default"}
                    size="xs"
                    loading={acceptingId === document.id}
                    onClick={() => acceptDocument(document)}
                    disabled={accepted || acceptingId === document.id}
                  >
                    {accepted ? t("common.accepted", lang) : t("common.acceptLatest", lang)}
                  </Button>
                )}
              </div>
            </div>
          );
        })}
      </div>
      {selectedDocument && <ContentDocumentDialog document={selectedDocument} lang={lang} onClose={() => setSelectedDocument(null)} />}
    </>
  );
}

export function AppContentMessages({
  lang,
  countryCode,
  regionCode,
  className,
}: {
  lang: string;
  countryCode?: string;
  regionCode?: string;
  className?: string;
}) {
  const { documents } = useDocuments({
    documentType: "message",
    language: lang,
    countryCode,
    regionCode,
    audience: "authenticated",
  });
  const [dismissed, setDismissed] = React.useState<Set<number>>(() => new Set());

  React.useEffect(() => {
    try {
      const raw = window.localStorage.getItem("reaigen.dismissedContentMessages.v1");
      const ids = raw ? JSON.parse(raw) : [];
      if (Array.isArray(ids)) setDismissed(new Set(ids.filter((id): id is number => typeof id === "number")));
    } catch {
      setDismissed(new Set());
    }
  }, []);

  function dismiss(documentId: number) {
    setDismissed((current) => {
      const next = new Set(current).add(documentId);
      try {
        window.localStorage.setItem("reaigen.dismissedContentMessages.v1", JSON.stringify([...next]));
      } catch {}
      return next;
    });
  }

  const visibleDocuments = documents.filter((document) => !dismissed.has(document.id));
  if (visibleDocuments.length === 0) return null;

  return (
    <div className={cn("mb-5 space-y-2", className)}>
      {visibleDocuments.map((document) => {
        const ctaUrl = metadataString(document.metadata, "cta_url");
        const ctaLabel = metadataString(document.metadata, "cta_label") || t("common.open", lang);
        const dismissible = document.metadata?.dismissible !== false;

        return (
          <section key={document.id} className="rounded-lg border border-border/70 bg-muted/20 px-4 py-3">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <p className="text-[13px] font-semibold text-foreground/88">{document.title}</p>
                <div className="mt-1">
                  <DocumentBody document={document} compact />
                </div>
                {ctaUrl && (
                  <a
                    href={ctaUrl}
                    className="mt-2 inline-flex text-[12px] font-medium text-foreground underline underline-offset-4"
                    target={ctaUrl.startsWith("http") ? "_blank" : undefined}
                    rel={ctaUrl.startsWith("http") ? "noreferrer" : undefined}
                  >
                    {ctaLabel}
                  </a>
                )}
              </div>
              {dismissible && (
                <button
                  type="button"
                  onClick={() => dismiss(document.id)}
                  className="shrink-0 rounded-lg px-2 py-1 text-[12px] text-muted-foreground transition-colors hover:bg-foreground/[0.05] hover:text-foreground"
                >
                  {t("common.dismiss", lang)}
                </button>
              )}
            </div>
          </section>
        );
      })}
    </div>
  );
}
