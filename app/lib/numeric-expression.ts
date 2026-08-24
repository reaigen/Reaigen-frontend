import {
  findUnit,
  normalizeUnitToken,
  unitCategory,
  unitConversionFactor,
  unitsForCategory,
  type UnitLookup,
} from "./unit-catalog";

export type NumericUnitKind = "plain" | "area" | "length" | "money";

export type NumericInputContext = {
  kind: NumericUnitKind;
  /** Unit code, symbol, or id-equivalent token returned by Django. */
  targetUnit?: string;
  /** Canonical units returned by Django's unit lookup endpoint. */
  units?: readonly UnitLookup[];
};

export type NumericExpressionResult = {
  value: number;
  usedMath: boolean;
  usedUnit: boolean;
};

type RuntimeUnitDefinition = {
  category: "area" | "length" | "money";
  factor: number;
  dimension: 0 | 1 | 2;
  symbol: string;
  code?: string;
};

type Quantity = {
  value: number;
  dimension: number;
  moneyUnit?: string;
};

function runtimeDefinition(unit: UnitLookup): RuntimeUnitDefinition | null {
  const factor = unitConversionFactor(unit);
  if (factor == null) return null;
  const category = unitCategory(unit);
  if (category === "AREA") {
    return { category: "area", code: unit.code, symbol: unit.symbol, factor, dimension: 2 };
  }
  if (category === "DISTANCE") {
    return { category: "length", code: unit.code, symbol: unit.symbol, factor, dimension: 1 };
  }
  if (category === "CURRENCY") {
    return { category: "money", code: unit.code, symbol: unit.symbol, factor, dimension: 0 };
  }
  return null;
}

function findMeasurementUnit(token: string, context: NumericInputContext) {
  const unit = findUnit(context.units ?? [], token, ["AREA", "DISTANCE"]);
  return unit ? runtimeDefinition(unit) : null;
}

function findCurrencyUnit(token: string, context: NumericInputContext) {
  const units = context.units ?? [];
  const target = findUnit(units, context.targetUnit, "CURRENCY");
  // Currency symbols are not globally unique (for example ¥). When the typed
  // symbol matches the field's selected backend unit, prefer that exact unit.
  if (target && findUnit([target], token, "CURRENCY")) return target;
  return findUnit(units, token, "CURRENCY");
}

function targetDefinition(context: NumericInputContext): RuntimeUnitDefinition | null {
  const units = context.units ?? [];
  if (context.kind === "area") {
    const unit = findUnit(units, context.targetUnit, "AREA");
    return unit ? runtimeDefinition(unit) : null;
  }
  if (context.kind === "length") {
    const unit = findUnit(units, context.targetUnit, "DISTANCE");
    return unit ? runtimeDefinition(unit) : null;
  }
  if (context.kind === "money") {
    const unit = findUnit(units, context.targetUnit, "CURRENCY");
    return unit ? runtimeDefinition(unit) : null;
  }
  return null;
}

export function numericUnitLabel(context: NumericInputContext): string | null {
  if (context.kind === "plain") return null;
  return targetDefinition(context)?.symbol ?? null;
}

function normalizeSource(input: string) {
  let source = input
    .trim()
    .replace(/[−–—]/g, "-")
    .replace(/×/g, "*")
    .replace(/÷/g, "/")
    .replace(/\s+[xX]\s+/g, " * ")
    .replace(/([0-9)])\s*[xX]\s*(?=[0-9(])/g, "$1*")
    .replace(/\u00a0|\u202f/g, " ");

  // Treat spaces between digit groups as thousands separators while retaining
  // the space between a value and its unit.
  let previous = "";
  while (source !== previous) {
    previous = source;
    source = source.replace(/(\d)\s+(?=\d{3}(?:\D|$))/g, "$1");
  }
  return source;
}

