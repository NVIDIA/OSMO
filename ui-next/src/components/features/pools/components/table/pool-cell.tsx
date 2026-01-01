/**
 * Copyright (c) 2025, NVIDIA CORPORATION. All rights reserved.
 *
 * NVIDIA CORPORATION and its licensors retain all intellectual property
 * and proprietary rights in and to this software, related documentation
 * and any modifications thereto. Any use, reproduction, disclosure or
 * distribution of this software and related documentation without an express
 * license agreement from NVIDIA CORPORATION is strictly prohibited.
 */

"use client";

import type { Pool } from "@/lib/api/adapter";
import type { PoolColumnId } from "../../lib";
import { GpuProgressCell, PlatformPills } from "../cells";

interface PoolCellProps {
  pool: Pool;
  columnId: PoolColumnId;
  displayMode: "used" | "free";
  compact: boolean;
  isShared: boolean;
  onFilterBySharedPools?: () => void;
}

export function PoolCell({ pool, columnId, displayMode, compact, isShared, onFilterBySharedPools }: PoolCellProps) {
  switch (columnId) {
    case "name":
      return (
        <span className="truncate font-medium text-zinc-900 dark:text-zinc-100">
          {pool.name}
        </span>
      );
    case "description":
      return (
        <span className="truncate text-zinc-500 dark:text-zinc-400">
          {pool.description || "—"}
        </span>
      );
    case "quota":
      return (
        <GpuProgressCell
          quota={pool.quota}
          type="quota"
          displayMode={displayMode}
          compact={compact}
        />
      );
    case "capacity":
      return (
        <GpuProgressCell
          quota={pool.quota}
          type="capacity"
          displayMode={displayMode}
          compact={compact}
          isShared={isShared}
          onFilterBySharedPools={onFilterBySharedPools}
        />
      );
    case "platforms":
      return <PlatformPills platforms={pool.platforms} />;
    case "backend":
      return (
        <span className="font-mono text-xs text-zinc-500 dark:text-zinc-400">
          {pool.backend}
        </span>
      );
    default:
      return <span>—</span>;
  }
}
