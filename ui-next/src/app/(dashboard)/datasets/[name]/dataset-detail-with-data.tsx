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
 * Dataset Detail With Data (Server Component)
 *
 * Prefetches dataset detail data on the server and hydrates the client component.
 */

import { HydrationBoundary, dehydrate } from "@tanstack/react-query";
import { createQueryClient } from "@/lib/query-client";
import { prefetchDatasetDetail } from "@/lib/api/server/datasets";
import { DatasetDetailContent } from "@/app/(dashboard)/datasets/[name]/dataset-detail-content";

interface Props {
  name: string;
}

/**
 * Parse dataset identifier from URL parameter.
 * Format: "bucket--name" (double dash separator)
 * This allows us to encode both bucket and name in the URL path.
 */
function parseDatasetId(encodedName: string): { bucket: string; name: string } {
  // Check if name contains double dash separator
  const parts = encodedName.split("--");

  if (parts.length >= 2) {
    // Format: bucket--name
    const bucket = parts[0];
    const name = parts.slice(1).join("--"); // Handle names that might contain --
    return { bucket, name };
  }

  // Fallback: assume default bucket (this will need to be updated based on actual backend behavior)
  // For now, use "default" as the bucket name
  return { bucket: "default", name: encodedName };
}

export async function DatasetDetailWithData({ name: encodedName }: Props) {
  const queryClient = createQueryClient();

  // Parse bucket and name from the encoded parameter
  const { bucket, name } = parseDatasetId(encodedName);

  // Prefetch dataset detail (includes versions)
  await prefetchDatasetDetail(queryClient, bucket, name);

  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <DatasetDetailContent
        bucket={bucket}
        name={name}
      />
    </HydrationBoundary>
  );
}
