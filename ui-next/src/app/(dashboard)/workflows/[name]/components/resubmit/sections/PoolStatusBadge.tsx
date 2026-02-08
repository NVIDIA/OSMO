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
 * PoolStatusBadge - Renders a colored status badge with icon and label.
 *
 * Shared between PoolSection and PoolSelect to eliminate duplication of
 * the status display logic (icon lookup, style mapping, JSX structure).
 */

import { memo } from "react";
import { CheckCircle2, Wrench, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { getStatusDisplay, STATUS_STYLES, type StatusCategory } from "@/app/(dashboard)/pools/lib/constants";

/** Status icons mapping (matches pools table) */
const STATUS_ICONS: Record<StatusCategory, React.ComponentType<{ className?: string }>> = {
  online: CheckCircle2,
  maintenance: Wrench,
  offline: XCircle,
};

export interface PoolStatusBadgeProps {
  /** Pool status string (e.g., from PoolStatus enum) */
  status: string;
  /** Additional class name for the outer span */
  className?: string;
}

export const PoolStatusBadge = memo(function PoolStatusBadge({ status, className }: PoolStatusBadgeProps) {
  const { category, label } = getStatusDisplay(status);
  const styles = STATUS_STYLES[category]?.badge;
  const Icon = STATUS_ICONS[category];

  if (!styles) return null;

  return (
    <span className={cn("inline-flex shrink-0 items-center gap-1 rounded px-2 py-0.5", styles.bg, className)}>
      <Icon className={cn("size-3.5", styles.icon)} />
      <span className={cn("text-xs font-semibold", styles.text)}>{label}</span>
    </span>
  );
});
