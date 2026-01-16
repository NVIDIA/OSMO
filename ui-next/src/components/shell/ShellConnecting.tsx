// Copyright (c) 2026, NVIDIA CORPORATION. All rights reserved.
//
// NVIDIA CORPORATION and its licensors retain all intellectual property
// and proprietary rights in and to this software, related documentation
// and any modifications thereto. Any use, reproduction, disclosure or
// distribution of this software and related documentation without an express
// license agreement from NVIDIA CORPORATION is strictly prohibited.

/**
 * ShellConnecting Component
 *
 * Connecting state overlay with spinner.
 * Shown while establishing WebSocket connection.
 */

"use client";

import { memo } from "react";
import { cn } from "@/lib/utils";

// =============================================================================
// Types
// =============================================================================

export interface ShellConnectingProps {
  /** Additional className */
  className?: string;
}

// =============================================================================
// Component
// =============================================================================

export const ShellConnecting = memo(function ShellConnecting({ className }: ShellConnectingProps) {
  return (
    <div className={cn("shell-connecting", className)}>
      <div className="shell-connecting-content">
        <span className="shell-connecting-dot" />
        <span className="shell-connecting-label">Connecting...</span>
      </div>
    </div>
  );
});
