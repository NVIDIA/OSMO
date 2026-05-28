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
    <div className="flex shrink-0 items-center justify-between gap-3 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2.5 dark:border-blue-900/60 dark:bg-blue-950/30">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-blue-900 dark:text-blue-200">
        <strong>{selectedCount} selected</strong>
        <span>{cancelableCount} cancelable</span>
        {skippedCount > 0 && <span>{skippedCount} skipped: terminal state</span>}
      </div>
      <div className="flex shrink-0 items-center gap-2">
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
