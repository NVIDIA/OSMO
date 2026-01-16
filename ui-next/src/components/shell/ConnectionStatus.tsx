// Copyright (c) 2026, NVIDIA CORPORATION. All rights reserved.
//
// NVIDIA CORPORATION and its licensors retain all intellectual property
// and proprietary rights in and to this software, related documentation
// and any modifications thereto. Any use, reproduction, disclosure or
// distribution of this software and related documentation without an express
// license agreement from NVIDIA CORPORATION is strictly prohibited.

/**
 * ConnectionStatus Component
 *
 * Visual indicator for shell connection state.
 * Shows a colored dot with optional label text.
 */

"use client";

import { memo } from "react";
import { cn } from "@/lib/utils";
import type { ConnectionStatusProps, ConnectionStatus as ConnectionStatusType } from "./types";

// =============================================================================
// Status Labels
// =============================================================================

const STATUS_LABELS: Record<ConnectionStatusType, string> = {
  idle: "Idle",
  connecting: "Connecting",
  connected: "Connected",
  disconnected: "Disconnected",
  error: "Error",
};

// =============================================================================
// Component
// =============================================================================

export const ConnectionStatus = memo(function ConnectionStatus({
  status,
  size = "sm",
  showLabel = true,
  className,
}: ConnectionStatusProps) {
  const dotSize = size === "sm" ? "size-2" : "size-2.5";

  return (
    <div className={cn("shell-status-dot", className)}>
      <span
        className={cn("shell-status-dot-icon", dotSize, "rounded-full")}
        data-status={status}
        aria-hidden="true"
      />
      {showLabel && <span className="shell-status-dot-label">{STATUS_LABELS[status]}</span>}
    </div>
  );
});
