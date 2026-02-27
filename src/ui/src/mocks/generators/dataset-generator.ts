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
 * Dataset Generator
 *
 * Generates dataset metadata for dataset management UI.
 * Uses deterministic seeding for infinite, memory-efficient pagination.
 */

import { faker } from "@faker-js/faker";
import { hashString } from "@/mocks/utils";
import { getGlobalMockConfig } from "@/mocks/global-config";
import { MOCK_CONFIG } from "@/mocks/seed/types";
import type { RawFileItem } from "@/lib/api/adapter/datasets";

// ============================================================================
// Types
// ============================================================================

export interface GeneratedDataset {
  name: string;
  bucket: string;
  path: string;
  version: number;
  created_at: string;
  updated_at: string;
  size_bytes: number;
  labels: Record<string, string>;
  retention_policy?: string;
  description?: string;
  user?: string;
}

export interface GeneratedDatasetVersion {
  name: string;
  version: string;
  status: string;
  created_by: string;
  created_date: string;
  last_used: string;
  retention_policy: number;
  size: number;
  checksum: string;
  location: string;
  uri: string;
  metadata: Record<string, unknown>;
  tags: string[];
  collections: string[];
}

export interface GeneratedCollectionMember {
  name: string;
  version: string;
  location: string;
  uri: string;
  size: number;
}

export interface DatasetFile {
  name: string;
  type: "file" | "folder";
  size?: number;
  modified?: string;
  checksum?: string;
  /** URL to access/preview the file (for public buckets) */
  url?: string;
}

// ============================================================================
// Configuration
// ============================================================================

const DATASET_PATTERNS = {
  names: [
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
  ],
  variants: ["train", "val", "test", "full", "mini", "sample"],
  buckets: ["osmo-datasets", "ml-data", "training-data"],
  modalities: ["text", "image", "audio", "video", "multimodal"],
  retentionPolicies: ["30d", "90d", "1y", "forever"],
};

const COLLECTION_PATTERNS = {
  names: [
    "training-bundle",
    "eval-suite",
    "multimodal-mix",
    "research-corpus",
    "benchmark-pack",
    "production-set",
    "experiment-v2",
    "curated-collection",
  ],
};

// ============================================================================
// Generator Configuration
// ============================================================================

interface GeneratorConfig {
  /** Total datasets */
  totalDatasets: number;
  baseSeed: number;
}

const DEFAULT_CONFIG: GeneratorConfig = {
  totalDatasets: 100,
  baseSeed: 55555,
};

// ============================================================================
// Generator Class
// ============================================================================

export class DatasetGenerator {
  private config: GeneratorConfig;

