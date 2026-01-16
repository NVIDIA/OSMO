// Copyright (c) 2026, NVIDIA CORPORATION. All rights reserved.
//
// NVIDIA CORPORATION and its licensors retain all intellectual property
// and proprietary rights in and to this software, related documentation
// and any modifications thereto. Any use, reproduction, disclosure or
// distribution of this software and related documentation without an express
// license agreement from NVIDIA CORPORATION is strictly prohibited.

/**
 * ShellDisconnectedOverlay Component
 *
 * Inline overlay shown when shell is disconnected or has an error.
 * Displays status and reconnect button within the terminal area.
 */

"use client";

import { memo } from "react";
import { AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/shadcn/button";

// =============================================================================
// Types
// =============================================================================

export interface ShellDisconnectedOverlayProps {
  /** Whether this is an error state */
  isError?: boolean;
  /** Error message to display */
  errorMessage?: string | null;
  /** Called when user clicks reconnect */
  onReconnect: () => void;
  /** Additional className */
  className?: string;
}

// =============================================================================
// Component
// =============================================================================

export const ShellDisconnectedOverlay = memo(function ShellDisconnectedOverlay({
  isError = false,
  errorMessage,
  onReconnect,
  className,
}: ShellDisconnectedOverlayProps) {
  return (
    <div className={cn("shell-disconnected-overlay", className)}>
      <div className="shell-disconnected-divider" />

      <div className="shell-disconnected-content">
        {/* Status Icon & Message */}
        <div className="shell-disconnected-status">
          {isError ? (
            <>
              <AlertCircle className="size-4 text-red-400" />
              <span className="shell-disconnected-label shell-disconnected-label--error">Connection lost</span>
            </>
          ) : (
            <>
              <span className="shell-disconnected-dot" />
              <span className="shell-disconnected-label">Session ended</span>
            </>
          )}
        </div>

        {/* Error message if present */}
        {isError && errorMessage && <div className="shell-disconnected-error">{errorMessage}</div>}

        {/* Reconnect Button */}
        <Button
          variant="outline"
          size="sm"
          onClick={onReconnect}
          className="mt-3 border-zinc-700 bg-zinc-800/50 text-zinc-200 hover:bg-zinc-700 hover:text-zinc-100"
        >
          Reconnect
        </Button>
      </div>
    </div>
  );
});
