"use client";

import { Component, useMemo, useState, type ReactNode } from "react";

import type { ReaiAgentResponse, ReaiAgentTinyUiBlock } from "../lib/api/client";
import { Button } from "../lib/ui/button";
import { Input } from "../lib/ui/input";
import { cn } from "../lib/utils";
import { ArrowRightIcon, LayoutIcon, MapPinIcon, PriceIcon, SparklesIcon } from "./icons";

const TONE_BAR: Record<"neutral" | "success" | "warning", string> = {
  neutral: "bg-foreground/70",
  success: "bg-emerald-600",
  warning: "bg-amber-500",
};

const TINY_COPY = {
  en: {
    fact: "Fact", source: "Source", trafficDelay: "traffic delay", routePreview: "Route geometry preview", geographicPreview: "Straight-line geographic preview",
    estate: "Estate", relativeMap: "Relative spatial preview without a street basemap",
    interactiveActions: "Interactive actions", inProgress: "In progress", outOf100: "out of 100",
    price: "Purchase price", area: "Area", rent: "Monthly rent", costs: "Annual operating costs",
    down: "Down payment", interest: "Annual interest rate", term: "Loan term (years)",
    priceM2: "Price / m²", yield: "Gross yield", capRate: "Scenario cap rate",
    payment: "Monthly principal + interest",
    financeNote: "Local scenario calculator. No market rate, tax, approval, or investment recommendation is implied.",
    discuss: "Discuss this scenario with Agent",
  },
  sk: {
    fact: "Fakt", source: "Zdroj", trafficDelay: "zdržanie v premávke", routePreview: "Náhľad geometrie trasy", geographicPreview: "Geografický náhľad vzdušnou čiarou",
    estate: "Nehnuteľnosť", relativeMap: "Relatívny priestorový náhľad bez uličnej podkladovej mapy",
    interactiveActions: "Interaktívne akcie", inProgress: "Prebieha", outOf100: "zo 100",
    price: "Kúpna cena", area: "Plocha", rent: "Mesačné nájomné", costs: "Ročné prevádzkové náklady",
    down: "Vlastné zdroje", interest: "Ročná úroková sadzba", term: "Splatnosť úveru (roky)",
    priceM2: "Cena / m²", yield: "Hrubý výnos", capRate: "Kapitalizačná miera scenára",
    payment: "Mesačná istina + úrok",
    financeNote: "Lokálny scenárový kalkulátor. Nevyjadruje trhovú sadzbu, daň, schválenie ani investičné odporúčanie.",
    discuss: "Prediskutovať scenár s Agentom",
  },
  cs: {
    fact: "Fakt", source: "Zdroj", trafficDelay: "zdržení v provozu", routePreview: "Náhled geometrie trasy", geographicPreview: "Geografický náhled vzdušnou čarou",
    estate: "Nemovitost", relativeMap: "Relativní prostorový náhled bez uliční podkladové mapy",
    interactiveActions: "Interaktivní akce", inProgress: "Probíhá", outOf100: "ze 100",
    price: "Kupní cena", area: "Plocha", rent: "Měsíční nájem", costs: "Roční provozní náklady",
    down: "Vlastní zdroje", interest: "Roční úroková sazba", term: "Splatnost úvěru (roky)",
    priceM2: "Cena / m²", yield: "Hrubý výnos", capRate: "Kapitalizační míra scénáře",
    payment: "Měsíční jistina + úrok",
    financeNote: "Lokální scénářový kalkulátor. Nevyjadřuje tržní sazbu, daň, schválení ani investiční doporučení.",
    discuss: "Probrat scénář s Agentem",
  },
  de: {
    fact: "Fakt", source: "Quelle", trafficDelay: "Verkehrsverzögerung", routePreview: "Vorschau der Routengeometrie", geographicPreview: "Geografische Luftlinienvorschau",
    estate: "Immobilie", relativeMap: "Relative räumliche Vorschau ohne Straßenbasiskarte",
    interactiveActions: "Interaktive Aktionen", inProgress: "Läuft", outOf100: "von 100",
    price: "Kaufpreis", area: "Fläche", rent: "Monatsmiete", costs: "Jährliche Betriebskosten",
    down: "Eigenkapital", interest: "Jährlicher Zinssatz", term: "Kreditlaufzeit (Jahre)",
    priceM2: "Preis / m²", yield: "Bruttorendite", capRate: "Kapitalisierungsrate im Szenario",
    payment: "Monatliche Tilgung + Zinsen",
    financeNote: "Lokaler Szenariorechner. Marktzinssatz, Steuer, Kreditzusage oder Anlageempfehlung werden nicht unterstellt.",
    discuss: "Szenario mit Agent besprechen",
  },
} as const;

