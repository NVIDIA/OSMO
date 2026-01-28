// Copyright (c) 2026, NVIDIA CORPORATION. All rights reserved.
//
// NVIDIA CORPORATION and its licensors retain all intellectual property
// and proprietary rights in and to this software, related documentation
// and any modifications thereto. Any use, reproduction, disclosure or
// distribution of this software and related documentation without an express
// license agreement from NVIDIA CORPORATION is strictly prohibited.

import { memo } from "react";
import { cn } from "@/lib/utils";
import type { ConnectionStatus } from "../lib/types";

export const STATUS_DOT_STYLES: Record<ConnectionStatus, string> = {
  idle: "bg-zinc-500",
  connecting: "bg-amber-400 animate-pulse",
  opening: "bg-amber-400 animate-pulse",
  initializing: "bg-amber-400 animate-pulse",
  ready: "bg-emerald-400",
  disconnected: "border border-red-400 bg-transparent",
  error: "bg-red-400",
};

export const STATUS_LABELS: Record<ConnectionStatus, string> = {
  idle: "Idle",
  connecting: "Connecting...",
  opening: "Opening...",
  initializing: "Initializing...",
  ready: "Connected",
  disconnected: "Disconnected",
  error: "Error",
};

export interface StatusDotProps {
  status: ConnectionStatus;
  className?: string;
}

/** Colored dot indicating connection status. Default size: 8px. */
export const StatusDot = memo(function StatusDot({ status, className }: StatusDotProps) {
  return (
    <span
      className={cn("size-2 shrink-0 rounded-full", STATUS_DOT_STYLES[status], className)}
      aria-hidden="true"
    />
  );
});
