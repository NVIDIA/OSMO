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
import { FileCode } from "lucide-react";

export interface SubmitWorkflowTemplateVarsProps {
  varNames: string[];
  varDefaults: Record<string, string>;
}

export const SubmitWorkflowTemplateVars = memo(function SubmitWorkflowTemplateVars({
  varNames,
  varDefaults,
}: SubmitWorkflowTemplateVarsProps) {
  if (varNames.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-zinc-200 py-8 text-center dark:border-zinc-700">
        <FileCode className="size-5 text-zinc-400 dark:text-zinc-500" />
        <p className="font-mono text-xs text-zinc-400 dark:text-zinc-500">No template variables detected in spec</p>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-lg border border-zinc-200 dark:border-zinc-700/60">
      <div className="grid grid-cols-2 gap-0 border-b border-zinc-200 bg-zinc-50 px-4 py-2 dark:border-zinc-700/60 dark:bg-zinc-800/40">
        <span className="font-mono text-[10px] font-semibold tracking-widest text-zinc-400 uppercase dark:text-zinc-500">
          Variable
        </span>
        <span className="font-mono text-[10px] font-semibold tracking-widest text-zinc-400 uppercase dark:text-zinc-500">
          Default
        </span>
      </div>
      <div className="divide-y divide-zinc-200 dark:divide-zinc-700/60">
        {varNames.map((name) => {
          const value = varDefaults[name];
          return (
            <div
              key={name}
              className="grid grid-cols-2 items-center gap-0"
            >
              <div className="flex h-9 items-center border-r border-zinc-200 px-4 dark:border-zinc-700/60">
                <span className="truncate font-mono text-[11.5px] text-sky-600 dark:text-sky-400">{`{{ ${name} }}`}</span>
              </div>
              <div className="flex h-9 items-center px-4">
                {value !== undefined && value !== "" ? (
                  <span className="truncate font-mono text-[11.5px] text-zinc-700 dark:text-zinc-300">{value}</span>
                ) : (
                  <span className="font-mono text-[11.5px] text-zinc-400 dark:text-zinc-600">—</span>
                )}
              </div>
            </div>
          );
        })}
      </div>
      <p className="border-t border-zinc-200 px-4 py-2 text-[10px] text-zinc-400 dark:border-zinc-700/60 dark:text-zinc-600">
        Edit values in the spec directly
      </p>
    </div>
  );
});
