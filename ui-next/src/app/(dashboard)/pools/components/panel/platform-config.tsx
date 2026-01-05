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

import { useState, useCallback } from "react";
import { Check, Ban, Copy } from "lucide-react";
import { cn } from "@/lib/utils";
import type { PlatformConfig } from "@/lib/api/adapter";

// =============================================================================
// Types
// =============================================================================

interface PlatformConfigContentProps {
  config: PlatformConfig;
}

// =============================================================================
// Main Component
// =============================================================================

/**
 * Platform Config Content - Displays platform configuration details.
 *
 * Shows:
 * - Description
 * - Boolean flags (host network, privileged mode)
 * - Default mounts
 * - Allowed mounts
 */
export function PlatformConfigContent({ config }: PlatformConfigContentProps) {
  return (
    <div className="space-y-3">
      {/* Description */}
      {config.description && <p className="text-sm text-zinc-600 dark:text-zinc-400">{config.description}</p>}

      {/* Boolean flags */}
      <div className="space-y-1">
        <div className="flex items-center justify-between py-1">
          <span className="text-sm text-zinc-600 dark:text-zinc-400">Host Network</span>
          <BooleanIndicator value={config.hostNetworkAllowed} />
        </div>
        <div className="flex items-center justify-between py-1">
          <span className="text-sm text-zinc-600 dark:text-zinc-400">Privileged Mode</span>
          <BooleanIndicator value={config.privilegedAllowed} />
        </div>
      </div>

      {/* Default Mounts */}
      {config.defaultMounts.length > 0 && (
        <MountsList
          title="Default Mounts"
          mounts={config.defaultMounts}
        />
      )}

      {/* Allowed Mounts */}
      {config.allowedMounts.length > 0 && (
        <MountsList
          title="Allowed Mounts"
          mounts={config.allowedMounts}
        />
      )}
    </div>
  );
}

// =============================================================================
// Helper Components
// =============================================================================

function BooleanIndicator({ value }: { value: boolean }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 text-sm",
        value ? "text-emerald-600 dark:text-emerald-400" : "text-zinc-400 dark:text-zinc-500",
      )}
    >
      {value ? <Check className="h-3.5 w-3.5" /> : <Ban className="h-3.5 w-3.5" />}
      {value ? "Allowed" : "Not allowed"}
    </span>
  );
}

function MountsList({ title, mounts }: { title: string; mounts: string[] }) {
  return (
    <div>
      <div className="mb-1.5 text-sm text-zinc-600 dark:text-zinc-400">{title}</div>
      <div className="flex flex-col gap-1">
        {mounts.map((mount, idx) => (
          <CopyableMount
            key={idx}
            value={mount}
          />
        ))}
      </div>
    </div>
  );
}

function CopyableMount({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Fallback for older browsers
      console.warn("Clipboard API not available");
    }
  }, [value]);

  return (
    <button
      type="button"
      onClick={handleCopy}
      className={cn(
        "group flex w-full items-start justify-between gap-2 rounded-md px-2.5 py-1.5 text-left font-mono text-xs transition-colors",
        copied
          ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-300"
          : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-700",
      )}
      title={copied ? "Copied!" : `Copy ${value}`}
    >
      <span className="break-all">{value}</span>
      {copied ? (
        <Check className="mt-0.5 size-3 shrink-0" />
      ) : (
        <Copy className="mt-0.5 size-3 shrink-0 opacity-0 transition-opacity group-hover:opacity-100" />
      )}
    </button>
  );
}
