/**
 * Style sheets: capture, apply, and (de)serialize the transferable slice of
 * a plot's style overrides.  Pure functions — no React, no atoms.
 *
 * A style sheet IS the `transferable` partition of `StyleOverrides` (defined by
 * the engine's style_registry).  Geom-scoped looks always travel; content keys
 * (title, labels, axis ranges, drag offsets) never do.
 */

import type { StyleKnob, StyleOverrides } from "../types";

/* ---- types ---- */

/** The transferable slice of StyleOverrides — look, not content. */
export type TransferableStyle = Omit<StyleOverrides,
  "title" | "x_label" | "y_label" | "offsets" | "axes_rect"
  | "x_tick_spacing" | "y_tick_spacing"
  | "x_min" | "x_max" | "y_min" | "y_max">;

export interface StyleSheet {
  iris_style_version: "1.0";
  name: string;
  style: TransferableStyle;
}

/* ---- helpers ---- */

/** Derive the set of flat (figure-scope) keys the registry tags `transferable`. */
export function transferableKeys(registry: StyleKnob[]): string[] {
  return registry
    .filter((k) => k.scope === "figure" && k.transferable)
    .map((k) => k.key);
}

/** Extract the transferable slice of a plot's style overrides. */
export function captureStyle(
  overrides: StyleOverrides,
  registry: StyleKnob[],
): TransferableStyle {
  const keys = transferableKeys(registry);
  const out: Record<string, unknown> = {};
  const src = overrides as Record<string, unknown>;
  for (const k of keys) {
    if (src[k] !== undefined) out[k] = src[k];
  }
  if (overrides.geoms) out.geoms = structuredClone(overrides.geoms);
  return out as TransferableStyle;
}

/** Overlay source geom sections onto target by geom name. */
export function mergeGeoms(
  target: Record<string, Record<string, unknown>> | undefined,
  source: Record<string, Record<string, unknown>>,
): Record<string, Record<string, unknown>> {
  const out: Record<string, Record<string, unknown>> = target
    ? structuredClone(target)
    : {};
  for (const [geom, knobs] of Object.entries(source)) {
    out[geom] = { ...(out[geom] ?? {}), ...knobs };
  }
  return out;
}

/** Merge a style sheet onto a target's overrides.  Content keys on the target
 *  survive; the sheet's transferable keys win; geom sections merge by name. */
export function applyStyleSheet(
  target: StyleOverrides,
  sheet: StyleSheet,
  registry: StyleKnob[],
): StyleOverrides {
  const keys = transferableKeys(registry);
  const next: Record<string, unknown> = { ...target };

  // apply flat transferable keys from the sheet
  const src = sheet.style as Record<string, unknown>;
  for (const k of keys) {
    if (src[k] !== undefined) next[k] = src[k];
    // if the sheet explicitly doesn't carry a key, leave the target's value
  }

  // geom sections merge by name
  if (sheet.style.geoms) {
    next.geoms = mergeGeoms(
      target.geoms,
      sheet.style.geoms,
    );
  }

  return next as StyleOverrides;
}

/* ---- .iris-style (de)serialization ---- */

export function serializeStyleSheet(sheet: StyleSheet): string {
  return JSON.stringify(sheet, null, 2);
}

export function parseStyleSheet(json: string): StyleSheet {
  const obj = JSON.parse(json);
  if (typeof obj !== "object" || obj === null) {
    throw new Error("Invalid .iris-style file: not a JSON object");
  }
  const version = obj.iris_style_version;
  if (version !== "1.0") {
    throw new Error(
      version
        ? `Unsupported .iris-style version "${version}" (expected "1.0")`
        : "Missing iris_style_version — not a valid .iris-style file",
    );
  }
  if (typeof obj.style !== "object" || obj.style === null) {
    throw new Error("Invalid .iris-style file: missing style object");
  }
  return {
    iris_style_version: "1.0",
    name: typeof obj.name === "string" ? obj.name : "",
    style: obj.style as TransferableStyle,
  };
}
