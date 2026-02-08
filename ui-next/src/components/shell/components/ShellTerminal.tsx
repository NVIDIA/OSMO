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

"use client";

import dynamic from "next/dynamic";
import { forwardRef, memo } from "react";
import { cn } from "@/lib/utils";
import type { ShellTerminalProps, ShellTerminalRef } from "@/components/shell/lib/types";

const ShellLoadingSkeleton = memo(function ShellLoadingSkeleton({ className }: { className?: string }) {
  return (
    <div className={cn("flex h-full min-h-[200px] items-center justify-center", "bg-shell-bg", className)}>
      <div className="flex flex-col items-center gap-3">
        <div className="flex items-center gap-2">
          <span className="size-2 animate-pulse rounded-full bg-emerald-500" />
          <span className="text-sm text-zinc-400">Loading terminal...</span>
        </div>
      </div>
    </div>
  );
});

/** xterm.js (~480KB) lazy-loaded only when rendered */
const ShellTerminalImpl = dynamic(
  () => import("./ShellTerminalImpl").then((mod) => ({ default: mod.ShellTerminalImpl })),
  {
    ssr: false,
    loading: () => <ShellLoadingSkeleton />,
  },
);

export const ShellTerminal = forwardRef<ShellTerminalRef, ShellTerminalProps>(function ShellTerminal(props, ref) {
  return (
    <ShellTerminalImpl
      {...props}
      ref={ref}
    />
  );
});
