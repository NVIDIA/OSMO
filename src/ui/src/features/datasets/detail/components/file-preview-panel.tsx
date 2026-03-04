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
 * before rendering. All file requests are routed through /proxy/dataset/file
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

import { memo } from "react";
import Image from "next/image";
import dynamic from "next/dynamic";
import { useQuery } from "@tanstack/react-query";
import { AlertCircle, RefreshCw, Lock, X } from "lucide-react";
import { PanelTitle } from "@/components/panel/panel-header";
import { PanelHeaderContainer } from "@/components/panel/panel-header-controls";
import { Button } from "@/components/shadcn/button";
import { Skeleton } from "@/components/shadcn/skeleton";
import { formatBytes } from "@/lib/utils";
import { formatDateTimeFull } from "@/lib/format-date";
import { getBasePathUrl } from "@/lib/config";
import { CopyButton } from "@/components/copyable-value";
import { MidTruncate } from "@/components/mid-truncate";
import { CodeViewerSkeleton } from "@/components/code-viewer/code-viewer-skeleton";
import { getLanguageForContentType } from "@/components/code-viewer/lib/languages";
import type { DatasetFile } from "@/lib/api/adapter/datasets";

const CodeMirror = dynamic(
  () => import("@/components/code-viewer/code-mirror").then((m) => ({ default: m.CodeMirror })),
  { ssr: false, loading: () => <CodeViewerSkeleton className="absolute inset-0" /> },
);

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
  return getBasePathUrl(`/proxy/dataset/file?url=${encodeURIComponent(url)}`);
}

async function fetchHeadResult(url: string): Promise<HeadResult> {
  const response = await fetch(toProxyUrl(url), { method: "HEAD" });
  const contentType = response.headers.get("Content-Type") ?? "";
  return { status: response.status, contentType };
}

// =============================================================================
// File-type helpers — content-type first, extension fallback
// =============================================================================

const IMAGE_EXTS = new Set(["jpg", "jpeg", "png", "gif", "webp", "svg", "avif", "bmp", "ico", "tiff", "tif"]);
const VIDEO_EXTS = new Set(["mp4", "webm", "mov", "avi", "mkv", "ogg", "m4v", "3gp"]);

function getExtension(fileName: string): string {
  return fileName.split(".").pop()?.toLowerCase() ?? "";
}

function isImageType(contentType: string, fileName: string): boolean {
  return contentType.startsWith("image/") || IMAGE_EXTS.has(getExtension(fileName));
}

function isVideoType(contentType: string, fileName: string): boolean {
  return contentType.startsWith("video/") || VIDEO_EXTS.has(getExtension(fileName));
}

// =============================================================================
// Sub-components
// =============================================================================

function MetadataRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-3 text-xs">
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

