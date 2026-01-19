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
import { hashString } from "../utils";

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
  num_files: number;
  format: string;
  labels: Record<string, string>;
  retention_policy?: string;
  description?: string;
}

export interface GeneratedDatasetVersion {
  version: number;
  created_at: string;
  size_bytes: number;
  num_files: number;
  commit_message?: string;
  created_by: string;
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
  formats: ["parquet", "arrow", "tfrecord", "jsonl", "csv", "hdf5"],
  buckets: ["osmo-datasets", "ml-data", "training-data"],
  modalities: ["text", "image", "audio", "video", "multimodal"],
  retentionPolicies: ["30d", "90d", "1y", "forever"],
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
    return this.config.totalDatasets;
  }

  set totalDatasets(value: number) {
    this.config.totalDatasets = value;
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
    const format = faker.helpers.arrayElement(DATASET_PATTERNS.formats);

    return {
      name,
      bucket,
      path: `s3://${bucket}/datasets/${name}/`,
      version: faker.number.int({ min: 1, max: 10 }),
      created_at: faker.date.past({ years: 2 }).toISOString(),
      updated_at: faker.date.recent({ days: 90 }).toISOString(),
      size_bytes: faker.number.int({ min: 1e9, max: 1e12 }),
      num_files: faker.number.int({ min: 10, max: 10000 }),
      format,
      labels: {
        modality: faker.helpers.arrayElement(DATASET_PATTERNS.modalities),
        project: faker.helpers.arrayElement(["training", "research", "evaluation"]),
        team: faker.helpers.arrayElement(["ml-platform", "cv-team", "nlp-team"]),
      },
      retention_policy: faker.helpers.arrayElement(DATASET_PATTERNS.retentionPolicies),
      description: `${baseName} dataset (${variant} split) for ML training and evaluation`,
    };
  }

  /**
   * Generate a page of datasets.
   */
  generatePage(offset: number, limit: number): { entries: GeneratedDataset[]; total: number } {
    const entries: GeneratedDataset[] = [];
    const total = this.config.totalDatasets;

    const start = Math.max(0, offset);
    const end = Math.min(offset + limit, total);

    for (let i = start; i < end; i++) {
      entries.push(this.generate(i));
    }

    return { entries, total };
  }

  /**
   * Generate dataset versions.
   */
  generateVersions(datasetName: string, count: number = 5): GeneratedDatasetVersion[] {
    faker.seed(this.config.baseSeed + hashString(datasetName));

    const versions: GeneratedDatasetVersion[] = [];
    let date = faker.date.past({ years: 1 });

    for (let v = 1; v <= count; v++) {
      versions.push({
        version: v,
        created_at: date.toISOString(),
        size_bytes: faker.number.int({ min: 1e9, max: 1e12 }),
        num_files: faker.number.int({ min: 100, max: 10000 }),
        commit_message: faker.helpers.arrayElement([
          "Initial upload",
          "Added validation split",
          "Fixed corrupted files",
          "Added new samples",
          "Reprocessed with updated pipeline",
        ]),
        created_by: faker.helpers.arrayElement(["alice", "bob", "system", "pipeline"]),
      });

      // Advance date for next version
      date = new Date(date.getTime() + faker.number.int({ min: 1, max: 30 }) * 24 * 60 * 60 * 1000);
    }

    return versions;
  }

  /**
   * Get dataset by name.
   */
  getByName(name: string): GeneratedDataset | null {
    // Search through datasets
    for (let i = 0; i < Math.min(this.config.totalDatasets, 1000); i++) {
      const dataset = this.generate(i);
      if (dataset.name === name) {
        return dataset;
      }
    }
    // Fallback: generate from hash
    const hash = hashString(name);
    const dataset = this.generate(Math.abs(hash) % this.config.totalDatasets);
    return { ...dataset, name };
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
