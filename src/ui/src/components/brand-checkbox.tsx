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

"use client";

import { Check } from "lucide-react";
import { memo } from "react";
import { cn } from "@/lib/utils";

interface BrandCheckboxProps {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  ariaLabel?: string;
  "aria-label"?: string;
  className?: string;
  disabled?: boolean;
  id?: string;
}

export const BrandCheckbox = memo(function BrandCheckbox({
  checked,
  onCheckedChange,
  ariaLabel,
  "aria-label": ariaLabelAttribute,
  className,
  disabled = false,
  id,
}: BrandCheckboxProps) {
  return (
    <span className={cn("relative inline-flex size-4 items-center justify-center", className)}>
      <input
        id={id}
        type="checkbox"
        aria-label={ariaLabel ?? ariaLabelAttribute}
        checked={checked}
        disabled={disabled}
        onClick={(event) => event.stopPropagation()}
        onChange={(event) => onCheckedChange(event.target.checked)}
        className="peer absolute inset-0 z-10 m-0 size-4 cursor-pointer accent-[var(--nvidia-green)] opacity-0 disabled:cursor-not-allowed"
      />
      <span
        aria-hidden="true"
        className={cn(
          "pointer-events-none flex size-4 items-center justify-center rounded border bg-white transition-colors",
          "peer-focus-visible:ring-2 peer-focus-visible:ring-[var(--nvidia-green)]/25",
          checked
            ? "border-[var(--nvidia-green)] bg-[var(--nvidia-green)] text-white"
            : "border-zinc-300 dark:border-zinc-600 dark:bg-zinc-950",
          disabled && "opacity-50",
        )}
      >
        {checked && <Check className="size-3 stroke-[3]" />}
      </span>
    </span>
  );
});
