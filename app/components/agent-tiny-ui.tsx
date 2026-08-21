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
    estate: "Estate", relativeMap: "OpenStreetMap view of verified positions",
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
    estate: "Nehnuteľnosť", relativeMap: "OpenStreetMap náhľad overených polôh",
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
    estate: "Nemovitost", relativeMap: "OpenStreetMap náhled ověřených poloh",
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
    estate: "Immobilie", relativeMap: "OpenStreetMap-Ansicht der verifizierten Positionen",
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

type MiniMapCoordinate = readonly [number, number];

const MINI_MAP_WIDTH = 300;
const MINI_MAP_HEIGHT = 160;
const OSM_TILE_SIZE = 256;
const OSM_TILE_TEMPLATE = process.env.NEXT_PUBLIC_OSM_TILE_URL_TEMPLATE?.trim()
  || "https://tile.openstreetmap.org/{z}/{x}/{y}.png";

function worldCoordinate([longitude, latitude]: MiniMapCoordinate, zoom: number) {
  const scale = OSM_TILE_SIZE * 2 ** zoom;
  const boundedLatitude = Math.max(-85.05112878, Math.min(85.05112878, latitude));
  const sinLatitude = Math.sin(boundedLatitude * Math.PI / 180);
  return {
    x: (longitude + 180) / 360 * scale,
    y: (0.5 - Math.log((1 + sinLatitude) / (1 - sinLatitude)) / (4 * Math.PI)) * scale,
  };
}

function osmTileUrl(zoom: number, x: number, y: number) {
  return OSM_TILE_TEMPLATE
    .replace("{z}", String(zoom))
    .replace("{x}", String(x))
    .replace("{y}", String(y));
}

function buildMiniMapLayout(rawCoordinates: MiniMapCoordinate[]) {
  const coordinates = rawCoordinates.filter(([longitude, latitude]) => (
    Number.isFinite(longitude)
    && Number.isFinite(latitude)
    && longitude >= -180
    && longitude <= 180
    && latitude >= -90
    && latitude <= 90
  ));
  if (!coordinates.length) return null;

  let zoom = 1;
  for (let candidate = 16; candidate >= 1; candidate -= 1) {
    const world = coordinates.map((coordinate) => worldCoordinate(coordinate, candidate));
    const xValues = world.map(({ x }) => x);
    const yValues = world.map(({ y }) => y);
    if (
      Math.max(...xValues) - Math.min(...xValues) <= MINI_MAP_WIDTH - 36
      && Math.max(...yValues) - Math.min(...yValues) <= MINI_MAP_HEIGHT - 36
    ) {
      zoom = candidate;
      break;
    }
  }

  const world = coordinates.map((coordinate) => worldCoordinate(coordinate, zoom));
  const xValues = world.map(({ x }) => x);
  const yValues = world.map(({ y }) => y);
  const centerX = (Math.min(...xValues) + Math.max(...xValues)) / 2;
  const centerY = (Math.min(...yValues) + Math.max(...yValues)) / 2;
  const left = centerX - MINI_MAP_WIDTH / 2;
  const top = centerY - MINI_MAP_HEIGHT / 2;
  const tileCount = 2 ** zoom;
  const minimumTileX = Math.floor(left / OSM_TILE_SIZE);
  const maximumTileX = Math.floor((left + MINI_MAP_WIDTH - 1) / OSM_TILE_SIZE);
  const minimumTileY = Math.max(0, Math.floor(top / OSM_TILE_SIZE));
  const maximumTileY = Math.min(tileCount - 1, Math.floor((top + MINI_MAP_HEIGHT - 1) / OSM_TILE_SIZE));
  const tiles: Array<{ key: string; url: string; left: number; top: number }> = [];
  for (let tileY = minimumTileY; tileY <= maximumTileY; tileY += 1) {
    for (let tileX = minimumTileX; tileX <= maximumTileX; tileX += 1) {
      const wrappedX = ((tileX % tileCount) + tileCount) % tileCount;
      tiles.push({
        key: `${zoom}-${tileX}-${tileY}`,
        url: osmTileUrl(zoom, wrappedX, tileY),
        left: tileX * OSM_TILE_SIZE - left,
        top: tileY * OSM_TILE_SIZE - top,
      });
    }
  }
  return {
    tiles,
    project: (coordinate: MiniMapCoordinate) => {
      const point = worldCoordinate(coordinate, zoom);
      return { x: point.x - left, y: point.y - top };
    },
  };
}

