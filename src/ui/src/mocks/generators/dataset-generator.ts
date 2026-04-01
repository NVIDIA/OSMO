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
import { HttpResponse, delay } from "msw";
import { hashString, getMockDelay } from "@/mocks/utils";
import { getGlobalMockConfig } from "@/mocks/global-config";
import { MOCK_CONFIG } from "@/mocks/seed/types";
import { DatasetType } from "@/mocks/generated-mocks";
import type {
  DataListResponse,
  DataInfoResponse,
  DataInfoResponseLabels,
  DataInfoDatasetEntry,
  DataInfoCollectionEntry,
} from "@/mocks/generated-mocks";
import type { RawFileItem } from "@/lib/api/adapter/datasets";

const EXT_TO_CONTENT_TYPE: Record<string, string> = {
  json: "application/json",
  txt: "text/plain",
  md: "text/markdown",
  csv: "text/csv",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
  mp4: "video/mp4",
  webm: "video/webm",
  pdf: "application/pdf",
  parquet: "application/octet-stream",
  tfrecord: "application/octet-stream",
};

// 1×1 transparent PNG for image placeholder responses
const PLACEHOLDER_PNG = Uint8Array.from(
  atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=="),
  (c) => c.charCodeAt(0),
);

const BASE_SEED = 55555;

const DATASET_NAMES = [
  "imagenet-1k",
  "coco-2017",
  "librispeech-960h",
  "wikipedia-en",
  "openwebtext",
  "pile-dedup",
  "laion-400m",
  "common-crawl",
  "redpajama",
  "c4",
  "private-bucket", // simulates inaccessible bucket → file preview returns 401
];
const DATASET_VARIANTS = ["train", "val", "test", "full", "mini", "sample"];
const DATASET_BUCKETS = ["osmo-datasets", "ml-data", "training-data"];
const COLLECTION_NAMES = [
  "training-bundle",
  "eval-suite",
  "multimodal-mix",
  "research-corpus",
  "benchmark-pack",
  "production-set",
  "experiment-v2",
  "curated-collection",
];

export class DatasetGenerator {
  get totalDatasets(): number {
    return getGlobalMockConfig().datasets;
  }

  get totalCollections(): number {
    return Math.max(5, Math.floor(this.totalDatasets * 0.2));
  }

  private generate(index: number) {
    faker.seed(BASE_SEED + index);

    const baseName = DATASET_NAMES[index % DATASET_NAMES.length];
    const variant = DATASET_VARIANTS[Math.floor(index / DATASET_NAMES.length) % DATASET_VARIANTS.length];
    const uniqueSuffix =
      index >= DATASET_NAMES.length * DATASET_VARIANTS.length
        ? `-${Math.floor(index / (DATASET_NAMES.length * DATASET_VARIANTS.length))}`
        : "";

    const name = `${baseName}-${variant}${uniqueSuffix}`;
    const bucket = faker.helpers.arrayElement(DATASET_BUCKETS);

    return {
      name,
      bucket,
      path: `s3://${bucket}/datasets/${name}/`,
      version: faker.number.int({ min: 1, max: 10 }),
      created_at: faker.date.past({ years: 2 }).toISOString(),
      updated_at: faker.date.past({ years: 1 }).toISOString(),
      size_bytes: faker.number.int({ min: 1e9, max: 1e12 }),
      labels: {
        modality: faker.helpers.arrayElement(["text", "image", "audio", "video", "multimodal"]),
        project: faker.helpers.arrayElement(["training", "research", "evaluation"]),
        team: faker.helpers.arrayElement(["ml-platform", "cv-team", "nlp-team"]),
      } satisfies DataInfoResponseLabels,
      user: faker.helpers.arrayElement(MOCK_CONFIG.workflows.users),
    };
  }

  private generatePage(offset: number, limit: number) {
    const total = this.totalDatasets;
    const start = Math.max(0, offset);
    const end = Math.min(offset + limit, total);
    const entries = Array.from({ length: end - start }, (_, i) => this.generate(start + i));
    return { entries, total };
  }

