import type { Language } from "./types";

const MONEY_SCALE = 1000;

export function minorUnitsPerMajorUnit(): number {
  return MONEY_SCALE;
}

/** Parses a decimal major-unit input without floating-point monetary math. */
export function parseMajorUnits(
  value: string,
): number | null {
  const digits = 3;
  const match = /^(\d+)(?:\.(\d*))?$/.exec(value.trim());
  if (!match || (match[2]?.length ?? 0) > digits) return null;

  const fraction = (match[2] ?? "").padEnd(digits, "0");
  const result =
    BigInt(match[1]) * BigInt(MONEY_SCALE) + BigInt(fraction || 0);
  return result <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(result) : null;
}

export function formatMinorUnits(
  amount: number,
  language: Language = "en",
): string {
  if (!Number.isSafeInteger(amount)) throw new RangeError("Amount must be a safe integer.");
  const scale = MONEY_SCALE;
  const locale = language === "ar" ? "ar-TN" : language === "fr" ? "fr-TN" : "en-TN";
  const absoluteAmount = Math.abs(amount);
  const whole = Math.trunc(absoluteAmount / scale);
  const remainder = absoluteAmount % scale;
  const formatter = new Intl.NumberFormat(locale, { maximumFractionDigits: 0 });
  const wholeText = `${amount < 0 ? "-" : ""}${formatter.format(whole)}`;
  const fractionDigits = 3;
  const decimal = new Intl.NumberFormat(locale)
    .formatToParts(1.1)
    .find((part) => part.type === "decimal")?.value ?? ".";
  const fraction = new Intl.NumberFormat(locale, {
    useGrouping: false,
    minimumIntegerDigits: fractionDigits,
  }).format(remainder);
  const number = `${wholeText}${decimal}${fraction}`;
  return number;
}

export function formatMajorUnitsInput(amount: number): string {
  if (!Number.isSafeInteger(amount)) throw new RangeError("Amount must be a safe integer.");
  const scale = MONEY_SCALE;
  const whole = Math.trunc(amount / scale);
  const fraction = String(amount % scale).padStart(3, "0");
  return fraction === "0".repeat(fraction.length) ? String(whole) : `${whole}.${fraction}`;
}

