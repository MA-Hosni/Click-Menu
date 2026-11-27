import type { Currency, Language } from "./types";

const MONEY_UNIT = { scale: 1000, label: "TND" } as const;

export function minorUnitsPerMajorUnit(currency: Currency): number {
  void currency;
  return MONEY_UNIT.scale;
}

/** Parses a decimal major-unit input without floating-point monetary math. */
export function parseMajorUnits(
  value: string,
  currency: Currency,
): number | null {
  void currency;
  const digits = 3;
  const match = /^(\d+)(?:\.(\d*))?$/.exec(value.trim());
  if (!match || (match[2]?.length ?? 0) > digits) return null;

  const fraction = (match[2] ?? "").padEnd(digits, "0");
  const result =
    BigInt(match[1]) * BigInt(MONEY_UNIT.scale) + BigInt(fraction || 0);
  return result <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(result) : null;
}

export function formatMinorUnits(
  amount: number,
  currency: Currency,
  language: Language = "en",
): string {
  if (!Number.isSafeInteger(amount)) throw new RangeError("Amount must be a safe integer.");
  void currency;
  const { scale, label } = MONEY_UNIT;
  const locale = language === "ar" ? "ar-TN" : language === "fr" ? "fr-TN" : "en-TN";
  const absoluteAmount = Math.abs(amount);
  const whole = Math.trunc(absoluteAmount / scale);
  const remainder = absoluteAmount % scale;
  const formatter = new Intl.NumberFormat(locale, { maximumFractionDigits: 0 });
  const wholeText = `${amount < 0 ? "-" : ""}${formatter.format(whole)}`;
  const fractionDigits = 3;
  const number = remainder === 0
    ? wholeText
    : `${wholeText}${new Intl.NumberFormat(locale).formatToParts(1.1).find((part) => part.type === "decimal")?.value ?? "."}${new Intl.NumberFormat(locale, { useGrouping: false, minimumIntegerDigits: fractionDigits }).format(remainder).padStart(fractionDigits, "0")}`;
  return `${number} ${label}`;
}

export function formatMajorUnitsInput(amount: number, currency: Currency): string {
  if (!Number.isSafeInteger(amount)) throw new RangeError("Amount must be a safe integer.");
  void currency;
  const scale = MONEY_UNIT.scale;
  const whole = Math.trunc(amount / scale);
  const fraction = String(amount % scale).padStart(3, "0");
  return fraction === "0".repeat(fraction.length) ? String(whole) : `${whole}.${fraction}`;
}

