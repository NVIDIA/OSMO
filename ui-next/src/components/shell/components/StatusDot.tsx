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
import type { ConnectionStatus } from "@/components/shell/lib/types";

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
