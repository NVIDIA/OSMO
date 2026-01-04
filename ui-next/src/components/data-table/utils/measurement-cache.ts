/**
 * Copyright (c) 2026, NVIDIA CORPORATION. All rights reserved.
 *
 * NVIDIA CORPORATION and its licensors retain all intellectual property
 * and proprietary rights in and to this software, related documentation
 * and any modifications thereto. Any use, reproduction, disclosure or
 * distribution of this software and related documentation without an express
 * license agreement from NVIDIA CORPORATION is strictly prohibited.
 */

/**
 * High-Performance Measurement Cache
 *
 * Eliminates DOM reads during critical user paths by:
 * 1. Pre-computing text widths using Canvas measureText()
 * 2. Caching measurements keyed by content hash
 * 3. Using requestIdleCallback for background measurement
 * 4. Providing instant lookups during interactions
 *
 * ## Performance Characteristics
 * - Canvas measureText(): ~0.01ms per call (100x faster than DOM)
 * - Cache lookup: O(1) hash map
 * - Memory: ~100 bytes per unique text value
 */

// =============================================================================
// Types
// =============================================================================

export interface MeasurementCacheConfig {
  /** CSS font string for body text (e.g., "14px Inter") */
  bodyFont: string;
  /** CSS font string for header text (e.g., "600 14px Inter") */
  headerFont: string;
  /** Additional padding to add to measurements */
  padding: number;
}

export interface ColumnMeasurement {
  /** Column ID */
  id: string;
  /** Max content width across all rows + header */
  maxWidth: number;
  /** Header text width */
  headerWidth: number;
  /** Timestamp of last measurement */
  timestamp: number;
}

// =============================================================================
// Canvas Context (Singleton)
// =============================================================================

let canvasContext: CanvasRenderingContext2D | null = null;
let contextFont: string = "";

function getContext(font: string): CanvasRenderingContext2D | null {
  if (typeof document === "undefined") return null;

  if (!canvasContext) {
    const canvas = document.createElement("canvas");
    canvasContext = canvas.getContext("2d", { alpha: false });
  }

  // Only set font if it changed (expensive operation)
  if (canvasContext && contextFont !== font) {
    canvasContext.font = font;
    contextFont = font;
  }

  return canvasContext;
}

// =============================================================================
// Fast Text Width Measurement
// =============================================================================

/**
 * Measure text width using Canvas (no DOM reflow).
 * Cached font context for maximum speed.
 */
export function measureText(text: string, font: string): number {
  const ctx = getContext(font);
  if (!ctx || !text) return 0;
  return ctx.measureText(text).width;
}

/**
 * Batch measure multiple texts with same font (most efficient).
 */
export function measureTexts(texts: string[], font: string): number[] {
  const ctx = getContext(font);
  if (!ctx) return texts.map(() => 0);

  return texts.map((text) => (text ? ctx.measureText(text).width : 0));
}

// =============================================================================
// Content Hash (for cache keys)
// =============================================================================

/**
 * Fast string hash using FNV-1a algorithm.
 * Used to create cache keys from content.
 */
function hashString(str: string): number {
  let hash = 2166136261; // FNV offset basis
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = (hash * 16777619) >>> 0; // FNV prime, keep as 32-bit
  }
  return hash;
}

// =============================================================================
// Measurement Cache
// =============================================================================

export class MeasurementCache {
  private config: MeasurementCacheConfig;
  private cache: Map<string, ColumnMeasurement> = new Map();
  private textWidthCache: Map<number, number> = new Map(); // hash -> width
  private pendingMeasurement: number | null = null;

  constructor(config: MeasurementCacheConfig) {
    this.config = config;
  }

  /**
   * Get cached measurement for a column.
   */
  get(columnId: string): ColumnMeasurement | undefined {
    return this.cache.get(columnId);
  }

  /**
   * Get max width for a column (or undefined if not measured).
   */
  getMaxWidth(columnId: string): number | undefined {
    return this.cache.get(columnId)?.maxWidth;
  }

  /**
   * Check if we have valid measurements.
   */
  hasValidMeasurements(): boolean {
    return this.cache.size > 0;
  }

