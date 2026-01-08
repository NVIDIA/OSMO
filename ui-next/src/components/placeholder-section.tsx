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
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/shadcn/card";

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
    <Card className={cn("border-dashed opacity-50", className)}>
      <CardHeader className="pb-2">
        <CardTitle className="text-xs font-semibold uppercase tracking-wider">{title}</CardTitle>
      </CardHeader>
      <CardContent className="text-center">
        <CardDescription>{description}</CardDescription>
        {note && <p className="mt-1 text-xs text-muted-foreground/70">{note}</p>}
      </CardContent>
    </Card>
  );
}
