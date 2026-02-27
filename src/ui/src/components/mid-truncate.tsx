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
 * MidTruncate — Responsive mid-truncation for long strings.
 *
 * Shows the beginning and end of a string, letting the middle collapse under
 * CSS truncation when the container is too narrow. Useful for filenames (to
 * preserve the extension) and paths (to preserve both root and leaf).
 *
 * Uses a CSS flex approach: the prefix span end-truncates while the suffix
 * span never shrinks. A `title` attribute exposes the full string on hover.
 *
 * Example (filename):
 *   "really_long_image_name_batch001.jpg"
 *   → "really_long_ima...batch001.jpg"
 */

import { cn } from "@/lib/utils";

interface MidTruncateProps {
  /** Full string to display */
  text: string;
  /**
   * Number of trailing characters to always show (default: 12).
   * Useful for keeping file extensions and path tails visible.
   */
  suffixLength?: number;
  className?: string;
}

export function MidTruncate({ text, suffixLength = 12, className }: MidTruncateProps) {
  // Short strings: no truncation needed
  if (text.length <= suffixLength) {
    return (
      <span
        className={cn("min-w-0", className)}
        title={text}
      >
        {text}
      </span>
    );
  }

  const prefix = text.slice(0, text.length - suffixLength);
  const suffix = text.slice(-suffixLength);

  return (
    <span
      className={cn("flex min-w-0", className)}
      title={text}
    >
      {/* Shrinks and end-truncates with "..." when container is too narrow */}
      <span className="truncate">{prefix}</span>
      {/* Always visible — preserves extension / path tail */}
      <span className="shrink-0">{suffix}</span>
    </span>
  );
}
