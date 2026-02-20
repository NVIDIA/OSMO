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

/**
 * FilePreviewPanel — Slideout preview panel for a dataset file.
 *
 * Performs a HEAD preflight to check content-type and access before rendering:
 * - image/* → <img>
 * - video/* → <video controls>
 * - text/*, application/json → <iframe sandbox>
 * - 401/403 → "public bucket required" error
 * - 404 → "file not found" error
 * - No URL → metadata-only view
 */

"use client";

import { useCallback, memo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Copy, AlertCircle, RefreshCw } from "lucide-react";
import { PanelHeader, PanelTitle } from "@/components/panel/panel-header";
import { PanelHeaderActions } from "@/components/panel/panel-header-controls";
import { Button } from "@/components/shadcn/button";
import { Skeleton } from "@/components/shadcn/skeleton";
import { formatBytes } from "@/lib/utils";
import { formatDateTimeFull } from "@/lib/format-date";
import { useServices } from "@/contexts/service-context";
import type { DatasetFile } from "@/lib/api/adapter/datasets";

// =============================================================================
// Types
// =============================================================================

interface FilePreviewPanelProps {
  file: DatasetFile;
  /** Current directory path (empty = root) */
  path: string;
  onClose: () => void;
}

interface HeadResult {
  status: number;
  contentType: string;
}

// =============================================================================
// HEAD preflight fetch
// =============================================================================

async function fetchHeadResult(url: string): Promise<HeadResult> {
  const response = await fetch(url, { method: "HEAD" });
  const contentType = response.headers.get("Content-Type") ?? "";
  return { status: response.status, contentType };
}

// =============================================================================
// Sub-components
// =============================================================================

function MetadataRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-2 text-xs">
      <span className="w-20 shrink-0 text-zinc-500 dark:text-zinc-400">{label}</span>
      <span className="min-w-0 font-mono break-all text-zinc-700 dark:text-zinc-300">{value}</span>
    </div>
  );
}

function PreviewError({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 p-8 text-center">
      <AlertCircle
        className="size-8 text-zinc-400"
        aria-hidden="true"
      />
      <p className="max-w-xs text-sm text-zinc-600 dark:text-zinc-400">{message}</p>
      {onRetry && (
        <Button
          variant="outline"
          size="sm"
          onClick={onRetry}
          className="gap-1.5"
        >
          <RefreshCw
            className="size-3.5"
            aria-hidden="true"
          />
          Retry
        </Button>
      )}
    </div>
  );
}

function PreviewContent({ url, contentType }: { url: string; contentType: string }) {
  if (contentType.startsWith("image/")) {
    return (
      <div className="flex flex-1 items-center justify-center overflow-auto p-4">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={url}
          alt="File preview"
          className="max-h-full max-w-full rounded object-contain"
        />
      </div>
    );
  }

  if (contentType.startsWith("video/")) {
    return (
      <div className="flex flex-1 items-center justify-center overflow-auto p-4">
        <video
          src={url}
          controls
          className="max-h-full max-w-full rounded"
        />
      </div>
    );
  }

  if (contentType.startsWith("text/") || contentType.includes("json") || contentType.includes("xml")) {
    return (
      <iframe
        src={url}
        sandbox=""
        className="flex-1 border-0"
        title="File preview"
      />
    );
  }

  // Binary / unsupported content type — no visual preview
  return (
    <div className="flex flex-col items-center justify-center gap-2 p-8 text-center">
      <p className="text-sm text-zinc-500 dark:text-zinc-400">Preview unavailable for this file type.</p>
      <p className="text-xs text-zinc-400 dark:text-zinc-600">Copy the path to access the file directly.</p>
    </div>
  );
}

// =============================================================================
// Main component
// =============================================================================

export const FilePreviewPanel = memo(function FilePreviewPanel({ file, path, onClose }: FilePreviewPanelProps) {
  const { clipboard } = useServices();
  const fullPath = path ? `${path}/${file.name}` : file.name;

  const handleCopyPath = useCallback(() => {
    void clipboard.copy(fullPath);
  }, [clipboard, fullPath]);

  // HEAD preflight — only when we have a URL to check
  const {
    data: head,
    isLoading: headLoading,
    error: headError,
    refetch,
  } = useQuery({
    queryKey: ["file-preview-head", file.url],
    queryFn: () => fetchHeadResult(file.url!),
    enabled: !!file.url,
    staleTime: Infinity,
    retry: false,
  });

  // Derive preview state
  const showPreview = !!file.url;
  const accessDenied = head && (head.status === 401 || head.status === 403);
  const notFound = head && head.status === 404;
  const previewReady = head && head.status === 200;

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Sticky header */}
      <PanelHeader
        title={<PanelTitle>{file.name}</PanelTitle>}
        actions={
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="sm"
              className="h-7 gap-1.5 px-2 text-xs"
              onClick={handleCopyPath}
              aria-label={`Copy path: ${fullPath}`}
            >
              <Copy
                className="size-3.5"
                aria-hidden="true"
              />
              Copy path
            </Button>
            <PanelHeaderActions
              badge="File"
              onClose={onClose}
            />
          </div>
        }
      />

      {/* Preview area */}
      <div className="flex min-h-0 flex-1 flex-col">
        {showPreview && headLoading && (
          <div className="flex flex-1 items-center justify-center p-8">
            <Skeleton className="h-40 w-full" />
          </div>
        )}

        {showPreview && headError && (
          <PreviewError
            message="Could not reach the file. Check your network connection."
            onRetry={() => void refetch()}
          />
        )}

        {showPreview && accessDenied && (
          <PreviewError message="Only files in public buckets can be previewed. Contact your administrator to make this bucket public." />
        )}

        {showPreview && notFound && <PreviewError message="File not found at this path." />}

        {showPreview && previewReady && (
          <PreviewContent
            url={file.url!}
            contentType={head.contentType}
          />
        )}

        {!showPreview && (
          <div className="flex flex-col items-center justify-center gap-2 p-8 text-center">
            <p className="text-sm text-zinc-500 dark:text-zinc-400">No preview URL available for this file.</p>
            <p className="text-xs text-zinc-400 dark:text-zinc-600">Copy the path to access it directly.</p>
          </div>
        )}
      </div>

      {/* Metadata footer */}
      {(file.size !== undefined || file.modified || file.checksum) && (
        <div className="shrink-0 space-y-1.5 border-t border-zinc-200 p-4 dark:border-zinc-800">
          {file.size !== undefined && (
            <MetadataRow
              label="Size"
              value={formatBytes(file.size / 1024 ** 3).display}
            />
          )}
          {file.modified && (
            <MetadataRow
              label="Modified"
              value={formatDateTimeFull(file.modified)}
            />
          )}
          {file.checksum && (
            <MetadataRow
              label="Checksum"
              value={file.checksum}
            />
          )}
        </div>
      )}
    </div>
  );
});
