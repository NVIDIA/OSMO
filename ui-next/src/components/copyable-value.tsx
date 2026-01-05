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
 * Copyable Value Components
 *
 * Click-to-copy components for displaying values that users may want to copy.
 * Shows copy icon on hover and checkmark on successful copy.
 */

"use client";

import { useState, useCallback } from "react";
import { Check, Copy } from "lucide-react";
import { cn } from "@/lib/utils";

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
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      console.warn("Clipboard API not available");
    }
  }, [value]);

  return (
    <button
      type="button"
      onClick={handleCopy}
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
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
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
