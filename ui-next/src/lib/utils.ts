import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export const clamp = (value: number, min: number, max: number): number =>
  value < min ? min : value > max ? max : value;

// SSR-safe platform detection
export const isMac = typeof navigator !== "undefined" && navigator.platform.toUpperCase().includes("MAC");

const NATURAL_SORT_OPTIONS: Intl.CollatorOptions = { numeric: true, sensitivity: "base" };

// Natural/alphanumeric sort: workflow_1, workflow_2, workflow_10 (not workflow_1, workflow_10, workflow_2)
export function naturalCompare(a: string, b: string): number {
  return a.localeCompare(b, undefined, NATURAL_SORT_OPTIONS);
}

export function matchesSearch<T>(item: T, query: string, getSearchableValues: (item: T) => string[]): boolean {
  const trimmed = query.trim();
  if (!trimmed) return true;

  const q = trimmed.toLowerCase();
  return getSearchableValues(item).some((value) => value.toLowerCase().includes(q));
}

export function formatCompact(value: number): string {
  if (value >= 1_000_000_000) {
    const n = value / 1_000_000_000;
    return n >= 10 ? `${Math.round(n).toLocaleString("en-US")}G` : `${n.toFixed(1)}G`;
  }
  if (value >= 1_000_000) {
    const n = value / 1_000_000;
    return n >= 10 ? `${Math.round(n).toLocaleString("en-US")}M` : `${n.toFixed(1)}M`;
  }
  if (value >= 1_000) {
    const n = value / 1_000;
    return n >= 10 ? `${Math.round(n).toLocaleString("en-US")}K` : `${n.toFixed(1)}K`;
  }
  return value.toString();
}

type ByteUnit = "Ki" | "Mi" | "Gi" | "Ti";
const UNIT_ORDER: ByteUnit[] = ["Ki", "Mi", "Gi", "Ti"];

interface FormattedBytes {
  value: string;
  unit: ByteUnit;
  display: string;
  rawGib: number;
}

function formatDecimal(n: number): string {
  if (n >= 10) {
    return Math.round(n).toLocaleString("en-US");
  }
  const fixed = n.toFixed(1);
  return fixed.replace(/\.0$/, "");
}

// Format GiB to most readable binary unit (Ki, Mi, Gi, Ti)
export function formatBytes(gib: number): FormattedBytes {
  if (gib === 0) {
    return { value: "0", unit: "Gi", display: "0 Gi", rawGib: 0 };
  }

  if (gib >= 1024) {
    const ti = gib / 1024;
    const formatted = formatDecimal(ti);
    return { value: formatted, unit: "Ti", display: `${formatted} Ti`, rawGib: gib };
  }

  if (gib >= 1) {
    const formatted = formatDecimal(gib);
    return { value: formatted, unit: "Gi", display: `${formatted} Gi`, rawGib: gib };
  }

  const mi = gib * 1024;
  if (mi >= 1) {
    const formatted = formatDecimal(mi);
    return { value: formatted, unit: "Mi", display: `${formatted} Mi`, rawGib: gib };
  }

  const ki = mi * 1024;
  const formatted = formatDecimal(ki);
  return { value: formatted, unit: "Ki", display: `${formatted} Ki`, rawGib: gib };
}

function gibToUnit(gib: number, unit: ByteUnit): number {
  switch (unit) {
    case "Ti":
      return gib / 1024;
    case "Gi":
      return gib;
    case "Mi":
      return gib * 1024;
    case "Ki":
      return gib * 1024 * 1024;
  }
}

// Format used/total with consistent units, using the more granular unit
export function formatBytesPair(
  usedGib: number,
  totalGib: number,
): { used: string; total: string; unit: ByteUnit; freeDisplay: string } {
  if (usedGib === 0) {
    const totalFormatted = formatBytes(totalGib);
    return {
      used: "0",
      total: totalFormatted.value,
      unit: totalFormatted.unit,
      freeDisplay: totalFormatted.display,
    };
  }

  if (totalGib === 0) {
    const usedFormatted = formatBytes(usedGib);
    return {
      used: usedFormatted.value,
      total: "0",
      unit: usedFormatted.unit,
      freeDisplay: `0 ${usedFormatted.unit}`,
    };
  }

  const usedFormatted = formatBytes(usedGib);
  const totalFormatted = formatBytes(totalGib);

  const usedIdx = UNIT_ORDER.indexOf(usedFormatted.unit);
  const totalIdx = UNIT_ORDER.indexOf(totalFormatted.unit);
  const unit = usedIdx <= totalIdx ? usedFormatted.unit : totalFormatted.unit;

  const usedInUnit = gibToUnit(usedGib, unit);
  const totalInUnit = gibToUnit(totalGib, unit);
  const freeInUnit = totalInUnit - usedInUnit;

  return {
    used: formatDecimal(usedInUnit),
    total: formatDecimal(totalInUnit),
    unit,
    freeDisplay: `${formatDecimal(freeInUnit)} ${unit}`,
  };
}

// Format react-hotkeys-hook syntax for display: "mod+]" → "⌘]" (Mac) or "Ctrl+]" (Windows)
export function formatHotkey(hotkey: string): string {
  const parts = hotkey.toLowerCase().split("+");

  const symbols = parts.map((part) => {
    switch (part) {
      case "mod":
        return isMac ? "⌘" : "Ctrl+";
      case "shift":
        return isMac ? "⇧" : "Shift+";
      case "alt":
        return isMac ? "⌥" : "Alt+";
      case "ctrl":
        return isMac ? "⌃" : "Ctrl+";
      case "escape":
        return "Esc";
      default:
        // Uppercase single letters, keep symbols as-is
        return part.length === 1 ? part.toUpperCase() : part;
    }
  });

  return symbols.join("");
}

// Check if target is an interactive element (inputs, textareas, contenteditable, Radix dropdowns)
export function isInteractiveTarget(target: EventTarget | null): boolean {
  if (!target || !(target instanceof HTMLElement)) return false;

  const tagName = target.tagName;

  if (tagName === "INPUT" || tagName === "TEXTAREA" || tagName === "SELECT") {
    return true;
  }

  if (target.isContentEditable) {
    return true;
  }

  if (target.closest("[data-radix-popper-content-wrapper]")) {
    return true;
  }

  return false;
}