  generateVersions(datasetName: string, count: number = 5): DataInfoDatasetEntry[] {
    faker.seed(BASE_SEED + hashString(datasetName));

    const versions: DataInfoDatasetEntry[] = [];
    let date = faker.date.past({ years: 1 });

    for (let v = 1; v <= count; v++) {
      const createdDate = date.toISOString();
      const lastUsed = new Date(
        date.getTime() + faker.number.int({ min: 1, max: 7 }) * 24 * 60 * 60 * 1000,
      ).toISOString();

      versions.push({
        name: datasetName,
        version: String(v),
        status: v === 1 ? "READY" : faker.helpers.arrayElement(["READY", "PENDING"]),
        created_by: faker.helpers.arrayElement(MOCK_CONFIG.workflows.users),
        created_date: createdDate,
        last_used: lastUsed,
        size: faker.number.int({ min: 1e9, max: 1e12 }),
        checksum: faker.string.hexadecimal({ length: 64, prefix: "" }),
        location: `s3://osmo-datasets/datasets/${datasetName}/v${v}/`,
        uri: `s3://osmo-datasets/datasets/${datasetName}/v${v}/`,
        metadata: {},
        tags: [],
        collections: [],
      });

      date = new Date(date.getTime() + faker.number.int({ min: 1, max: 30 }) * 24 * 60 * 60 * 1000);
    }

    // "latest" always on the last version; other tags randomly assigned.
    // Matches the backend's unique constraint: each tag appears on at most one version.
    const lastIndex = versions.length - 1;
    versions[lastIndex].tags.push("latest");
    for (const tag of ["production", "test"] as const) {
      if (faker.datatype.boolean(0.5)) {
        versions[faker.number.int({ min: 0, max: lastIndex })].tags.push(tag);
      }
    }

    return versions;
  }

  generateCollection(index: number) {
    faker.seed(BASE_SEED + 99999 + index);

    const baseName = COLLECTION_NAMES[index % COLLECTION_NAMES.length];
    const uniqueSuffix = index >= COLLECTION_NAMES.length ? `-${Math.floor(index / COLLECTION_NAMES.length)}` : "";
    const name = `${baseName}${uniqueSuffix}`;
    const bucket = faker.helpers.arrayElement(DATASET_BUCKETS);

    return {
      name,
      bucket,
      path: `s3://${bucket}/collections/${name}/`,
      created_at: faker.date.past({ years: 2 }).toISOString(),
      updated_at: faker.date.past({ years: 1 }).toISOString(),
      size_bytes: faker.number.int({ min: 1e10, max: 5e12 }),
      labels: {
        type: "collection",
        team: faker.helpers.arrayElement(["ml-platform", "cv-team", "nlp-team"]),
      } satisfies DataInfoResponseLabels,
      user: faker.helpers.arrayElement(MOCK_CONFIG.workflows.users),
    };
  }

  generateCollectionMembers(collectionName: string): DataInfoCollectionEntry[] {
    faker.seed(BASE_SEED + hashString(collectionName) + 77777);

    const count = faker.number.int({ min: 3, max: 5 });
    return Array.from({ length: count }, (_, i) => {
      const dataset = this.generate(Math.abs(hashString(collectionName + i)) % this.totalDatasets);
      const version = String(faker.number.int({ min: 1, max: 5 }));
      return {
        name: dataset.name,
        version,
        location: `s3://osmo-datasets/datasets/${dataset.name}/v${version}/`,
        uri: `s3://osmo-datasets/datasets/${dataset.name}/v${version}/`,
        size: faker.number.int({ min: 1e9, max: 5e11 }),
      };
    });
  }

  getCollectionByName(name: string) {
    for (let i = 0; i < this.totalCollections; i++) {
      const collection = this.generateCollection(i);
      if (collection.name === name) return collection;
    }
    return null;
  }

  getByName(name: string) {
    const dataset = this.generate(Math.abs(hashString(name)) % this.totalDatasets);
    return dataset.name === name ? dataset : { ...dataset, name };
  }

  isPrivateDataset(datasetName: string): boolean {
    const lower = datasetName.toLowerCase();
    return lower.includes("private") || lower.includes("forbidden");
  }