function TextPreview({ url, contentType, fileName }: { url: string; contentType: string; fileName: string }) {
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

  const language = getLanguageForContentType(contentType, fileName);

  if (isLoading) {
    return (
      <div className="flex flex-1 items-center justify-center p-8">
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  if (error) {
    return (
      <PreviewError
        message="Failed to load file content."
        onRetry={() => void refetch()}
      />
    );
  }

  return (
    <div className="relative min-h-0 flex-1 overflow-hidden">
      <CodeMirror
        value={text ?? ""}
        language={language}
        readOnly
        className="absolute inset-0"
      />
    </div>
  );
}

function PreviewContent({ url, contentType, fileName }: { url: string; contentType: string; fileName: string }) {
  const proxyUrl = toProxyUrl(url);

  if (isImageType(contentType, fileName)) {
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

  if (isVideoType(contentType, fileName)) {
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
        fileName={fileName}
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
// Preview state — discriminated union replaces parallel boolean guards
// =============================================================================

type PreviewState =
  | { kind: "no-url" }
  | { kind: "loading" }
  | { kind: "error"; retry: () => void }
  | { kind: "denied" }
  | { kind: "not-found" }
  | { kind: "ready"; url: string; contentType: string };

function resolvePreviewState(
  url: string | undefined,
  isLoading: boolean,
  error: unknown,
  head: HeadResult | undefined,
  retry: () => void,
): PreviewState {
  if (!url) return { kind: "no-url" };
  if (isLoading) return { kind: "loading" };
  if (error) return { kind: "error", retry };
  if (!head) return { kind: "loading" };
  if (head.status === 401 || head.status === 403) return { kind: "denied" };
  if (head.status === 404) return { kind: "not-found" };
  if (head.status === 200) return { kind: "ready", url, contentType: head.contentType };
  // Unexpected status (e.g. 500) — treat as retriable error
  return { kind: "error", retry };
}

// =============================================================================
// Main component
// =============================================================================

export const FilePreviewPanel = memo(function FilePreviewPanel({ file, path, onClose }: FilePreviewPanelProps) {
  const relativePath = file.relativePath ?? (path ? `${path}/${file.name}` : file.name);

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

  const previewState = resolvePreviewState(file.url, headLoading, headError, head, () => void refetch());

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Sticky header */}
      <PanelHeaderContainer className="py-2.5">
        <div className="flex items-center gap-1.5">
          <div className="flex min-w-0 flex-1 items-center gap-1.5">
            <PanelTitle className="text-sm font-medium">{file.name}</PanelTitle>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-0 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-300"
            aria-label="Close panel"
          >
            <X
              className="size-4"
              aria-hidden="true"
            />
          </button>
        </div>
      </PanelHeaderContainer>

      {/* Preview area */}
      <div className="flex min-h-0 flex-1 flex-col">
        {previewState.kind === "no-url" && (
          <div className="flex flex-col items-center justify-center gap-2 p-8 text-center">
            <p className="text-sm text-zinc-500 dark:text-zinc-400">No preview URL available for this file.</p>
            <p className="text-xs text-zinc-400 dark:text-zinc-600">Copy the path to access it directly.</p>
          </div>
        )}
        {previewState.kind === "loading" && (
          <div className="flex flex-1 items-center justify-center p-8">
            <Skeleton className="h-40 w-full" />
          </div>
        )}
        {previewState.kind === "error" && (
          <PreviewError
            message="Could not reach the file. Check your network connection."
            onRetry={previewState.retry}
          />
        )}
        {previewState.kind === "denied" && (
          <PreviewError
            icon="lock"
            message="The bucket must be public to preview files. Contact your administrator to enable public access."
          />
        )}
        {previewState.kind === "not-found" && <PreviewError message="File not found at this path." />}
        {previewState.kind === "ready" && (
          <PreviewContent
            url={previewState.url}
            contentType={previewState.contentType}
            fileName={file.name}
          />
        )}
      </div>

      {/* Footer: metadata */}
      <div className="shrink-0 space-y-1.5 border-t border-zinc-200 px-4 py-2.5 dark:border-zinc-800">
        <div className="flex gap-3 text-xs">
          <span className="w-20 shrink-0 text-zinc-500 dark:text-zinc-400">Dataset Path</span>
          <MidTruncate
            text={relativePath}
            className="flex-1 font-mono text-zinc-700 dark:text-zinc-300"
          />
          <CopyButton
            value={relativePath}
            label="dataset path"
            className="ml-0 self-start"
          />
        </div>
        {file.storagePath && (
          <div className="flex gap-3 text-xs">
            <span className="w-20 shrink-0 text-zinc-500 dark:text-zinc-400">Storage Path</span>
            <MidTruncate
              text={file.storagePath}
              className="flex-1 font-mono text-zinc-700 dark:text-zinc-300"
            />
            <CopyButton
              value={file.storagePath}
              label="storage path"
              className="ml-0 self-start"
            />
          </div>
        )}
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
    </div>
  );
});