function tinyCopy(lang: string) {
  const code = lang.toLowerCase().split("-")[0] as keyof typeof TINY_COPY;
  return TINY_COPY[code] ?? TINY_COPY.en;
}

/** One malformed experimental mini-app must not take down the whole chat turn. */
class TinyErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    return this.state.failed ? null : this.props.children;
  }
}

function TinyHeader({ title, description, icon }: { title: string; description?: string; icon: ReactNode }) {
  return (
    <header className="flex items-start gap-2.5 border-b border-border/45 px-3 py-2.5">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-violet-600 text-white">
        {icon}
      </span>
      <div className="min-w-0 flex-1 pt-0.5">
        <div className="flex flex-wrap items-center gap-1.5">
          <h3 className="truncate text-[12px] font-semibold">{title}</h3>
          <span className="rounded-full bg-violet-500/10 px-1.5 py-0.5 text-[8px] font-semibold uppercase tracking-[0.08em] text-violet-700 dark:text-violet-300">
            TinyUI · experimental
          </span>
        </div>
        {description ? <p className="mt-0.5 line-clamp-2 text-[10px] leading-4 text-muted-foreground">{description}</p> : null}
      </div>
    </header>
  );
}

function TinyChart({ block, lang }: { block: Extract<ReaiAgentTinyUiBlock, { kind: "chart" }>; lang: string }) {
  const max = Math.max(...block.items.map((item) => Math.abs(item.value)), 1);
  return (
    <section aria-label={block.title} className="floating-panel-shape overflow-hidden border border-violet-500/25 bg-card shadow-control">
      <TinyHeader title={block.title} description={block.description} icon={<LayoutIcon size={14} />} />
      <div className="space-y-2.5 p-3">
        {block.items.slice(0, 8).map((item, index) => (
          <div key={`${item.label}-${index}`}>
            <div className="flex items-baseline justify-between gap-3 text-[10px]">
              <span className="min-w-0 truncate font-medium">{item.label}</span>
              <span className="shrink-0 font-semibold tabular-nums text-foreground/70">
                {item.display_value ?? `${new Intl.NumberFormat(lang, { maximumFractionDigits: 2 }).format(item.value)}${block.unit ? ` ${block.unit}` : ""}`}
              </span>
            </div>
            <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-foreground/[0.07]">
              <span
                className={cn("block h-full min-w-0.5 rounded-full", TONE_BAR[item.tone ?? "neutral"])}
                style={{ width: `${Math.max(1.5, Math.abs(item.value) / max * 100)}%` }}
              />
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function TinyComparison({ block, lang }: { block: Extract<ReaiAgentTinyUiBlock, { kind: "comparison" }>; lang: string }) {
  const copy = tinyCopy(lang);
  return (
    <section aria-label={block.title} className="floating-panel-shape overflow-hidden border border-violet-500/25 bg-card shadow-control">
      <TinyHeader title={block.title} description={block.description} icon={<LayoutIcon size={14} />} />
      <div className="overflow-x-auto p-3">
        <table className="w-full min-w-[280px] border-separate border-spacing-0 text-[10px]">
          <thead>
            <tr>
              <th className="border-b border-border/55 px-2 py-1.5 text-left font-medium text-muted-foreground" scope="col">{copy.fact}</th>
              {block.columns.slice(0, 4).map((column) => (
                <th key={column} className="border-b border-border/55 px-2 py-1.5 text-right font-semibold" scope="col">{column}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {block.rows.slice(0, 6).map((row) => (
              <tr key={row.label} className={cn(row.tone === "warning" && "bg-amber-500/[0.06]", row.tone === "success" && "bg-emerald-500/[0.06]")}>
                <th className="border-b border-border/35 px-2 py-2 text-left font-medium text-muted-foreground" scope="row">{row.label}</th>
                {row.values.slice(0, block.columns.length).map((value, index) => (
                  <td key={`${row.label}-${block.columns[index] ?? index}`} className="border-b border-border/35 px-2 py-2 text-right font-semibold tabular-nums">{value}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function TinyScorecard({ block, lang }: { block: Extract<ReaiAgentTinyUiBlock, { kind: "scorecard" }>; lang: string }) {
  const copy = tinyCopy(lang);
  return (
    <section aria-label={block.title} className="floating-panel-shape overflow-hidden border border-violet-500/25 bg-card shadow-control">
      <TinyHeader title={block.title} description={block.description} icon={<LayoutIcon size={14} />} />
      <dl className="space-y-3 p-3">
        {block.metrics.slice(0, 8).map((metric) => (
          <div key={metric.label}>
            <div className="flex items-baseline justify-between gap-3">
              <dt className="min-w-0 truncate text-[10px] font-medium text-muted-foreground">{metric.label}</dt>
              <dd className="shrink-0 text-[11px] font-semibold tabular-nums">{metric.value}</dd>
            </div>
            {metric.score != null ? (
              <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-foreground/[0.07]" aria-label={`${metric.label}: ${metric.score} ${copy.outOf100}`}>
                <span className={cn("block h-full rounded-full", TONE_BAR[metric.tone ?? "neutral"])} style={{ width: `${Math.max(1.5, Math.min(100, metric.score))}%` }} />
              </div>
            ) : null}
            {metric.hint ? <p className="mt-1 text-[9px] leading-4 text-muted-foreground">{metric.hint}</p> : null}
          </div>
        ))}
      </dl>
      {block.source ? <p className="border-t border-border/45 px-3 py-2 text-[9px] leading-4 text-muted-foreground">{copy.source}: {block.source}</p> : null}
    </section>
  );
}

function TinyRoute({ block, lang }: { block: Extract<ReaiAgentTinyUiBlock, { kind: "route" }>; lang: string }) {
  const copy = tinyCopy(lang);
  const projected = useMemo(() => {
    const points = block.path.filter(([lon, lat]) => Number.isFinite(lon) && Number.isFinite(lat)).slice(0, 256);
    if (points.length < 2) return "";
    const longitudes = points.map(([lon]) => lon);
    const latitudes = points.map(([, lat]) => lat);
    const minLon = Math.min(...longitudes);
    const maxLon = Math.max(...longitudes);
    const minLat = Math.min(...latitudes);
    const maxLat = Math.max(...latitudes);
    const lonSpan = Math.max(maxLon - minLon, 0.000001);
    const latSpan = Math.max(maxLat - minLat, 0.000001);
    return points.map(([lon, lat]) => {
      const x = 12 + (lon - minLon) / lonSpan * 276;
      const y = 12 + (maxLat - lat) / latSpan * 136;
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    }).join(" ");
  }, [block.path]);
  const pointList = projected.split(" ");
  const first = pointList[0]?.split(",").map(Number);
  const last = pointList.at(-1)?.split(",").map(Number);
  const distance = block.distance_m >= 1000 ? `${(block.distance_m / 1000).toFixed(1)} km` : `${Math.round(block.distance_m)} m`;
  const minutes = block.duration_s == null ? null : Math.max(1, Math.round(block.duration_s / 60));
  const duration = minutes == null ? null : (minutes >= 60 ? `${Math.floor(minutes / 60)} h ${minutes % 60} min` : `${minutes} min`);
  const previewLabel = block.preview_kind === "straight_line" ? copy.geographicPreview : copy.routePreview;
  return (
    <section aria-label={block.title} className="floating-panel-shape overflow-hidden border border-violet-500/25 bg-card shadow-control">
      <TinyHeader
        title={block.title}
        description={`${block.mode} · ${distance}${duration ? ` · ${duration}` : ` · ${copy.geographicPreview}`}${block.traffic_delay_s ? ` · ${Math.max(1, Math.round(block.traffic_delay_s / 60))} min ${copy.trafficDelay}` : ""}`}
        icon={<MapPinIcon size={14} />}
      />
      <div className="p-3">
        <svg viewBox="0 0 300 160" role="img" aria-label={`Route geometry from ${block.origin_label} to ${block.destination_label}`} className="h-auto w-full rounded-xl border border-border/55 bg-foreground/[0.025]">
          <defs>
            <pattern id="tiny-route-grid" width="24" height="24" patternUnits="userSpaceOnUse">
              <path d="M 24 0 L 0 0 0 24" fill="none" stroke="currentColor" strokeOpacity="0.06" strokeWidth="1" />
            </pattern>
          </defs>
          <rect width="300" height="160" fill="url(#tiny-route-grid)" />
          {projected ? <polyline points={projected} fill="none" stroke="currentColor" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" className="text-violet-600" /> : null}
          {first ? <circle cx={first[0]} cy={first[1]} r="5" className="fill-foreground" /> : null}
          {last ? <circle cx={last[0]} cy={last[1]} r="6" className="fill-violet-600 stroke-card" strokeWidth="3" /> : null}
          <g className="fill-muted-foreground text-[8px] font-semibold">
            <text x="282" y="14" textAnchor="middle">N</text>
            <path d="M282 19 L278 27 L282 25 L286 27 Z" className="fill-muted-foreground" />
          </g>
        </svg>
        <div className="mt-2 grid grid-cols-[1fr_auto_1fr] items-center gap-2 text-[10px]">
          <span className="truncate font-medium">{block.origin_label}</span>
          <ArrowRightIcon size={11} className="text-muted-foreground" />
          <span className="truncate text-right font-medium">{block.destination_label}</span>
        </div>
        <p className="mt-2 text-[9px] leading-4 text-muted-foreground">{previewLabel} · {block.attribution}</p>
        {block.warning ? <p className="mt-1.5 rounded-lg bg-amber-500/10 px-2 py-1.5 text-[9px] leading-4 text-amber-800 dark:text-amber-200">{block.warning}</p> : null}
      </div>
    </section>
  );
}

function TinyNearbyMap({
  block,
  busy,
  onPrompt,
  lang,
}: {
  block: Extract<ReaiAgentTinyUiBlock, { kind: "map" }>;
  busy: boolean;
  onPrompt: (prompt: string) => void;
  lang: string;
}) {
  const copy = tinyCopy(lang);
  const projected = useMemo(() => {
    const raw = [
      { coordinate: block.origin, origin: true, label: block.origin_label, distance_m: 0 },
      ...block.places.slice(0, 20).map((place) => ({ ...place, origin: false })),
    ];
    const longitudes = raw.map((item) => item.coordinate[0]);
    const latitudes = raw.map((item) => item.coordinate[1]);
    const minLon = Math.min(...longitudes);
    const maxLon = Math.max(...longitudes);
    const minLat = Math.min(...latitudes);
    const maxLat = Math.max(...latitudes);
    const lonSpan = Math.max(maxLon - minLon, 0.0005);
    const latSpan = Math.max(maxLat - minLat, 0.0005);
    return raw.map((item) => ({
      ...item,
      x: 18 + (item.coordinate[0] - minLon) / lonSpan * 264,
      y: 18 + (maxLat - item.coordinate[1]) / latSpan * 124,
    }));
  }, [block.origin, block.origin_label, block.places]);
  return (
    <section aria-label={block.title} className="floating-panel-shape overflow-hidden border border-violet-500/25 bg-card shadow-control">
      <TinyHeader title={block.title} description={block.description} icon={<MapPinIcon size={14} />} />
      <div className="p-3">
        <svg viewBox="0 0 300 160" role="img" aria-label={`${block.places.length} nearby places around ${block.origin_label}`} className="h-auto w-full rounded-xl border border-border/55 bg-foreground/[0.025]">
          <defs>
            <pattern id="tiny-nearby-grid" width="24" height="24" patternUnits="userSpaceOnUse">
              <path d="M 24 0 L 0 0 0 24" fill="none" stroke="currentColor" strokeOpacity="0.06" strokeWidth="1" />
            </pattern>
          </defs>
          <rect width="300" height="160" fill="url(#tiny-nearby-grid)" />
          <circle cx={projected[0]?.x} cy={projected[0]?.y} r="34" fill="none" stroke="currentColor" strokeOpacity="0.08" strokeDasharray="3 4" />
          <circle cx={projected[0]?.x} cy={projected[0]?.y} r="68" fill="none" stroke="currentColor" strokeOpacity="0.06" strokeDasharray="3 4" />
          {projected.map((point, index) => point.origin ? (
            <g key="origin">
              <circle cx={point.x} cy={point.y} r="7" className="fill-foreground stroke-card" strokeWidth="3" />
              <text x={point.x + 9} y={point.y - 8} className="fill-foreground text-[7px] font-semibold">{copy.estate}</text>
            </g>
          ) : (
            <g key={`${point.label}-${index}`} className="animate-pulse motion-reduce:animate-none" style={{ animationDelay: `${Math.min(index * 120, 1200)}ms` }}>
              <circle cx={point.x} cy={point.y} r="9" className="fill-violet-500/15" />
              <circle cx={point.x} cy={point.y} r="4" className="fill-violet-600 stroke-card" strokeWidth="2" />
              {index <= 8 ? <text x={point.x + 6} y={point.y - 6} className="fill-foreground text-[6.5px] font-medium">{index}</text> : null}
            </g>
          ))}
          <g className="fill-muted-foreground text-[8px] font-semibold">
            <text x="282" y="14" textAnchor="middle">N</text>
            <path d="M282 19 L278 27 L282 25 L286 27 Z" className="fill-muted-foreground" />
          </g>
        </svg>
        <ol className="mt-2 grid gap-1 sm:grid-cols-2">
          {block.places.slice(0, 8).map((place, index) => (
            <li key={`${place.label}-${index}`}>
              <button
                type="button"
                disabled={busy}
                onClick={() => onPrompt(`Show the walking route to the nearby ${place.category} ${place.label}`)}
                className="flex min-h-8 w-full min-w-0 items-center gap-1.5 rounded-lg px-1 text-left text-[9px] transition-colors hover:bg-foreground/[0.04] disabled:opacity-45"
                aria-label={`Show walking route to ${place.label}`}
              >
                <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-violet-500/10 font-semibold text-violet-700 dark:text-violet-300">{index + 1}</span>
                <span className="min-w-0 flex-1 truncate font-medium">{place.label}</span>
                <span className="shrink-0 tabular-nums text-muted-foreground">{place.distance_m >= 1000 ? `${(place.distance_m / 1000).toFixed(1)} km` : `${Math.round(place.distance_m)} m`}</span>
              </button>
            </li>
          ))}
        </ol>
        <p className="mt-2 text-[9px] leading-4 text-muted-foreground">
          {copy.relativeMap}{block.attribution ? ` · ${block.attribution}` : ""}
        </p>
      </div>
    </section>
  );
}

function TinyForm({
  block,
  busy,
  onPrompt,
}: {
  block: Extract<ReaiAgentTinyUiBlock, { kind: "form" }>;
  busy: boolean;
  onPrompt: (prompt: string) => void;
}) {
  const [values, setValues] = useState<Record<string, string>>(() => Object.fromEntries(
    block.fields.map((field) => [field.key, field.value == null ? "" : String(field.value)]),
  ));
  const submit = () => {
    const prompt = block.submit.prompt_template.replace(/\{([a-z][a-z0-9_]{0,39})\}/g, (_match, key: string) => values[key] ?? "");
    if (prompt.trim()) onPrompt(prompt);
  };
  const invalid = block.fields.some((field) => field.required && !values[field.key]?.trim());
  return (
    <section aria-label={block.title} className="floating-panel-shape overflow-hidden border border-violet-500/25 bg-card shadow-control">
      <TinyHeader title={block.title} description={block.description} icon={<SparklesIcon size={14} />} />
      <form className="space-y-3 p-3" onSubmit={(event) => { event.preventDefault(); submit(); }}>
        {block.fields.map((field) => (
          <label key={field.key} className="block">
            <span className="mb-1 block text-[10px] font-medium text-foreground/70">{field.label}{field.unit ? ` (${field.unit})` : ""}</span>
            {field.type === "select" ? (
              <select
                value={values[field.key] ?? ""}
                required={field.required}
                onChange={(event) => setValues((current) => ({ ...current, [field.key]: event.target.value }))}
                className="h-10 w-full rounded-xl border border-input bg-card px-3 text-[11px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <option value="">—</option>
                {(field.options ?? []).map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
            ) : (
              <Input
                type={field.type}
                value={values[field.key] ?? ""}
                required={field.required}
                placeholder={field.placeholder}
                min={field.min}
                max={field.max}
                step={field.step}
                onChange={(event) => setValues((current) => ({ ...current, [field.key]: event.target.value }))}
                className="h-10 px-3 text-[11px]"
              />
            )}
          </label>
        ))}
        <Button type="submit" size="sm" disabled={busy || invalid} className="w-full">{block.submit.label}</Button>
      </form>
    </section>
  );
}

type FinanceValues = Extract<ReaiAgentTinyUiBlock, { kind: "calculator" }>["values"];

function TinyFinanceCalculator({
  block,
  busy,
  onPrompt,
  lang,
}: {
  block: Extract<ReaiAgentTinyUiBlock, { kind: "calculator" }>;
  busy: boolean;
  onPrompt: (prompt: string) => void;
  lang: string;
}) {
  const copy = tinyCopy(lang);
  const [values, setValues] = useState<FinanceValues>(block.values);
  const setNumber = (key: keyof FinanceValues, raw: string) => setValues((current) => ({
    ...current,
    [key]: raw === "" ? undefined : Number(raw),
  }));
  const calculations = useMemo(() => {
    const price = values.purchase_price;
    const rent = values.monthly_rent;
    const costs = values.annual_operating_costs ?? 0;
    const area = values.area_m2;
    const down = values.down_payment;
    const rate = values.annual_interest_rate;
    const years = values.term_years;
    const result: Array<{ label: string; value: string }> = [];
    if (price && area) result.push({ label: copy.priceM2, value: `${(price / area).toLocaleString(lang, { maximumFractionDigits: 0 })} ${block.currency}` });
    if (price && rent != null) {
      result.push({ label: copy.yield, value: `${(rent * 12 / price * 100).toFixed(2)}%` });
      result.push({ label: copy.capRate, value: `${(Math.max(0, rent * 12 - costs) / price * 100).toFixed(2)}%` });
    }
    if (price && down != null && rate != null && years) {
      const principal = Math.max(0, price - down);
      const months = Math.round(years * 12);
      const monthlyRate = rate / 100 / 12;
      const payment = monthlyRate === 0
        ? principal / months
        : principal * monthlyRate * (1 + monthlyRate) ** months / ((1 + monthlyRate) ** months - 1);
      if (Number.isFinite(payment)) result.push({ label: copy.payment, value: `${payment.toLocaleString(lang, { maximumFractionDigits: 0 })} ${block.currency}` });
    }
    return result;
  }, [block.currency, copy.capRate, copy.payment, copy.priceM2, copy.yield, lang, values]);
  const fields: Array<{ key: keyof FinanceValues; label: string; step?: number }> = [
    { key: "purchase_price", label: `${copy.price} (${block.currency})` },
    { key: "area_m2", label: `${copy.area} (m²)`, step: 0.1 },
    { key: "monthly_rent", label: `${copy.rent} (${block.currency})` },
    { key: "annual_operating_costs", label: `${copy.costs} (${block.currency})` },
    { key: "down_payment", label: `${copy.down} (${block.currency})` },
    { key: "annual_interest_rate", label: `${copy.interest} (%)`, step: 0.01 },
    { key: "term_years", label: copy.term, step: 1 },
  ];
  const discuss = () => onPrompt(
    `Analyze this property financial scenario using purchase price ${values.purchase_price ?? "not set"} ${block.currency}, area ${values.area_m2 ?? "not set"} m2, monthly rent ${values.monthly_rent ?? "not set"} ${block.currency}, annual operating costs ${values.annual_operating_costs ?? 0} ${block.currency}, down payment ${values.down_payment ?? "not set"} ${block.currency}, annual interest rate ${values.annual_interest_rate ?? "not set"} percent, and term years ${values.term_years ?? "not set"}.`,
  );
  return (
    <section aria-label={block.title} className="floating-panel-shape overflow-hidden border border-violet-500/25 bg-card shadow-control">
      <TinyHeader title={block.title} description={block.description} icon={<PriceIcon size={14} />} />
      <div className="grid gap-2 p-3 sm:grid-cols-2">
        {fields.map((field) => (
          <label key={field.key} className="block">
            <span className="mb-1 block truncate text-[9px] font-medium text-muted-foreground">{field.label}</span>
            <Input
              type="number"
              min={0}
              step={field.step ?? 1}
              value={values[field.key] ?? ""}
              onChange={(event) => setNumber(field.key, event.target.value)}
              className="h-9 px-2.5 text-[11px]"
            />
          </label>
        ))}
      </div>
      <dl className="grid grid-cols-2 gap-px border-y border-border/45 bg-border/45">
        {calculations.map((item) => (
          <div key={item.label} className="bg-card px-3 py-2">
            <dt className="text-[8px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">{item.label}</dt>
            <dd className="mt-1 text-[12px] font-semibold tabular-nums">{item.value}</dd>
          </div>
        ))}
      </dl>
      <div className="p-3">
        <p className="mb-2 text-[9px] leading-4 text-muted-foreground">{copy.financeNote}</p>
        <Button type="button" size="sm" variant="outline" disabled={busy} onClick={discuss} className="w-full">{copy.discuss}</Button>
      </div>
    </section>
  );
}

function TinyBasicBlock({ block, busy, onPrompt, lang }: { block: Extract<ReaiAgentTinyUiBlock, { kind: "summary" | "actions" | "progress" }>; busy: boolean; onPrompt: (prompt: string) => void; lang: string }) {
  const copy = tinyCopy(lang);
  if (block.kind === "actions") {
    return (
      <section className="floating-panel-shape overflow-hidden border border-violet-500/25 bg-card shadow-control">
        <TinyHeader title={block.title ?? copy.interactiveActions} icon={<SparklesIcon size={14} />} />
        <div className="divide-y divide-border/40">
          {block.actions.slice(0, 3).map((action) => (
            <button key={action.prompt} type="button" disabled={busy} onClick={() => onPrompt(action.prompt)} className="flex min-h-11 w-full items-center justify-between gap-2 px-3 py-2 text-left text-[11px] font-semibold hover:bg-foreground/[0.035] disabled:opacity-45">
              <span className="truncate">{action.label}</span><ArrowRightIcon size={12} />
            </button>
          ))}
        </div>
      </section>
    );
  }
  if (block.kind === "progress") {
    return <TinyChart lang={lang} block={{ kind: "chart", chart: "bar", title: block.title, description: block.detail, unit: "%", items: [{ label: block.label, value: block.value ?? 0, display_value: block.value == null ? copy.inProgress : `${Math.round(block.value)}%`, tone: block.tone }] }} />;
  }
  return (
    <section className="floating-panel-shape overflow-hidden border border-violet-500/25 bg-card shadow-control">
      <TinyHeader title={block.title} description={block.description} icon={<LayoutIcon size={14} />} />
      <dl className="grid grid-cols-2 gap-px bg-border/45">
        {block.items.slice(0, 4).map((item) => <div key={item.label} className="bg-card px-3 py-2"><dt className="truncate text-[9px] text-muted-foreground">{item.label}</dt><dd className="mt-1 truncate text-[12px] font-semibold">{item.value}</dd></div>)}
      </dl>
    </section>
  );
}

function TinyBlock({ block, busy, onPrompt, lang }: { block: ReaiAgentTinyUiBlock; busy: boolean; onPrompt: (prompt: string) => void; lang: string }) {
  if (block.kind === "chart") return <TinyChart block={block} lang={lang} />;
  if (block.kind === "comparison") return <TinyComparison block={block} lang={lang} />;
  if (block.kind === "scorecard") return <TinyScorecard block={block} lang={lang} />;
  if (block.kind === "map") return <TinyNearbyMap block={block} busy={busy} onPrompt={onPrompt} lang={lang} />;
  if (block.kind === "route") return <TinyRoute block={block} lang={lang} />;
  if (block.kind === "form") return <TinyForm block={block} busy={busy} onPrompt={onPrompt} />;
  if (block.kind === "calculator") return <TinyFinanceCalculator block={block} busy={busy} onPrompt={onPrompt} lang={lang} />;
  return <TinyBasicBlock block={block} busy={busy} onPrompt={onPrompt} lang={lang} />;
}

export function AgentTinyUi({ answer, busy, onPrompt, lang }: { answer: ReaiAgentResponse; busy: boolean; onPrompt: (prompt: string) => void; lang: string }) {
  if (answer.tinyui?.schema !== "com.reaigen.agent.tinyui" || answer.tinyui.version !== 1) return null;
  const blocks = answer.tinyui.blocks.slice(0, 2);
  if (blocks.length === 0) return null;
  return (
    <div className="mt-3 space-y-2.5">
      {blocks.map((block, index) => (
        <TinyErrorBoundary key={`${block.kind}-${index}`}>
          <TinyBlock block={block} busy={busy} onPrompt={onPrompt} lang={lang} />
        </TinyErrorBoundary>
      ))}
    </div>
  );
}
