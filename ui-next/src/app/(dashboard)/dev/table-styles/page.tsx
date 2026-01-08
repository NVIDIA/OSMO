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

"use client";

import { usePage } from "@/components/shell";

/**
 * Table Styles Preview Page
 *
 * Full-page preview of the selected table style.
 */
export default function TableStylesPage() {
  usePage({ title: "Table Style Preview" });

  return (
    <div className="flex h-full flex-col">
      {/* Full-page table preview */}
      <div
        className="style-card flex flex-1 flex-col overflow-hidden rounded-md"
        style={
          {
            // Light mode: graphite header + white body
            "--light-bg": "#ffffff",
            "--light-border-top": "1px solid oklch(0.93 0 0)",
            "--light-border-left": "1px solid oklch(0.92 0 0)",
            "--light-border-right": "1px solid oklch(0.86 0 0)",
            "--light-border-bottom": "1px solid oklch(0.85 0 0)",
            "--header-light-bg": "#f0f0f0",
            // Dark mode: zinc-900 header + sidebar body (locked in)
            "--dark-bg": "#09090b",
            "--dark-border-top": "1px solid oklch(0.18 0 0)",
            "--dark-border-left": "1px solid oklch(0.17 0 0)",
            "--dark-border-right": "1px solid oklch(0.1 0 0)",
            "--dark-border-bottom": "1px solid oklch(0.09 0 0)",
            "--header-dark-bg": "#18181b",
          } as React.CSSProperties
        }
      >
        {/* Table header with sharp shadow */}
        <div className="style-card-header relative z-10 shrink-0 px-6 py-3 shadow-[0_1px_2px_rgba(0,0,0,0.15)] dark:shadow-[0_1px_2px_rgba(0,0,0,0.5)]">
          <div className="flex items-center gap-8">
            <div className="h-3 w-32 rounded bg-zinc-300/80 dark:bg-zinc-600" />
            <div className="h-3 w-24 rounded bg-zinc-300/80 dark:bg-zinc-600" />
            <div className="h-3 w-40 rounded bg-zinc-300/80 dark:bg-zinc-600" />
            <div className="h-3 w-28 rounded bg-zinc-300/80 dark:bg-zinc-600" />
            <div className="h-3 w-20 rounded bg-zinc-300/80 dark:bg-zinc-600" />
            <div className="h-3 w-16 rounded bg-zinc-300/80 dark:bg-zinc-600" />
          </div>
        </div>

        {/* Table rows */}
        <div className="flex-1 overflow-auto">
          {Array.from({ length: 20 }, (_, i) => (
            <div
              key={i}
              className="flex items-center gap-8 border-b border-zinc-200/50 px-6 py-4 last:border-b-0 dark:border-zinc-800/50"
            >
              <div className="h-4 w-32 rounded bg-zinc-200/80 dark:bg-zinc-800" />
              <div className="h-4 w-24 rounded bg-zinc-200/60 dark:bg-zinc-800/80" />
              <div className="h-4 w-40 rounded bg-zinc-200/60 dark:bg-zinc-800/80" />
              <div className="h-4 w-28 rounded bg-zinc-200/60 dark:bg-zinc-800/80" />
              <div className="h-4 w-20 rounded bg-zinc-200/60 dark:bg-zinc-800/80" />
              <div className="h-4 w-16 rounded bg-zinc-200/60 dark:bg-zinc-800/80" />
            </div>
          ))}
        </div>

        <style jsx>{`
          .style-card {
            background: var(--light-bg);
            border-top: var(--light-border-top);
            border-left: var(--light-border-left);
            border-right: var(--light-border-right);
            border-bottom: var(--light-border-bottom);
          }
          .style-card-header {
            background: var(--header-light-bg);
          }
          :global(.dark) .style-card {
            background: var(--dark-bg);
            border-top: var(--dark-border-top);
            border-left: var(--dark-border-left);
            border-right: var(--dark-border-right);
            border-bottom: var(--dark-border-bottom);
          }
          :global(.dark) .style-card-header {
            background: var(--header-dark-bg);
          }
        `}</style>
      </div>
    </div>
  );
}