  generateFlatManifest(datasetName: string, bucket?: string, locationBase?: string): RawFileItem[] {
    faker.seed(BASE_SEED + hashString(datasetName));

    const effectiveBucket = bucket ?? "osmo-datasets";
    const buildUrl = (filePath: string) =>
      `/api/bucket/${effectiveBucket}/dataset/${datasetName}/preview?path=${encodeURIComponent(filePath)}`;
    const buildStoragePath = locationBase
      ? (filePath: string) => `${locationBase.replace(/\/$/, "")}/${filePath}`
      : () => undefined;

    const items: RawFileItem[] = [
      {
        relative_path: "metadata.json",
        size: faker.number.int({ min: 1024, max: 10240 }),
        url: buildUrl("metadata.json"),
        storage_path: buildStoragePath("metadata.json"),
      },
      {
        relative_path: "README.md",
        size: faker.number.int({ min: 512, max: 5120 }),
        url: buildUrl("README.md"),
        storage_path: buildStoragePath("README.md"),
      },
    ];

    const numClasses = faker.number.int({ min: 3, max: 6 });
    for (const split of ["train", "validation", "test"]) {
      for (let c = 0; c < numClasses; c++) {
        const className = `n${String(c).padStart(8, "0")}`;
        const numFiles = faker.number.int({ min: 3, max: 8 });
        for (let f = 0; f < numFiles; f++) {
          // Alternate .json/.txt so the preview panel can render them
          const ext = f % 2 === 0 ? ".json" : ".txt";
          const filePath = `${split}/${className}/${String(f).padStart(6, "0")}${ext}`;
          items.push({
            relative_path: filePath,
            size: faker.number.int({ min: 512, max: 16384 }),
            url: buildUrl(filePath),
            storage_path: buildStoragePath(filePath),
          });
        }
      }
    }

    return items;
  }

  handleListDatasets = async ({ request }: { request: Request }): Promise<DataListResponse> => {
    await delay(getMockDelay());

    const url = new URL(request.url);
    const requestedCount = parseInt(url.searchParams.get("count") || "50", 10);
    const allUsers = url.searchParams.get("all_users") !== "false";
    const datasetType = url.searchParams.get("dataset_type");
    const mockCurrentUser = MOCK_CONFIG.workflows.users[0];

    const datasets: DataListResponse["datasets"] = [];
    let remaining = requestedCount;

    if (datasetType !== DatasetType.COLLECTION && remaining > 0) {
      const { entries } = this.generatePage(0, Math.min(remaining, this.totalDatasets));
      for (const d of entries) {
        if (remaining <= 0) break;
        if (!allUsers && d.user !== mockCurrentUser) continue;
        datasets.push({
          name: d.name,
          id: d.name,
          bucket: d.bucket,
          create_time: d.created_at,
          last_created: d.updated_at,
          hash_location: d.path,
          hash_location_size: d.size_bytes,
          version_id: `v${d.version}`,
          type: DatasetType.DATASET,
        });
        remaining--;
      }
    }

    if (datasetType !== DatasetType.DATASET && remaining > 0) {
      const collectionCount = Math.min(remaining, this.totalCollections);
      for (let i = 0; i < collectionCount; i++) {
        if (remaining <= 0) break;
        const c = this.generateCollection(i);
        if (!allUsers && c.user !== mockCurrentUser) continue;
        datasets.push({
          name: c.name,
          id: c.name,
          bucket: c.bucket,
          create_time: c.created_at,
          last_created: c.updated_at,
          hash_location: c.path,
          hash_location_size: c.size_bytes,
          version_id: "",
          type: DatasetType.COLLECTION,
        });
        remaining--;
      }
    }

    return { datasets };
  };

  handleGetLocationFiles = async ({ request }: { request: Request }): Promise<Response> => {
    await delay(getMockDelay());
    const url = new URL(request.url);
    const locationUrl = url.searchParams.get("url") ?? "";
    const datasetName = locationUrl.match(/\/datasets\/([^/]+)\/v\d+/)?.[1] ?? "";
    const bucket = locationUrl.match(/s3:\/\/([^/]+)/)?.[1] ?? "osmo-datasets";
    return HttpResponse.json(this.generateFlatManifest(datasetName, bucket, locationUrl));
  };

