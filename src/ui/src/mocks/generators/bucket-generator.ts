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

import { faker } from "@faker-js/faker";
import { delay } from "msw";
import { parsePagination, getMockDelay } from "@/mocks/utils";
import { getGlobalMockConfig } from "@/mocks/global-config";
import type { BucketInfoResponse } from "@/mocks/generated-mocks";

const BASE_SEED = 44444;

export const BUCKET_NAMES = [
  "osmo-artifacts",
  "osmo-checkpoints",
  "osmo-datasets",
  "osmo-models",
  "ml-experiments",
  "training-outputs",
  "inference-cache",
  "model-registry",
];

function generateBucket(index: number) {
  faker.seed(BASE_SEED + index);

  const baseName = BUCKET_NAMES[index % BUCKET_NAMES.length];
  const name = index < BUCKET_NAMES.length ? baseName : `${baseName}-${Math.floor(index / BUCKET_NAMES.length)}`;
  const provider = faker.helpers.arrayElement(["s3", "gcs", "minio"]);
  const region = faker.helpers.arrayElement(["us-west-2", "us-east-1", "eu-west-1", "ap-southeast-1"]);

  return {
    name,
    path: provider === "minio" ? "http://minio.local:9000" : provider === "gcs" ? `gs://${name}` : `s3://${name}`,
    description: `${provider} bucket in ${region}`,
  };
}

export class BucketGenerator {
  get totalBuckets(): number {
    return getGlobalMockConfig().buckets;
  }

  handleListBuckets = async ({ request }: { request: Request }): Promise<BucketInfoResponse> => {
    await delay(getMockDelay());

    const url = new URL(request.url);
    const { offset, limit } = parsePagination(url, { limit: 50 });
    const start = Math.max(0, offset);
    const end = Math.min(start + limit, this.totalBuckets);

    const buckets = Object.fromEntries(
      Array.from({ length: end - start }, (_, i) => {
        const entry = generateBucket(start + i);
        return [entry.name, { path: entry.path, description: entry.description, mode: "rw", default_cred: true }];
      }),
    );

    return { buckets };
  };
}

export const bucketGenerator = new BucketGenerator();
