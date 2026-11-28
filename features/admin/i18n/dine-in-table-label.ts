import type { Language } from "../../../lib/types";

export function formatDineInTableLabel(label: string, language: Language): string {
  const trimmed = label.trim();
  if (!/^\p{Nd}+$/u.test(trimmed)) return label;
  const prefix = language === "ar" ? "طاولة" : "Table";
  return `${prefix} ${trimmed}`;
}