  handleFileProxy = async ({ request }: { request: Request }): Promise<Response> => {
    await delay(getMockDelay());
    const url = new URL(request.url);
    const fileUrl = url.searchParams.get("url") ?? "";
    const datasetName = fileUrl.match(/\/dataset\/([^/?]+)\/preview/)?.[1] ?? "";

    if (this.isPrivateDataset(datasetName)) {
      return new HttpResponse(null, { status: 401 });
    }

    const filePath = new URL(fileUrl, "http://localhost").searchParams.get("path") ?? "";
    const ext = filePath.split(".").pop()?.toLowerCase() ?? "";
    const contentType = EXT_TO_CONTENT_TYPE[ext] ?? "application/octet-stream";

    if (request.method === "HEAD") {
      return new HttpResponse(null, { status: 200, headers: { "Content-Type": contentType } });
    }
    if (ext === "json") {
      return HttpResponse.json({ mock: true, path: filePath, dataset: datasetName });
    }
    return HttpResponse.text(`Mock file: ${filePath}\nDataset: ${datasetName}\n`, {
      headers: { "Content-Type": "text/plain" },
    });
  };

  handleFilePreviewHead = async ({
    params,
    request,
  }: {
    params: Record<string, string | readonly string[] | undefined>;
    request: Request;
  }): Promise<Response> => {
    await delay(getMockDelay());
    const datasetName = params.name as string;
    if (this.isPrivateDataset(datasetName)) {
      return new HttpResponse(null, { status: 401 });
    }
    const url = new URL(request.url);
    const filePath = url.searchParams.get("path") ?? "";
    const ext = filePath.split(".").pop()?.toLowerCase() ?? "";
    return new HttpResponse(null, {
      status: 200,
      headers: { "Content-Type": EXT_TO_CONTENT_TYPE[ext] ?? "application/octet-stream" },
    });
  };

  handleFilePreviewGet = async ({
    params,
    request,
  }: {
    params: Record<string, string | readonly string[] | undefined>;
    request: Request;
  }): Promise<Response> => {
    await delay(getMockDelay());
    const datasetName = params.name as string;
    if (this.isPrivateDataset(datasetName)) {
      return new HttpResponse(null, { status: 401 });
    }
    const url = new URL(request.url);
    const filePath = url.searchParams.get("path") ?? "";
    const ext = filePath.split(".").pop()?.toLowerCase() ?? "";

    if (["jpg", "jpeg", "png", "gif", "webp"].includes(ext)) {
      return new HttpResponse(PLACEHOLDER_PNG, { status: 200, headers: { "Content-Type": "image/png" } });
    }
    if (ext === "json") {
      return HttpResponse.json({ mock: true, preview: true, path: filePath });
    }
    if (["txt", "md"].includes(ext)) {
      return HttpResponse.text(`Mock preview for: ${filePath}`, {
        headers: { "Content-Type": "text/plain" },
      });
    }
    return new HttpResponse(new Uint8Array(8), {
      status: 200,
      headers: { "Content-Type": "application/octet-stream" },
    });
  };

  handleGetDatasetInfo = async ({
    params,
  }: {
    params: Record<string, string | readonly string[] | undefined>;
    request: Request;
  }): Promise<DataInfoResponse> => {
    await delay(getMockDelay());

    const name = params.name as string;

    const collection = this.getCollectionByName(name);
    if (collection) {
      return {
        id: collection.name,
        name: collection.name,
        bucket: collection.bucket,
        created_by: collection.user,
        created_date: collection.created_at,
        hash_location: collection.path,
        hash_location_size: collection.size_bytes,
        labels: collection.labels,
        type: DatasetType.COLLECTION,
        versions: this.generateCollectionMembers(name),
      };
    }

    const dataset = this.getByName(name);
    return {
      id: dataset.name,
      name: dataset.name,
      bucket: dataset.bucket,
      created_by: dataset.user,
      created_date: dataset.created_at,
      hash_location: dataset.path,
      hash_location_size: dataset.size_bytes,
      labels: dataset.labels,
      type: DatasetType.DATASET,
      versions: this.generateVersions(dataset.name),
    };
  };
}

export const datasetGenerator = new DatasetGenerator();