  /**
   * Measure a single text value (with caching).
   */
  measureTextCached(text: string, isHeader: boolean = false): number {
    if (!text) return 0;

    const hash = hashString(text + (isHeader ? ":h" : ":b"));
    const cached = this.textWidthCache.get(hash);
    if (cached !== undefined) return cached;

    const font = isHeader ? this.config.headerFont : this.config.bodyFont;
    const width = measureText(text, font);
    this.textWidthCache.set(hash, width);
    return width;
  }

  /**
   * Measure columns from data (fast, no DOM).
   *
   * @param columns - Column definitions with getTextValue accessors
   * @param data - Array of row data
   * @returns Map of columnId -> max width
   */
  measureFromData<TData>(
    columns: Array<{
      id: string;
      headerText: string;
      getTextValue?: (row: TData) => string;
    }>,
    data: TData[],
  ): Record<string, number> {
    const result: Record<string, number> = {};
    const now = Date.now();

    for (const col of columns) {
      if (!col.getTextValue) continue;

      // Measure header
      let maxWidth = this.measureTextCached(col.headerText, true);

      // Measure all data rows
      for (const row of data) {
        const text = col.getTextValue(row);
        if (text) {
          maxWidth = Math.max(maxWidth, this.measureTextCached(text, false));
        }
      }

      // Add padding and store
      const finalWidth = Math.ceil(maxWidth) + this.config.padding;
      result[col.id] = finalWidth;

      // Update cache
      this.cache.set(col.id, {
        id: col.id,
        maxWidth: finalWidth,
        headerWidth: this.measureTextCached(col.headerText, true) + this.config.padding,
        timestamp: now,
      });
    }

    return result;
  }

  /**
   * Schedule measurement during browser idle time.
   */
  measureInIdle<TData>(
    columns: Array<{
      id: string;
      headerText: string;
      getTextValue?: (row: TData) => string;
    }>,
    data: TData[],
    callback: (widths: Record<string, number>) => void,
  ): void {
    // Cancel any pending measurement
    if (this.pendingMeasurement !== null) {
      if (typeof cancelIdleCallback !== "undefined") {
        cancelIdleCallback(this.pendingMeasurement);
      } else {
        clearTimeout(this.pendingMeasurement);
      }
    }

    const measure = () => {
      const widths = this.measureFromData(columns, data);
      callback(widths);
      this.pendingMeasurement = null;
    };

    // Use requestIdleCallback if available, else setTimeout
    if (typeof requestIdleCallback !== "undefined") {
      this.pendingMeasurement = requestIdleCallback(measure, { timeout: 100 });
    } else {
      this.pendingMeasurement = window.setTimeout(measure, 0) as unknown as number;
    }
  }

  /**
   * Invalidate cache (call when data changes significantly).
   */
  invalidate(columnIds?: string[]): void {
    if (columnIds) {
      for (const id of columnIds) {
        this.cache.delete(id);
      }
    } else {
      this.cache.clear();
    }
  }

  /**
   * Clear all caches (including text width cache).
   */
  clear(): void {
    this.cache.clear();
    this.textWidthCache.clear();
  }

  /**
   * Update config (e.g., when font changes).
   */
  updateConfig(config: Partial<MeasurementCacheConfig>): void {
    this.config = { ...this.config, ...config };
    // Clear text cache since font may have changed
    this.textWidthCache.clear();
  }
}

// =============================================================================
// Singleton Factory
// =============================================================================

const cacheInstances: Map<string, MeasurementCache> = new Map();

/**
 * Get or create a measurement cache for a table.
 * Uses a singleton pattern keyed by table ID for reuse.
 */
export function getMeasurementCache(
  tableId: string,
  config?: MeasurementCacheConfig,
): MeasurementCache {
  let cache = cacheInstances.get(tableId);
  if (!cache && config) {
    cache = new MeasurementCache(config);
    cacheInstances.set(tableId, cache);
  }
  return cache!;
}

/**
 * Clear all measurement caches (e.g., on hot reload).
 */
export function clearAllCaches(): void {
  for (const cache of cacheInstances.values()) {
    cache.clear();
  }
  cacheInstances.clear();
}
