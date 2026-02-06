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
 * Copyable Value Components
 *
 * Click-to-copy components for displaying values that users may want to copy.
 * Shows copy icon on hover and checkmark on successful copy.
 */

"use client";

import { memo } from "react";
import { Check, Copy } from "lucide-react";
import { cn } from "@/lib/utils";
import { useCopy } from "@/hooks/use-copy";

// =============================================================================
// CopyButton - Standalone copy button
// =============================================================================

export interface CopyButtonProps {
  /** The value to copy */
  value: string;
  /** Accessible label for the button */
  label: string;
  /** Additional CSS classes */
  className?: string;
}

/**
 * Standalone copy button with checkmark feedback.
 * Used in DetailsSection and other places that need a copy icon.
 *
 * @example
 * ```tsx
 * <CopyButton value={uuid} label="UUID" />
 * ```
 */
export const CopyButton = memo(function CopyButton({ value, label, className }: CopyButtonProps) {
  const { copied, copy } = useCopy();

  return (
    <button
      onClick={() => copy(value)}
      className={cn(
        "text-muted-foreground hover:bg-accent hover:text-foreground ml-1.5 shrink-0 rounded p-0.5 transition-colors",
        className,
      )}
      aria-label={`Copy ${label}`}
      title={copied ? "Copied!" : `Copy ${label}`}
    >
      {copied ? <Check className="size-3 text-emerald-500" /> : <Copy className="size-3" />}
    </button>
  );
});

// =============================================================================
// CopyableValue - Inline copyable text
// =============================================================================

export interface CopyableValueProps {
  /** The value to display and copy */
  value: string;
  /** Additional CSS classes */
  className?: string;
}

/**
 * Inline copyable value with hover-to-reveal copy button.
 *
 * @example
 * ```tsx
 * <CopyableValue value="gpu-worker-01.cluster.local" />
 * ```
 */
export function CopyableValue({ value, className }: CopyableValueProps) {
  const { copied, copy } = useCopy({ resetDelay: 1500 });

  return (
    <button
      type="button"
      onClick={() => copy(value)}
      className={cn(
        "group inline-flex items-center gap-2 rounded-md px-2.5 py-1.5 font-mono text-sm transition-colors",
        copied
          ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-300"
          : "bg-zinc-100 text-zinc-700 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700",
        className,
      )}
      title={copied ? "Copied!" : `Copy ${value}`}
    >
      <span>{value}</span>
      {copied ? (
        <Check className="size-3.5 shrink-0" />
      ) : (
        <Copy className="size-3.5 shrink-0 opacity-0 transition-opacity group-hover:opacity-100" />
      )}
    </button>
  );
}

// =============================================================================
// CopyableBlock - Multi-line or path copyable block
// =============================================================================

export interface CopyableBlockProps {
  /** The value to display and copy */
  value: string;
  /** Additional CSS classes */
  className?: string;
}

/**
 * Block-level copyable value for paths, mounts, or longer text.
 * Full width with break-all for long paths.
 *
 * @example
 * ```tsx
 * <CopyableBlock value="/mnt/shared/datasets:/data:ro" />
 * ```
 */
export function CopyableBlock({ value, className }: CopyableBlockProps) {
  const { copied, copy } = useCopy({ resetDelay: 1500 });

  return (
    <button
      type="button"
      onClick={() => copy(value)}
      className={cn(
        "group flex w-full items-start justify-between gap-2 rounded-md px-2.5 py-1.5 text-left font-mono text-xs transition-colors",
        copied
          ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-300"
          : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-700",
        className,
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
