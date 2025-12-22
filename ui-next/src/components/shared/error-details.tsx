// Copyright (c) 2025, NVIDIA CORPORATION. All rights reserved.
//
// NVIDIA CORPORATION and its licensors retain all intellectual property
// and proprietary rights in and to this software, related documentation
// and any modifications thereto. Any use, reproduction, disclosure or
// distribution of this software and related documentation without an express
// license agreement from NVIDIA CORPORATION is strictly prohibited.

"use client";

import { useState } from "react";
import { ChevronDown, Copy, Check } from "lucide-react";
import { cn } from "@/lib/utils";

interface ErrorDetailsProps {
  /** Error object */
  error: Error;
  /** Optional className for container */
  className?: string;
}

/**
 * Displays error message with collapsible stack trace.
 * 
 * Reusable component for consistent error detail display across
 * error.tsx files and inline error components.
 */
export function ErrorDetails({ error, className }: ErrorDetailsProps) {
  const [showStack, setShowStack] = useState(false);
  const [copied, setCopied] = useState(false);

  // Parse stack trace (remove the first line which is the error message)
  const stackLines = error.stack?.split("\n").slice(1).join("\n").trim();

  const copyToClipboard = async () => {
    const fullError = `${error.message}\n\n${stackLines || ""}`.trim();
    await navigator.clipboard.writeText(fullError);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (!error.message && !stackLines) return null;

  return (
    <div
      className={cn(
        "rounded-lg border border-zinc-200 bg-white dark:border-zinc-700 dark:bg-zinc-800",
        className
      )}
    >
      {/* Error message */}
      {error.message && (
        <div className="px-4 py-3">
          <p className="font-mono text-sm text-zinc-700 dark:text-zinc-300">
            {error.message}
          </p>
        </div>
      )}

      {/* Stack trace (collapsible) */}
      {stackLines && (
        <>
          <div
            className={cn(
              "flex items-center justify-between px-4 py-2",
              error.message && "border-t border-zinc-200 dark:border-zinc-700"
            )}
          >
            <button
              onClick={() => setShowStack(!showStack)}
              className="flex items-center gap-2 text-left text-xs text-zinc-500 transition-colors hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-300"
            >
              <ChevronDown
                className={cn(
                  "h-3 w-3 transition-transform",
                  showStack && "rotate-180"
                )}
              />
              Stack trace
            </button>
            <button
              onClick={copyToClipboard}
              className="flex items-center gap-1 text-xs text-zinc-400 transition-colors hover:text-zinc-600 dark:text-zinc-500 dark:hover:text-zinc-300"
              title="Copy error details"
            >
              {copied ? (
                <>
                  <Check className="h-3 w-3 text-green-500" />
                  <span className="text-green-500">Copied</span>
                </>
              ) : (
                <>
                  <Copy className="h-3 w-3" />
                  <span>Copy</span>
                </>
              )}
            </button>
          </div>
          {showStack && (
            <pre className="max-h-64 overflow-auto border-t border-zinc-200 px-4 py-3 font-mono text-xs text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">
              {stackLines}
            </pre>
          )}
        </>
      )}
    </div>
  );
}
