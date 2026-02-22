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
 * Shared error card component for profile sections.
 * Displays a consistent error UI with icon, title, description, error message, and retry button.
 */

import { Button } from "@/components/shadcn/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/shadcn/card";

interface SectionErrorCardProps {
  /** Icon component to display in header */
  icon: React.ElementType;
  /** Section title */
  title: string;
  /** Section description */
  description: string;
  /** Error message label (e.g., "Unable to load pools") */
  errorLabel: string;
  /** Error object from TanStack Query */
  error: unknown;
  /** Retry handler */
  onRetry: () => void;
}

/**
 * Error fallback card for profile sections.
 * Used by CredentialsSection, BucketsSection, PoolsSection, and NotificationsSection.
 */
export function SectionErrorCard({
  icon: Icon,
  title,
  description,
  errorLabel,
  error,
  onRetry,
}: SectionErrorCardProps) {
  return (
    <Card data-variant="sectioned">
      <CardHeader className="border-b">
        <CardTitle className="flex items-center gap-2 text-lg">
          <Icon className="size-5" />
          {title}
        </CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex flex-col items-center gap-3 py-8 text-center">
          <div className="text-sm text-red-600 dark:text-red-400">{errorLabel}</div>
          <div className="text-xs text-zinc-500 dark:text-zinc-400">
            {error instanceof Error ? error.message : "An error occurred"}
          </div>
          <Button
            onClick={onRetry}
            variant="outline"
            size="sm"
          >
            Try again
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
