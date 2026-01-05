// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION. All rights reserved.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
// http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.
//
// SPDX-License-Identifier: Apache-2.0

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
 *
 * Verification:
 * - Open DevTools → Sources → look for elk-worker.min.js under "Workers"
 */

import ELK from "elkjs/lib/elk-api.js";
import type { ElkGraph, ElkLayoutResult } from "../types/dag-layout";

// ELK worker script URL - served from our public folder
// File is copied from node_modules by postinstall script
const ELK_WORKER_URL = "/elk-worker.min.js";

// =============================================================================
// ELK Layout Client (Singleton)
// =============================================================================

class ELKLayoutClient {
  private elk: InstanceType<typeof ELK> | null = null;
  private initPromise: Promise<void> | null = null;

  /**
   * Lazily initialize ELK instance with web worker.
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
   */
  async layout(graph: ElkGraph): Promise<ElkLayoutResult> {
    await this.init();

    if (!this.elk) {
      throw new Error("ELK not initialized (SSR environment)");
    }

    return this.elk.layout(graph) as Promise<ElkLayoutResult>;
  }

  /**
   * Terminate the ELK instance and clean up.
   */
  terminate(): void {
    this.elk = null;
    this.initPromise = null;
  }
}

// Export singleton instance
export const elkWorker = new ELKLayoutClient();
