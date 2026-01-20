//SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION. All rights reserved.

//Licensed under the Apache License, Version 2.0 (the "License");
//you may not use this file except in compliance with the License.
//You may obtain a copy of the License at

//http://www.apache.org/licenses/LICENSE-2.0

//Unless required by applicable law or agreed to in writing, software
//distributed under the License is distributed on an "AS IS" BASIS,
//WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
//See the License for the specific language governing permissions and
//limitations under the License.

//SPDX-License-Identifier: Apache-2.0

import { memo } from "react";
import { cn } from "@/lib/utils";
import { formatDateShort } from "@/lib/format-date";

// =============================================================================
// Types
// =============================================================================

export interface DateSeparatorProps {
  /** The date to display */
  date: Date;
  /** Additional CSS classes */
  className?: string;
}

// =============================================================================
// Component
// =============================================================================

/**
 * A subtle date separator row that can optionally stick to the top of the scroll container.
 * Used to provide date context in log lists without cluttering individual rows.
 */
function DateSeparatorInner({ date, className }: DateSeparatorProps) {
  const formattedDate = formatDateShort(date);

  return (
    <div
      className={cn("flex items-center gap-2 px-3 py-1", className)}
      role="separator"
      aria-label={`Logs from ${formattedDate}`}
    >
      {/* Left dashed line - subtle */}
      <div
        className="h-px flex-1"
        style={{
          backgroundImage: "linear-gradient(to right, transparent 50%, var(--border) 50%)",
          backgroundSize: "6px 1px",
          opacity: 0.4,
        }}
      />

      {/* Date label - subtle and muted */}
      <span className="text-muted-foreground/50 shrink-0 text-[10px] tracking-wider uppercase">{formattedDate}</span>

      {/* Right dashed line - subtle */}
      <div
        className="h-px flex-1"
        style={{
          backgroundImage: "linear-gradient(to right, transparent 50%, var(--border) 50%)",
          backgroundSize: "6px 1px",
          opacity: 0.4,
        }}
      />
    </div>
  );
}

export const DateSeparator = memo(DateSeparatorInner);
