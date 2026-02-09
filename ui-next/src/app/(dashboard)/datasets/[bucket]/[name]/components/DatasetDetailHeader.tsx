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
 * Dataset Detail Header Component
 *
 * Displays dataset name, path, and navigation back button.
 */

"use client";

import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/shadcn/button";
import { useBreadcrumbOrigin } from "@/components/chrome/breadcrumb-origin-context";
import { useRouter, usePathname } from "next/navigation";
import { useViewTransition } from "@/hooks/use-view-transition";
import type { Dataset } from "@/lib/api/adapter/datasets";

interface Props {
  dataset: Dataset;
}

export function DatasetDetailHeader({ dataset }: Props) {
  const { getOrigin } = useBreadcrumbOrigin();
  const pathname = usePathname();
  const router = useRouter();
  const { startTransition } = useViewTransition();

  const handleBack = () => {
    const backUrl = getOrigin(pathname) || "/datasets";
    startTransition(() => {
      router.push(backUrl);
    });
  };

  return (
    <div className="flex items-start justify-between">
      <div className="flex items-start gap-4">
        <Button
          variant="ghost"
          size="icon"
          onClick={handleBack}
          className="mt-1"
        >
          <ArrowLeft className="h-5 w-5" />
        </Button>

        <div>
          <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-100">{dataset.name}</h1>
          <p className="mt-1 font-mono text-sm text-zinc-600 dark:text-zinc-400">
            {dataset.path || `s3://${dataset.bucket}/datasets/${dataset.name}/`}
          </p>
        </div>
      </div>

      {/* Future: Actions menu (delete, edit, etc.) */}
    </div>
  );
}
