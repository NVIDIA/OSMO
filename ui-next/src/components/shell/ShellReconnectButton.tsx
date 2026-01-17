// Copyright (c) 2026, NVIDIA CORPORATION. All rights reserved.
//
// NVIDIA CORPORATION and its licensors retain all intellectual property
// and proprietary rights in and to this software, related documentation
// and any modifications thereto. Any use, reproduction, disclosure or
// distribution of this software and related documentation without an express
// license agreement from NVIDIA CORPORATION is strictly prohibited.

/**
 * ShellReconnectButton Component
 *
 * Floating reconnect button shown at bottom of terminal when disconnected.
 * The disconnect message is written inline to the terminal buffer.
 */

"use client";

import { memo } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/shadcn/button";

// =============================================================================
// Types
// =============================================================================

export interface ShellReconnectButtonProps {
  /** Called when user clicks reconnect */
  onReconnect: () => void;
  /** Additional className */
  className?: string;
}

// =============================================================================
// Component
// =============================================================================

export const ShellReconnectButton = memo(function ShellReconnectButton({
  onReconnect,
  className,
}: ShellReconnectButtonProps) {
  return (
    <div className={cn("shell-reconnect-button", className)}>
      <Button
        variant="outline"
        size="sm"
        onClick={onReconnect}
        className="border-zinc-600 bg-zinc-800 text-zinc-200 shadow-lg hover:bg-zinc-700 hover:text-zinc-100"
      >
        Reconnect
      </Button>
    </div>
  );
});
