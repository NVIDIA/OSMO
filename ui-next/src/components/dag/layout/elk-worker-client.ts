/**
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION. All rights reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 *
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * ELK Layout Client
 *
 * Uses ELK.js with web workers for off-main-thread layout calculation.
 * The worker script is served from /public/elk-worker.min.js (self-hosted).
 *
 * Setup:
 * - The postinstall script copies elk-worker.min.js from node_modules to public/
 * - The file is gitignored (not checked into version control)
 * - Served from our own infrastructure (no third-party CDN dependency)
 * - BasePath-aware: automatically includes /v2 prefix when deployed
 */

import ELK from "elkjs/lib/elk-api.js";
import { getBasePathUrl } from "@/lib/config";
import type { ElkGraph, ElkLayoutResult } from "@/components/dag/types";

// ELK worker script URL - served from our public folder
// Uses getBasePathUrl to ensure it works with basePath (/v2) in production
const ELK_WORKER_URL = getBasePathUrl("/elk-worker.min.js");

// =============================================================================
// ELK Layout Client (Singleton)
// =============================================================================

/**
 * Singleton client for ELK layout calculations.
 *
 * Features:
 * - Lazy initialization (worker only loaded when needed)
 * - Request tracking for debugging
 * - Clean shutdown support
 *
 * Performance: Uses web worker for off-main-thread layout calculations.
 */
class ELKLayoutClient {
  private elk: InstanceType<typeof ELK> | null = null;
  private initPromise: Promise<void> | null = null;
  private pendingRequests = 0;

  /**
   * Lazily initialize ELK instance with web worker.
   * Returns immediately if already initialized.
   */
  private async init(): Promise<void> {
    if (this.elk) return;
    if (this.initPromise) return this.initPromise;

    this.initPromise = this._doInit();
    return this.initPromise;
  }

  private async _doInit(): Promise<void> {
    // Only initialize in browser environment
    if (typeof window === "undefined") {
      return;
    }

    this.elk = new ELK({
      workerUrl: ELK_WORKER_URL,
    });
  }

  /**
   * Calculate layout using ELK.
   *
   * @param graph - ELK graph to layout
   * @returns Promise resolving to the layout result
   * @throws Error if called in SSR environment or if layout fails
   */
  async layout(graph: ElkGraph): Promise<ElkLayoutResult> {
    await this.init();

    if (!this.elk) {
      throw new Error("ELK not initialized (SSR environment)");
    }

    this.pendingRequests++;
    try {
      const result = await (this.elk.layout(graph) as Promise<ElkLayoutResult>);
      return result;
    } finally {
      this.pendingRequests--;
    }
  }

  /**
   * Check if there are pending layout requests.
   * Useful for cleanup/unmount logic.
   */
  hasPendingRequests(): boolean {
    return this.pendingRequests > 0;
  }

  /**
   * Terminate the ELK instance and clean up.
   * Safe to call multiple times.
   */
  terminate(): void {
    this.elk = null;
    this.initPromise = null;
    this.pendingRequests = 0;
  }
}

// Export singleton instance
export const elkWorker = new ELKLayoutClient();

// =============================================================================
// Preloading & Cold Start Optimization
// =============================================================================

/** Track if preload has already been scheduled */
let preloadScheduled = false;

/**
 * Preload the ELK worker eagerly on next tick.
 *
 * Initializes the web worker immediately without blocking the main thread.
 * Worker init is lightweight (~50ms) and runs in a separate thread.
 *
 * Performance: Eager initialization ensures worker is ready before first
 * layout calculation, eliminating 0-2 second requestIdleCallback delays.
 *
 * @example
 * ```tsx
 * // At module level (runs once on import)
 * if (typeof window !== "undefined") {
 *   preloadElkWorker();
 * }
 * ```
 */
export function preloadElkWorker(): void {
  // Only run in browser
  if (typeof window === "undefined") return;

  // Only schedule once per session
  if (preloadScheduled) return;
  preloadScheduled = true;

  // Minimal layout request - just enough to initialize the worker
  // Uses setTimeout(0) to avoid blocking initial render while starting ASAP
  const doPreload = () => {
    elkWorker
      .layout({
        id: "preload",
        layoutOptions: {},
        children: [],
        edges: [],
      })
      .catch(() => {
        // Ignore errors during preload (worker will retry on actual use)
        // Reset flag to allow retry on next call
        preloadScheduled = false;
      });
  };

  // Start immediately on next tick (not during idle time)
  // Worker initialization is fast and non-blocking - no need to wait
  setTimeout(doPreload, 0);
}

/**
 * Check if the ELK worker is ready (initialized).
 * Useful for showing loading indicators.
 */
export function isElkWorkerReady(): boolean {
  // Access private property via bracket notation for external check
  return (elkWorker as unknown as { elk: unknown }).elk !== null;
}