function OsmMiniMap({
  coordinates,
  path,
  straightLine = false,
  markers,
  ariaLabel,
}: {
  coordinates: MiniMapCoordinate[];
  path?: MiniMapCoordinate[];
  straightLine?: boolean;
  markers: Array<{
    coordinate: MiniMapCoordinate;
    kind: "origin" | "destination" | "place";
    label?: string;
    index?: number;
  }>;
  ariaLabel: string;
}) {
  const layout = useMemo(() => buildMiniMapLayout(coordinates), [coordinates]);
  const projectedPath = layout && path
    ? path.map((coordinate) => layout.project(coordinate)).map(({ x, y }) => `${x.toFixed(2)},${y.toFixed(2)}`).join(" ")
    : "";
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className="relative aspect-[15/8] w-full overflow-hidden rounded-xl border border-border/55 bg-foreground/[0.035]"
    >
      {layout?.tiles.map((tile) => (
        /* A native image preserves OSM browser caching and sends the document origin as required by the tile policy. */
        // eslint-disable-next-line @next/next/no-img-element
        <img
          key={tile.key}
          src={tile.url}
          alt=""
          aria-hidden="true"
          loading="lazy"
          decoding="async"
          draggable={false}
          referrerPolicy="origin"
          onError={(event) => { event.currentTarget.hidden = true; }}
          className="pointer-events-none absolute max-w-none select-none"
          style={{
            left: `${tile.left / MINI_MAP_WIDTH * 100}%`,
            top: `${tile.top / MINI_MAP_HEIGHT * 100}%`,
            width: `${OSM_TILE_SIZE / MINI_MAP_WIDTH * 100}%`,
            height: `${OSM_TILE_SIZE / MINI_MAP_HEIGHT * 100}%`,
          }}
        />
      ))}
      <svg
        viewBox={`0 0 ${MINI_MAP_WIDTH} ${MINI_MAP_HEIGHT}`}
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 h-full w-full"
      >
        {projectedPath ? (
          <>
            <polyline points={projectedPath} fill="none" strokeWidth="7" strokeLinecap="round" strokeLinejoin="round" className="stroke-card" />
            <polyline
              points={projectedPath}
              fill="none"
              stroke="currentColor"
              strokeWidth="4"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeDasharray={straightLine ? "7 6" : undefined}
              className="text-violet-700"
            />
          </>
        ) : null}
        {layout ? markers.map((marker, markerIndex) => {
          const point = layout.project(marker.coordinate);
          if (marker.kind === "origin") {
            return <circle key={`origin-${markerIndex}`} cx={point.x} cy={point.y} r="6" className="fill-foreground stroke-card" strokeWidth="3" />;
          }
          if (marker.kind === "destination") {
            return <circle key={`destination-${markerIndex}`} cx={point.x} cy={point.y} r="7" className="fill-violet-600 stroke-card" strokeWidth="3" />;
          }
          return (
            <g
              key={`place-${marker.index ?? markerIndex}`}
              className="animate-pulse motion-reduce:animate-none"
              style={{ animationDelay: `${Math.min((marker.index ?? markerIndex) * 120, 1200)}ms` }}
            >
              <circle cx={point.x} cy={point.y} r="9" className="fill-violet-500/20" />
              <circle cx={point.x} cy={point.y} r="4" className="fill-violet-700 stroke-card" strokeWidth="2" />
              {(marker.index ?? 99) < 8 ? (
                <text x={point.x + 6} y={point.y - 6} className="fill-foreground text-[6.5px] font-semibold">
                  {(marker.index ?? 0) + 1}
                </text>
              ) : null}
            </g>
          );
        }) : null}
        <g className="fill-foreground text-[8px] font-semibold">
          <rect x="267" y="5" width="27" height="32" rx="6" className="fill-card/85" />
          <text x="280.5" y="16" textAnchor="middle">N</text>
          <path d="M280.5 20 L276.5 29 L280.5 26.5 L284.5 29 Z" className="fill-foreground" />
        </g>
      </svg>
      <a
        href="https://www.openstreetmap.org/copyright"
        target="_blank"
        rel="noreferrer"
        className="absolute bottom-0.5 right-0.5 rounded bg-card/90 px-1 py-0.5 text-[7px] font-medium text-foreground underline-offset-2 hover:underline"
      >
        © OpenStreetMap
      </a>
    </div>
  );
}

function TinyRoute({ block, lang }: { block: Extract<ReaiAgentTinyUiBlock, { kind: "route" }>; lang: string }) {
  const copy = tinyCopy(lang);
  const routePath = useMemo(
    () => block.path.filter(([longitude, latitude]) => (
      Number.isFinite(longitude) && Number.isFinite(latitude)
    )).slice(0, 256),
    [block.path],
  );
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
        <OsmMiniMap
          coordinates={routePath}
          path={routePath}
          straightLine={block.preview_kind === "straight_line"}
          markers={routePath.length >= 2 ? [
            { coordinate: routePath[0], kind: "origin" },
            { coordinate: routePath.at(-1)!, kind: "destination" },
          ] : []}
          ariaLabel={`Route geometry from ${block.origin_label} to ${block.destination_label}`}
        />
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
  const mapCoordinates = useMemo(
    () => [block.origin, ...block.places.slice(0, 20).map((place) => place.coordinate)],
    [block.origin, block.places],
  );
  return (
    <section aria-label={block.title} className="floating-panel-shape overflow-hidden border border-violet-500/25 bg-card shadow-control">
      <TinyHeader title={block.title} description={block.description} icon={<MapPinIcon size={14} />} />
      <div className="p-3">
        <OsmMiniMap
          coordinates={mapCoordinates}
          markers={[
            { coordinate: block.origin, kind: "origin", label: copy.estate },
            ...block.places.slice(0, 20).map((place, index) => ({
              coordinate: place.coordinate,
              kind: "place" as const,
              label: place.label,
              index,
            })),
          ]}
          ariaLabel={`${block.places.length} nearby places around ${block.origin_label}`}
        />
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
