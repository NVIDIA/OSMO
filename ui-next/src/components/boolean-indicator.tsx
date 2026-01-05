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
 * Boolean Indicator Component
 *
 * Visual indicator for boolean values, showing a checkmark or X icon
 * with appropriate colors and labels.
 */

import { Check, Ban } from "lucide-react";
import { cn } from "@/lib/utils";

// =============================================================================
// Types
// =============================================================================

export interface BooleanIndicatorProps {
  /** The boolean value to display */
  value: boolean;
  /** Label for true state (default: "Allowed") */
  trueLabel?: string;
  /** Label for false state (default: "Not allowed") */
  falseLabel?: string;
  /** Additional CSS classes */
  className?: string;
}

// =============================================================================
// Component
// =============================================================================

/**
 * BooleanIndicator - Shows ✓ or ✗ with label.
 *
 * @example
 * ```tsx
 * <BooleanIndicator value={true} />                    // ✓ Allowed
 * <BooleanIndicator value={false} />                   // ✗ Not allowed
 * <BooleanIndicator
 *   value={isEnabled}
 *   trueLabel="Enabled"
 *   falseLabel="Disabled"
 * />
 * ```
 */
export function BooleanIndicator({
  value,
  trueLabel = "Allowed",
  falseLabel = "Not allowed",
  className,
}: BooleanIndicatorProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 text-sm",
        value ? "text-emerald-600 dark:text-emerald-400" : "text-zinc-400 dark:text-zinc-500",
        className,
      )}
    >
      {value ? <Check className="h-3.5 w-3.5" /> : <Ban className="h-3.5 w-3.5" />}
      {value ? trueLabel : falseLabel}
    </span>
  );
}