  constructor(config: Partial<GeneratorConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  get totalDatasets(): number {
    return getGlobalMockConfig().datasets;
  }

  set totalDatasets(value: number) {
    getGlobalMockConfig().datasets = value;
  }

  /**
   * Generate a dataset at a specific index.
   * DETERMINISTIC: Same index always produces the same dataset.
   */
  generate(index: number): GeneratedDataset {
    faker.seed(this.config.baseSeed + index);

    const baseName = DATASET_PATTERNS.names[index % DATASET_PATTERNS.names.length];
    const variant =
      DATASET_PATTERNS.variants[Math.floor(index / DATASET_PATTERNS.names.length) % DATASET_PATTERNS.variants.length];
    const uniqueSuffix =
      index >= DATASET_PATTERNS.names.length * DATASET_PATTERNS.variants.length
        ? `-${Math.floor(index / (DATASET_PATTERNS.names.length * DATASET_PATTERNS.variants.length))}`
        : "";
    const name = `${baseName}-${variant}${uniqueSuffix}`;

    const bucket = faker.helpers.arrayElement(DATASET_PATTERNS.buckets);
    const user = faker.helpers.arrayElement(MOCK_CONFIG.workflows.users);

    return {
      name,
      bucket,
      path: `s3://${bucket}/datasets/${name}/`,
      version: faker.number.int({ min: 1, max: 10 }),
      created_at: faker.date.past({ years: 2 }).toISOString(),
      updated_at: faker.date.past({ years: 1 }).toISOString(),
      size_bytes: faker.number.int({ min: 1e9, max: 1e12 }),
      labels: {
        modality: faker.helpers.arrayElement(DATASET_PATTERNS.modalities),
        project: faker.helpers.arrayElement(["training", "research", "evaluation"]),
        team: faker.helpers.arrayElement(["ml-platform", "cv-team", "nlp-team"]),
      },
      retention_policy: faker.helpers.arrayElement(DATASET_PATTERNS.retentionPolicies),
      description: `${baseName} dataset (${variant} split) for ML training and evaluation`,
      user,
    };
  }

  /**
   * Generate a page of datasets.
   */
  generatePage(offset: number, limit: number): { entries: GeneratedDataset[]; total: number } {
    const entries: GeneratedDataset[] = [];
    const total = this.totalDatasets; // Use getter to read from global config

    const start = Math.max(0, offset);
    const end = Math.min(offset + limit, total);

    for (let i = start; i < end; i++) {
      entries.push(this.generate(i));
    }

    return { entries, total };
  }

  /**
   * Generate dataset versions (matches backend DataInfoDatasetEntry).
   */
  generateVersions(datasetName: string, count: number = 5): GeneratedDatasetVersion[] {
    faker.seed(this.config.baseSeed + hashString(datasetName));

    const versions: GeneratedDatasetVersion[] = [];
    let date = faker.date.past({ years: 1 });
    const users = MOCK_CONFIG.workflows.users;

    for (let v = 1; v <= count; v++) {
      const createdDate = date.toISOString();
      const lastUsed = new Date(
        date.getTime() + faker.number.int({ min: 1, max: 7 }) * 24 * 60 * 60 * 1000,
      ).toISOString();

      versions.push({
        name: datasetName,
        version: String(v),
        status: v === 1 ? "READY" : faker.helpers.arrayElement(["READY", "PENDING"]),
        created_by: faker.helpers.arrayElement(users),
        created_date: createdDate,
        last_used: lastUsed,
        retention_policy: faker.helpers.arrayElement([30, 90, 365]),
        size: faker.number.int({ min: 1e9, max: 1e12 }),
        checksum: faker.string.hexadecimal({ length: 64, prefix: "" }),
        location: `s3://osmo-datasets/datasets/${datasetName}/v${v}/`,
        uri: `s3://osmo-datasets/datasets/${datasetName}/v${v}/`,
        metadata: {},
        tags: faker.helpers.arrayElements(["latest", "production", "test"], { min: 0, max: 2 }),
        collections: [],
      });

      // Advance date for next version
      date = new Date(date.getTime() + faker.number.int({ min: 1, max: 30 }) * 24 * 60 * 60 * 1000);
    }

    return versions;
  }

  /**
   * Total number of collections (20% of total datasets, at least 5).
   */
  get totalCollections(): number {
    return Math.max(5, Math.floor(this.totalDatasets * 0.2));
  }

  /**
   * Generate a collection at a specific index.
   * DETERMINISTIC: Same index always produces the same collection.
   */
  generateCollection(index: number): GeneratedDataset {
    faker.seed(this.config.baseSeed + 99999 + index);

    const baseName = COLLECTION_PATTERNS.names[index % COLLECTION_PATTERNS.names.length];
    const uniqueSuffix =
      index >= COLLECTION_PATTERNS.names.length ? `-${Math.floor(index / COLLECTION_PATTERNS.names.length)}` : "";
    const name = `${baseName}${uniqueSuffix}`;

    const bucket = faker.helpers.arrayElement(DATASET_PATTERNS.buckets);
    const user = faker.helpers.arrayElement(MOCK_CONFIG.workflows.users);

    return {
      name,
      bucket,
      path: `s3://${bucket}/collections/${name}/`,
      version: 0,
      created_at: faker.date.past({ years: 2 }).toISOString(),
      updated_at: faker.date.past({ years: 1 }).toISOString(),
      size_bytes: faker.number.int({ min: 1e10, max: 5e12 }),
      labels: {
        type: "collection",
        team: faker.helpers.arrayElement(["ml-platform", "cv-team", "nlp-team"]),
      },
      description: `${name} — curated collection of datasets`,
      user,
    };
  }

  /**
   * Generate collection members (matches backend DataInfoCollectionEntry).
   */
  generateCollectionMembers(collectionName: string): GeneratedCollectionMember[] {
    faker.seed(this.config.baseSeed + hashString(collectionName) + 77777);

    const count = faker.number.int({ min: 3, max: 5 });
    const members: GeneratedCollectionMember[] = [];

    for (let i = 0; i < count; i++) {
      const datasetIndex = Math.abs(hashString(collectionName + i)) % this.totalDatasets;
      const dataset = this.generate(datasetIndex);
      const version = String(faker.number.int({ min: 1, max: 5 }));

      members.push({
        name: dataset.name,
        version,
        location: `s3://osmo-datasets/datasets/${dataset.name}/v${version}/`,
        uri: `s3://osmo-datasets/datasets/${dataset.name}/v${version}/`,
        size: faker.number.int({ min: 1e9, max: 5e11 }),
      });
    }

    return members;
  }

  /**
   * Get collection by name. Returns null if not found.
   */
  getCollectionByName(name: string): GeneratedDataset | null {
    for (let i = 0; i < this.totalCollections; i++) {
      const collection = this.generateCollection(i);
      if (collection.name === name) {
        return collection;
      }
    }
    return null;
  }

  /**
   * Returns true if the dataset's files are in a private (non-public) bucket.
   * Deterministic: based on dataset name hash. Approximately 1 in 3 datasets are private.
   */
  isPrivateDataset(datasetName: string): boolean {
    return Math.abs(hashString(datasetName)) % 3 === 0;
  }

  /**
   * Get dataset by name.
   */
  getByName(name: string): GeneratedDataset | null {
    // Search through datasets
    for (let i = 0; i < Math.min(this.totalDatasets, 1000); i++) {
      const dataset = this.generate(i);
      if (dataset.name === name) {
        return dataset;
      }
    }
    // Fallback: generate from hash
    const hash = hashString(name);
    const dataset = this.generate(Math.abs(hash) % this.totalDatasets); // Use getter
    return { ...dataset, name };
  }

  /**
   * Generate file tree for a dataset at a specific path.
   * DETERMINISTIC: Same dataset + path always produces the same files.
   *
   * @param datasetName - Dataset name
   * @param path - Path within dataset (e.g., "", "train", "train/n01440764")
   * @param bucket - Bucket name (for building preview URLs)
   * @returns Array of files and folders at that path
   */
  generateFileTree(datasetName: string, path: string = "", bucket?: string): DatasetFile[] {
    // Normalize path (strip leading/trailing slashes)
    const normalizedPath = path === "/" ? "" : path.replace(/^\//, "").replace(/\/$/, "");
    const depth = normalizedPath === "" ? 0 : normalizedPath.split("/").length;

    // Seed based on dataset name + path for deterministic generation
    faker.seed(this.config.baseSeed + hashString(datasetName + path));

    const effectiveBucket = bucket ?? "osmo-datasets";
    const files: DatasetFile[] = [];

    /**
     * Build preview URL for a file.
     * MSW intercepts HEAD and GET for this pattern to simulate public bucket access.
     */
    const buildUrl = (filePath: string) =>
      `/api/bucket/${effectiveBucket}/dataset/${datasetName}/preview?path=${encodeURIComponent(filePath)}`;

    // Root level: standard dataset structure
    if (depth === 0) {
      files.push(
        { name: "train", type: "folder" },
        { name: "validation", type: "folder" },
        { name: "test", type: "folder" },
        {
          name: "metadata.json",
          type: "file",
          size: faker.number.int({ min: 1024, max: 10240 }),
          modified: faker.date.recent({ days: 30 }).toISOString(),
          checksum: faker.string.hexadecimal({ length: 64, prefix: "" }),
          url: buildUrl("metadata.json"),
        },
        {
          name: "README.md",
          type: "file",
          size: faker.number.int({ min: 512, max: 5120 }),
          modified: faker.date.recent({ days: 60 }).toISOString(),
          checksum: faker.string.hexadecimal({ length: 64, prefix: "" }),
          url: buildUrl("README.md"),
        },
      );
    }

    // Level 1: split folders (train, validation, test)
    else if (depth === 1) {
      const numClasses = faker.number.int({ min: 10, max: 100 });
      for (let i = 0; i < numClasses; i++) {
        files.push({
          name: `n${String(i).padStart(8, "0")}`,
          type: "folder",
        });
      }
    }

    // Level 2+: class folders with files
    else if (depth >= 2) {
      const numFiles = faker.number.int({ min: 50, max: 500 });
      const format = faker.helpers.arrayElement(["parquet", "jpg", "png", "tfrecord"]);
      const extension = format === "parquet" ? ".parquet" : format === "tfrecord" ? ".tfrecord" : `.${format}`;

      for (let i = 0; i < numFiles; i++) {
        const fileName = `${String(i).padStart(6, "0")}${extension}`;
        const filePath = normalizedPath ? `${normalizedPath}/${fileName}` : fileName;
        files.push({
          name: fileName,
          type: "file",
          size: faker.number.int({ min: 10240, max: 10485760 }), // 10KB - 10MB
          modified: faker.date.recent({ days: 90 }).toISOString(),
          checksum: faker.string.hexadecimal({ length: 64, prefix: "" }),
          url: buildUrl(filePath),
        });
      }

      // Add a few metadata files
      if (faker.datatype.boolean(0.3)) {
        const filePath = normalizedPath ? `${normalizedPath}/_metadata.json` : "_metadata.json";
        files.push({
          name: "_metadata.json",
          type: "file",
          size: faker.number.int({ min: 512, max: 2048 }),
          modified: faker.date.recent({ days: 90 }).toISOString(),
          checksum: faker.string.hexadecimal({ length: 64, prefix: "" }),
          url: buildUrl(filePath),
        });
      }
    }

    return files;
  }

  /**
   * Generate a flat file manifest for a dataset version.
   * Returns RawFileItem[] with relative_path entries representing the full dataset tree.
   * Used by the location-files MSW handler to serve mock file listings.
   */
  generateFlatManifest(datasetName: string, bucket?: string): RawFileItem[] {
    faker.seed(this.config.baseSeed + hashString(datasetName));

    const effectiveBucket = bucket ?? "osmo-datasets";
    const items: RawFileItem[] = [];

    const buildUrl = (filePath: string) =>
      `/api/bucket/${effectiveBucket}/dataset/${datasetName}/preview?path=${encodeURIComponent(filePath)}`;

    // Root files
    items.push(
      {
        relative_path: "metadata.json",
        size: faker.number.int({ min: 1024, max: 10240 }),
        url: buildUrl("metadata.json"),
      },
      { relative_path: "README.md", size: faker.number.int({ min: 512, max: 5120 }), url: buildUrl("README.md") },
    );

    // Three splits: train, validation, test — use text/json files that can be previewed
    const splits = ["train", "validation", "test"];
    const numClasses = faker.number.int({ min: 3, max: 6 });

    for (const split of splits) {
      for (let c = 0; c < numClasses; c++) {
        const className = `n${String(c).padStart(8, "0")}`;
        const numFiles = faker.number.int({ min: 3, max: 8 });
        for (let f = 0; f < numFiles; f++) {
          // Alternate between .json and .txt so the preview panel can render them
          const ext = f % 2 === 0 ? ".json" : ".txt";
          const fileName = `${String(f).padStart(6, "0")}${ext}`;
          const filePath = `${split}/${className}/${fileName}`;
          items.push({
            relative_path: filePath,
            size: faker.number.int({ min: 512, max: 16384 }),
            url: buildUrl(filePath),
          });
        }
      }
    }

    return items;
  }
}

// ============================================================================
// Singleton instance
// ============================================================================

export const datasetGenerator = new DatasetGenerator();

// ============================================================================
// Configuration helpers
// ============================================================================

export function setDatasetTotal(total: number): void {
  datasetGenerator.totalDatasets = total;
}

export function getDatasetTotal(): number {
  return datasetGenerator.totalDatasets;
}
