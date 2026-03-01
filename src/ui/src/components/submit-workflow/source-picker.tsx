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

/**
 * SourcePicker - Pre-flow step shown before the YAML editor.
 *
 * Presents two options:
 *   1. Upload a YAML file — drag & drop or click, no persistent border
 *   2. Start with a blank editor — contained card below an "or" divider
 */

"use client";

import { useState, useRef } from "react";
import { Upload, FileText } from "lucide-react";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Default YAML skeleton
// ---------------------------------------------------------------------------

const DEFAULT_YAML = `name: my-workflow
tasks:
  - name: main
    image: nvcr.io/nvidia/pytorch:24.08-py3
    command:
      - /bin/bash
      - -c
      - "echo hello world"
    resources:
      cpu: 1
      memory: 4Gi
`;

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface SourcePickerProps {
  onSelect: (spec: string) => void;
}

export function SourcePicker({ onSelect }: SourcePickerProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDragOver, setIsDragOver] = useState(false);

  function readFile(file: File) {
    file
      .text()
      .then(onSelect)
      .catch(() => {
        if (fileInputRef.current) fileInputRef.current.value = "";
      });
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) readFile(file);
  }

  function handleDragOver(e: React.DragEvent) {
    e.preventDefault();
    setIsDragOver(true);
  }

  function handleDragLeave(e: React.DragEvent) {
    // Only clear if leaving the button itself, not a child
    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
      setIsDragOver(false);
    }
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setIsDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) readFile(file);
  }

  return (
    <div className="flex flex-1 flex-col items-center justify-center bg-white dark:bg-zinc-900">
      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".yaml,.yml"
        className="hidden"
        onChange={handleFileChange}
        aria-hidden="true"
        tabIndex={-1}
      />

      {/* Upload zone — no persistent border, embedded feel */}
      <button
        type="button"
        onClick={() => fileInputRef.current?.click()}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className={cn(
          "flex w-80 flex-col items-center gap-2 rounded-lg px-8 py-12 transition-colors",
          isDragOver
            ? "border-2 border-dashed border-zinc-300 bg-zinc-50 dark:border-zinc-600 dark:bg-zinc-800/60"
            : "hover:bg-zinc-50 dark:hover:bg-zinc-800/40",
        )}
      >
        <Upload
          className="mb-1 size-6 text-zinc-400 dark:text-zinc-500"
          aria-hidden="true"
        />
        <span className="text-sm font-medium text-zinc-700 dark:text-zinc-200">Drag & drop or click to upload</span>
        <span className="text-xs text-zinc-400 dark:text-zinc-500">.yaml or .yml</span>
      </button>

      {/* Or divider */}
      <div className="flex w-80 items-center gap-3 py-8">
        <div className="h-px flex-1 bg-zinc-200 dark:bg-zinc-700" />
        <span className="text-xs text-zinc-400 dark:text-zinc-500">or</span>
        <div className="h-px flex-1 bg-zinc-200 dark:bg-zinc-700" />
      </div>

      {/* Blank editor — explicit contained card */}
      <button
        type="button"
        onClick={() => onSelect(DEFAULT_YAML)}
        className="group flex w-80 items-center gap-4 rounded-lg border border-zinc-200 bg-zinc-50 p-4 text-left transition-colors hover:border-zinc-300 hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-800 dark:hover:border-zinc-600 dark:hover:bg-zinc-700/80"
      >
        <div className="flex size-9 shrink-0 items-center justify-center rounded-md border border-zinc-200 bg-white text-zinc-600 transition-colors group-hover:border-zinc-300 dark:border-zinc-600 dark:bg-zinc-700 dark:text-zinc-300 dark:group-hover:border-zinc-500">
          <FileText
            className="size-4"
            aria-hidden="true"
          />
        </div>
        <div>
          <div className="text-sm font-medium text-zinc-900 dark:text-zinc-100">Start with blank editor</div>
          <div className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">Basic workflow skeleton</div>
        </div>
      </button>
    </div>
  );
}
