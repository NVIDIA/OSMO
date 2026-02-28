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

import { useEffect } from "react";
import dynamic from "next/dynamic";
import { useSubmitWorkflowStore } from "@/stores/submit-workflow-store";

// Code-split the feature content — only loaded when the overlay first opens.
// Uses a dynamic import so the heavy YAML editor and form state are not
// bundled into the main chunk.
const SubmitWorkflowContent = dynamic(
  () =>
    import("@/components/submit-workflow/submit-workflow-content").then((m) => ({
      default: m.SubmitWorkflowContent,
    })),
  { ssr: false },
);

export function SubmitWorkflowOverlay() {
  const { isOpen, close } = useSubmitWorkflowStore();

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, close]);

  if (!isOpen) return null;

  return (
    <div
      className="absolute inset-0 z-10 overflow-hidden"
      role="dialog"
      aria-modal="true"
      aria-label="Submit workflow"
    >
      <SubmitWorkflowContent />
    </div>
  );
}
