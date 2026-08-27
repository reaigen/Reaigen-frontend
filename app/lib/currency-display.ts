/** Return the active currency's own mark; never substitute a fixed `$` icon. */
export function currencyDisplaySymbol(
  currency: string | null | undefined,
  lang: string,
  catalogSymbol?: string | null,
): string {
  const supplied = catalogSymbol?.trim();
  if (supplied) return supplied;

  const code = currency?.trim().toUpperCase();
  if (!code) return "¤";
  try {
    return new Intl.NumberFormat(lang, {
      style: "currency",
      currency: code,
      currencyDisplay: "narrowSymbol",
      maximumFractionDigits: 0,
    }).formatToParts(0).find((part) => part.type === "currency")?.value ?? code;
  } catch {
    return code.slice(0, 3);
  }
}