function parseNumberToken(token: string) {
  let normalized = token.replace(/[’']/g, "");
  const comma = normalized.lastIndexOf(",");
  const dot = normalized.lastIndexOf(".");

  if (comma >= 0 && dot >= 0) {
    const decimalIndex = Math.max(comma, dot);
    normalized = [...normalized]
      .filter((char, index) => (char !== "," && char !== ".") || index === decimalIndex)
      .join("")
      .replace(/,/, ".");
  } else {
    const separator = comma >= 0 ? "," : dot >= 0 ? "." : null;
    if (separator) {
      const parts = normalized.split(separator);
      const grouped = parts.length > 2 && parts.slice(1).every((part) => part.length === 3);
      normalized = grouped ? parts.join("") : `${parts.slice(0, -1).join("")}.${parts.at(-1)}`;
    }
  }

  const value = Number(normalized);
  return Number.isFinite(value) ? value : null;
}

class NumericExpressionParser {
  private index = 0;
  private readonly source: string;
  private readonly context: NumericInputContext;
  usedMath = false;
  usedUnit = false;

  constructor(source: string, context: NumericInputContext) {
    this.source = source;
    this.context = context;
  }

  parse(): Quantity | null {
    const result = this.parseAdditive();
    this.skipSpaces();
    return result && this.index === this.source.length ? result : null;
  }

  private parseAdditive(): Quantity | null {
    let left = this.parseMultiplicative();
    if (!left) return null;
    while (true) {
      this.skipSpaces();
      const operator = this.source[this.index];
      if (operator !== "+" && operator !== "-") break;
      this.usedMath = true;
      this.index += 1;
      const right = this.parseMultiplicative();
      if (!right) return null;
      left = this.add(left, right, operator);
      if (!left) return null;
    }
    return left;
  }

  private parseMultiplicative(): Quantity | null {
    let left = this.parseUnary();
    if (!left) return null;
    while (true) {
      this.skipSpaces();
      const operator = this.source[this.index];
      if (operator !== "*" && operator !== "/") break;
      this.usedMath = true;
      this.index += 1;
      const right = this.parseUnary();
      if (!right || (operator === "/" && right.value === 0)) return null;
      left = this.multiply(left, right, operator);
      if (!left) return null;
    }
    return left;
  }

  private parseUnary(): Quantity | null {
    this.skipSpaces();
    const operator = this.source[this.index];
    if (operator === "+" || operator === "-") {
      this.index += 1;
      const value = this.parseUnary();
      if (!value) return null;
      return operator === "-" ? { ...value, value: -value.value } : value;
    }
    return this.parsePrimary();
  }

  private parsePrimary(): Quantity | null {
    this.skipSpaces();
    const prefixUnit = this.readCurrencyPrefix();
    this.skipSpaces();

    let quantity: Quantity | null;
    if (this.source[this.index] === "(") {
      this.usedMath = true;
      this.index += 1;
      quantity = this.parseAdditive();
      this.skipSpaces();
      if (!quantity || this.source[this.index] !== ")") return null;
      this.index += 1;
    } else {
      const token = this.readNumber();
      if (!token) return null;
      const value = parseNumberToken(token);
      if (value == null) return null;
      quantity = { value, dimension: 0 };
    }

    if (prefixUnit) {
      quantity = this.applyUnit(quantity, prefixUnit);
      if (!quantity) return null;
    }

    const unit = this.readUnit();
    if (unit) quantity = this.applyUnit(quantity, unit);
    return quantity;
  }

  private readNumber() {
    this.skipSpaces();
    const start = this.index;
    while (/[0-9.,’']/.test(this.source[this.index] ?? "")) this.index += 1;
    return this.source.slice(start, this.index);
  }

  private readCurrencyPrefix() {
    const before = this.index;
    this.skipSpaces();
    const start = this.index;
    const tokens = unitsForCategory(this.context.units ?? [], "CURRENCY")
      .flatMap((unit) => [unit.symbol, unit.code])
      .filter(Boolean)
      .sort((left, right) => right.length - left.length);

    for (const token of tokens) {
      const candidate = this.source.slice(start, start + token.length);
      if (candidate.toLocaleLowerCase("en") !== token.toLocaleLowerCase("en")) continue;
      let nextIndex = start + token.length;
      while (/\s/.test(this.source[nextIndex] ?? "")) nextIndex += 1;
      if (!/[0-9(]/.test(this.source[nextIndex] ?? "")) continue;
      this.index = start + token.length;
      return candidate;
    }

    this.index = before;
    return null;
  }

  private readUnit() {
    const beforeSpaces = this.index;
    this.skipSpaces();
    const start = this.index;

    const lookupTokens = (this.context.units ?? [])
      .filter((unit) => unit.is_active !== false)
      .flatMap((unit) => [unit.code, unit.symbol, unit.name, unit.plural_name ?? ""])
      .filter(Boolean)
      .sort((left, right) => right.length - left.length);
    for (const lookupToken of lookupTokens) {
      const candidate = this.source.slice(start, start + lookupToken.length);
      if (normalizeUnitToken(candidate) !== normalizeUnitToken(lookupToken)) continue;
      const next = this.source[start + lookupToken.length] ?? "";
      if (/[\p{L}\p{N}²^]/u.test(next)) continue;
      this.index = start + lookupToken.length;
      return candidate;
    }

    while (/[\p{L}\p{N}\p{Sc}²^]/u.test(this.source[this.index] ?? "")) this.index += 1;
    const token = this.source.slice(start, this.index);
    if (!token) {
      this.index = beforeSpaces;
      return null;
    }
    return token;
  }

  private applyUnit(quantity: Quantity, token: string): Quantity | null {
    if (quantity.dimension !== 0 || quantity.moneyUnit) return null;
    const measurement = findMeasurementUnit(token, this.context);
    if (measurement) {
      this.usedUnit = true;
      return {
        value: quantity.value * measurement.factor,
        dimension: measurement.dimension,
      };
    }

    const currency = findCurrencyUnit(token, this.context);
    if (currency) {
      const targetCurrency = findUnit(this.context.units ?? [], this.context.targetUnit, "CURRENCY");
      if (this.context.kind !== "money" || !targetCurrency || currency.code !== targetCurrency.code) return null;
      this.usedUnit = true;
      return { value: quantity.value, dimension: 0, moneyUnit: currency.code };
    }
    return null;
  }

  private add(left: Quantity, right: Quantity, operator: "+" | "-"): Quantity | null {
    const target = targetDefinition(this.context);
    if (left.dimension !== right.dimension) {
      if (!target || target.dimension === 0) return null;
      if (left.dimension === 0 && !left.moneyUnit && right.dimension === target.dimension) {
        left = { value: left.value * target.factor, dimension: target.dimension };
      } else if (right.dimension === 0 && !right.moneyUnit && left.dimension === target.dimension) {
        right = { value: right.value * target.factor, dimension: target.dimension };
      } else {
        return null;
      }
    }

    const leftMoney = left.moneyUnit;
    const rightMoney = right.moneyUnit;
    if (leftMoney && rightMoney && leftMoney !== rightMoney) return null;
    const moneyUnit = leftMoney ?? rightMoney;
    return {
      value: operator === "+" ? left.value + right.value : left.value - right.value,
      dimension: left.dimension,
      ...(moneyUnit ? { moneyUnit } : {}),
    };
  }

  private multiply(left: Quantity, right: Quantity, operator: "*" | "/"): Quantity | null {
    if (operator === "*" && left.moneyUnit && right.moneyUnit) return null;
    if (operator === "/" && right.moneyUnit) return null;
    const dimension = operator === "*"
      ? left.dimension + right.dimension
      : left.dimension - right.dimension;
    if (dimension < 0 || dimension > 2) return null;
    const moneyUnit = left.moneyUnit ?? (operator === "*" ? right.moneyUnit : undefined);
    return {
      value: operator === "*" ? left.value * right.value : left.value / right.value,
      dimension,
      ...(moneyUnit ? { moneyUnit } : {}),
    };
  }

  private skipSpaces() {
    while (/\s/.test(this.source[this.index] ?? "")) this.index += 1;
  }
}

export function parseNumericExpression(
  input: string,
  context: NumericInputContext = { kind: "plain" },
): NumericExpressionResult | null {
  const source = normalizeSource(input);
  if (!source) return null;
  const parser = new NumericExpressionParser(source, context);
  const parsed = parser.parse();
  if (!parsed || !Number.isFinite(parsed.value)) return null;

  const target = targetDefinition(context);
  let value = parsed.value;
  if (context.kind === "area" || context.kind === "length") {
    if (parsed.dimension === 0) {
      // A unitless final result is already expressed in the field's displayed unit.
      value = parsed.value;
    } else if (target && parsed.dimension === target.dimension) {
      value = parsed.value / target.factor;
    } else {
      return null;
    }
  } else if (parsed.dimension !== 0) {
    return null;
  } else if (context.kind === "money") {
    if (parsed.moneyUnit && (!target?.code || parsed.moneyUnit !== target.code)) return null;
  }

  if (!Number.isFinite(value) || Math.abs(value) > Number.MAX_SAFE_INTEGER) return null;
  return { value, usedMath: parser.usedMath, usedUnit: parser.usedUnit };
}

export function formatEditableNumber(value: number, integer = false) {
  if (!Number.isFinite(value)) return "";
  const rounded = integer
    ? Math.round(value)
    : Math.round((value + Number.EPSILON) * 1_000_000) / 1_000_000;
  return Object.is(rounded, -0) ? "0" : String(rounded);
}

export function numericInputPlaceholder(context: NumericInputContext) {
  const unit = numericUnitLabel(context);
  if (context.kind === "area") return unit ? `85 ${unit} + 12 ${unit}` : "85 + 12";
  if (context.kind === "length") {
    const distanceUnits = unitsForCategory(context.units ?? [], "DISTANCE");
    const target = findUnit(distanceUnits, context.targetUnit, "DISTANCE");
    const secondary = distanceUnits.find((candidate) => candidate.code !== target?.code);
    if (target && secondary) return `3 ${target.symbol} + 20 ${secondary.symbol}`;
    return unit ? `3 ${unit} + 0.2 ${unit}` : "3 + 0.2";
  }
  if (context.kind === "money") return "250000 / 1.2";
  return "0";
}
