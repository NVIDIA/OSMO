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
