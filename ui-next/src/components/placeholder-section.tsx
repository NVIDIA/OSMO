/**
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION. All rights reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 *
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Placeholder Section Component
 *
 * A "coming soon" placeholder for features that are planned but not yet implemented.
 * Uses dashed border and reduced opacity to indicate it's not yet functional.
 */

import { cn } from "@/lib/utils";
import { heading, text } from "@/lib/styles";

// =============================================================================
// Types
// =============================================================================

export interface PlaceholderSectionProps {
  /** Section title */
  title: string;
  /** Description of what will appear here */
  description: string;
  /** Optional note about when it's coming */
  note?: string;
  /** Additional CSS classes */
  className?: string;
}

// =============================================================================
// Component
// =============================================================================

/**
 * PlaceholderSection - "Coming soon" placeholder for future features.
 *
 * @example
 * ```tsx
 * <PlaceholderSection
 *   title="Active Resources"
 *   description="Jobs and resources running on this pool will appear here"
 *   note="Coming soon: Cross-reference with Resources page"
 * />
 * ```
 */
export function PlaceholderSection({ title, description, note, className }: PlaceholderSectionProps) {
  return (
    <section className={cn("opacity-50", className)}>
      <h3 className={cn(heading.section, "mb-2")}>{title}</h3>
      <div className="rounded-lg border border-dashed border-zinc-300 bg-zinc-50/50 p-4 dark:border-zinc-700 dark:bg-zinc-900/50">
        <p className={cn(text.muted, "text-center")}>{description}</p>
        {note && <p className={cn(text.hint, "mt-1 text-center")}>{note}</p>}
      </div>
    </section>
  );
}
