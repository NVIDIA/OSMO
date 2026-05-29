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

import { memo } from "react";
import { Button } from "@/components/shadcn/button";

interface BulkCancelSelectionBarProps {
  selectedCount: number;
  cancelableCount: number;
  skippedCount: number;
  onClear: () => void;
  onCancelSelected: () => void;
}

export const BulkCancelSelectionBar = memo(function BulkCancelSelectionBar({
  selectedCount,
  cancelableCount,
  skippedCount,
  onClear,
  onCancelSelected,
}: BulkCancelSelectionBarProps) {
  if (selectedCount === 0) return null;

  return (
    <div className="flex w-full flex-col gap-2 rounded-md border border-[var(--nvidia-green)]/35 bg-[var(--nvidia-green-bg)] px-3 py-1.5 shadow-xs sm:flex-row sm:items-center sm:justify-between dark:border-[var(--nvidia-green)]/40 dark:bg-[var(--nvidia-green-bg-dark)]">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-zinc-900 sm:gap-x-3 sm:text-sm dark:text-zinc-100">
        <strong>{selectedCount} selected</strong>
        <span>{cancelableCount} cancelable</span>
        {skippedCount > 0 && <span>{skippedCount} skipped: terminal state</span>}
      </div>
      <div className="flex shrink-0 items-center justify-end gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onClear}
        >
          Clear
        </Button>
        <Button
          type="button"
          variant="destructive"
          size="sm"
          onClick={onCancelSelected}
          disabled={cancelableCount === 0}
        >
          Cancel selected
        </Button>
      </div>
    </div>
  );
});
