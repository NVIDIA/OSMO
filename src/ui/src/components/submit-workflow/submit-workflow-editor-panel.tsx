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
import dynamic from "next/dynamic";
import { YAML_LANGUAGE } from "@/components/code-viewer/lib/languages";
import { CodeViewerSkeleton } from "@/components/code-viewer/code-viewer-skeleton";

const CodeMirror = dynamic(
  () => import("@/components/code-viewer/code-mirror").then((m) => ({ default: m.CodeMirror })),
  { ssr: false, loading: () => <CodeViewerSkeleton className="absolute inset-0" /> },
);

export interface SubmitWorkflowEditorPanelProps {
  value: string;
  onChange: (value: string) => void;
}

export const SubmitWorkflowEditorPanel = memo(function SubmitWorkflowEditorPanel({
  value,
  onChange,
}: SubmitWorkflowEditorPanelProps) {
  return (
    <div className="flex min-w-0 flex-1 flex-col bg-zinc-50 dark:bg-[#0b0b0d]">
      {/* Editor — fills full height */}
      <div className="relative min-h-0 flex-1">
        <CodeMirror
          value={value}
          onChange={onChange}
          language={YAML_LANGUAGE}
          aria-label="YAML workflow specification editor"
          className="absolute inset-0"
        />
      </div>
    </div>
  );
});
