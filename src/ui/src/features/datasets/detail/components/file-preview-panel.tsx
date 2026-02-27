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
 * FilePreviewPanel — Preview panel for a dataset file.
 *
 * Performs a HEAD preflight (via server proxy) to check content-type and access
 * before rendering. All file requests are routed through /api/datasets/file-proxy
 * to avoid CSP restrictions.
 *
 * - image/* → <img> via proxy
 * - video/* → <video controls> via proxy
 * - other  → "preview unavailable" message
 * - 401/403 → lock icon + "bucket must be public" error
 * - 404    → "file not found" error
 * - No URL → metadata-only view
 */

"use client";

import { useCallback, memo } from "react";
import Image from "next/image";
import { useQuery } from "@tanstack/react-query";
import { Copy, AlertCircle, RefreshCw, Lock } from "lucide-react";
import { PanelHeader, PanelTitle } from "@/components/panel/panel-header";
import { PanelHeaderActions } from "@/components/panel/panel-header-controls";
import { Button } from "@/components/shadcn/button";
import { Skeleton } from "@/components/shadcn/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/shadcn/tooltip";
import { formatBytes } from "@/lib/utils";
import { formatDateTimeFull } from "@/lib/format-date";
import { useCopy } from "@/hooks/use-copy";
import { getBasePathUrl } from "@/lib/config";
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

function toProxyUrl(url: string): string {
  return getBasePathUrl(`/api/datasets/file-proxy?url=${encodeURIComponent(url)}`);
}

async function fetchHeadResult(url: string): Promise<HeadResult> {
  const response = await fetch(toProxyUrl(url), { method: "HEAD" });
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

function PreviewError({
  message,
  icon = "alert",
  onRetry,
}: {
  message: string;
  icon?: "alert" | "lock";
  onRetry?: () => void;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 p-8 text-center">
      {icon === "lock" ? (
        <Lock
          className="size-8 text-zinc-400"
          aria-hidden="true"
        />
      ) : (
        <AlertCircle
          className="size-8 text-zinc-400"
          aria-hidden="true"
        />
      )}
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

async function fetchTextContent(url: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Failed to fetch: ${response.status}`);
  return response.text();
}

function TextPreview({ url, contentType }: { url: string; contentType: string }) {
  const {
    data: text,
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: ["file-preview-text", url],
    queryFn: () => fetchTextContent(url),
    staleTime: Infinity,
    retry: false,
  });

  if (isLoading) {
    return (
      <div className="flex flex-1 items-center justify-center p-8">
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 p-8 text-center">
        <AlertCircle
          className="size-8 text-zinc-400"
          aria-hidden="true"
        />
        <p className="text-sm text-zinc-600 dark:text-zinc-400">Failed to load file content.</p>
        <Button
          variant="outline"
          size="sm"
          onClick={() => void refetch()}
          className="gap-1.5"
        >
          <RefreshCw
            className="size-3.5"
            aria-hidden="true"
          />
          Retry
        </Button>
      </div>
    );
  }

  // Detect CSV for tabular rendering hint; otherwise plain text
  const isCsv = contentType.includes("csv") || url.toLowerCase().includes(".csv");

  return (
    <div className="min-h-0 flex-1 overflow-auto p-4">
      <pre
        className={`font-mono text-xs break-all whitespace-pre-wrap text-zinc-700 dark:text-zinc-300 ${isCsv ? "leading-5" : ""}`}
      >
        {text}
      </pre>
    </div>
  );
}

function PreviewContent({ url, contentType }: { url: string; contentType: string }) {
  const proxyUrl = toProxyUrl(url);

  if (contentType.startsWith("image/")) {
    return (
      <div className="flex flex-1 items-center justify-center overflow-auto p-4">
        <Image
          src={proxyUrl}
          alt="File preview"
          width={0}
          height={0}
          sizes="100%"
          style={{ width: "auto", height: "auto", maxWidth: "100%", maxHeight: "100%" }}
          className="rounded object-contain"
          unoptimized
        />
      </div>
    );
  }

  if (contentType.startsWith("video/")) {
    return (
      <div className="flex flex-1 items-center justify-center overflow-auto p-4">
        <video
          key={proxyUrl}
          src={proxyUrl}
          controls
          autoPlay
          loop
          className="max-h-full max-w-full rounded"
        />
      </div>
    );
  }

  if (
    contentType.startsWith("text/") ||
    contentType.includes("json") ||
    contentType.includes("xml") ||
    contentType.includes("yaml") ||
    contentType.startsWith("application/javascript") ||
    contentType.startsWith("application/x-sh") ||
    contentType.startsWith("application/x-python")
  ) {
    return (
      <TextPreview
        url={proxyUrl}
        contentType={contentType}
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
  const { copied, copy } = useCopy();
  const fullPath = path ? `${path}/${file.name}` : file.name;
  // Copy S3 URI when available; fall back to relative path
  const copyTarget = file.s3Path ?? fullPath;

  const handleCopyPath = useCallback(() => {
    void copy(copyTarget);
  }, [copy, copyTarget]);

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
            <Tooltip open={copied}>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 gap-1.5 px-2 text-xs"
                  onClick={handleCopyPath}
                  aria-label={`Copy path: ${copyTarget}`}
                >
                  <Copy
                    className="size-3.5"
                    aria-hidden="true"
                  />
                  Copy path
                </Button>
              </TooltipTrigger>
              <TooltipContent>Copied!</TooltipContent>
            </Tooltip>
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
          <PreviewError
            icon="lock"
            message="The bucket must be public to preview files. Contact your administrator to enable public access."
          />
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
