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
 * Bucket Generator
 *
 * Generates bucket and artifact data for storage/artifact browsing.
 * Uses deterministic seeding for infinite, memory-efficient pagination.
 */

import { faker } from "@faker-js/faker";
import { hashString } from "@/mocks/utils";
import { getGlobalMockConfig } from "@/mocks/global-config";

// ============================================================================
// Types
// ============================================================================

export interface GeneratedBucket {
  name: string;
  provider: string;
  region: string;
  endpoint?: string;
  created_at: string;
  size_bytes: number;
  object_count: number;
  labels: Record<string, string>;
}

export interface GeneratedArtifact {
  key: string;
  size: number;
  last_modified: string;
  etag: string;
  content_type: string;
  metadata: Record<string, string>;
}

export interface GeneratedArtifactList {
  bucket: string;
  prefix: string;
  artifacts: GeneratedArtifact[];
  common_prefixes: string[];
  is_truncated: boolean;
  next_continuation_token?: string;
}

// ============================================================================
// Configuration
// ============================================================================

const BUCKET_PATTERNS = {
  names: [
    "osmo-artifacts",
    "osmo-checkpoints",
    "osmo-datasets",
    "osmo-models",
    "ml-experiments",
    "training-outputs",
    "inference-cache",
    "model-registry",
  ],
  providers: ["s3", "gcs", "minio"],
  regions: ["us-west-2", "us-east-1", "eu-west-1", "ap-southeast-1"],
  artifactTypes: {
    checkpoint: { extensions: [".pt", ".ckpt", ".safetensors"], sizeRange: [100e6, 50e9] as [number, number] },
    model: { extensions: [".pt", ".onnx", ".engine"], sizeRange: [1e9, 100e9] as [number, number] },
    log: { extensions: [".log", ".txt", ".jsonl"], sizeRange: [1e3, 100e6] as [number, number] },
    config: { extensions: [".yaml", ".yml", ".json"], sizeRange: [100, 100e3] as [number, number] },
    metrics: { extensions: [".json", ".csv", ".parquet"], sizeRange: [1e3, 10e6] as [number, number] },
  },
};

// ============================================================================
// Generator Configuration
// ============================================================================

interface GeneratorConfig {
  /** Total buckets */
  totalBuckets: number;
  /** Artifacts per workflow */
  artifactsPerWorkflow: number;
  baseSeed: number;
}

const DEFAULT_CONFIG: GeneratorConfig = {
  totalBuckets: 50,
  artifactsPerWorkflow: 100,
  baseSeed: 44444,
};

// ============================================================================
// Generator Class
// ============================================================================

export class BucketGenerator {
  private config: GeneratorConfig;

  constructor(config: Partial<GeneratorConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  get totalBuckets(): number {
    return getGlobalMockConfig().buckets;
  }

  set totalBuckets(value: number) {
    getGlobalMockConfig().buckets = value;
  }

  /**
   * Generate a bucket at a specific index.
   * DETERMINISTIC: Same index always produces the same bucket.
   */
  generateBucket(index: number): GeneratedBucket {
    faker.seed(this.config.baseSeed + index);

    const baseName = BUCKET_PATTERNS.names[index % BUCKET_PATTERNS.names.length];
    const name =
      index < BUCKET_PATTERNS.names.length
        ? baseName
        : `${baseName}-${Math.floor(index / BUCKET_PATTERNS.names.length)}`;

    const provider = faker.helpers.arrayElement(BUCKET_PATTERNS.providers);
    const region = faker.helpers.arrayElement(BUCKET_PATTERNS.regions);

    return {
      name,
      provider,
      region,
      endpoint: provider === "minio" ? "http://minio.local:9000" : undefined,
      created_at: faker.date.past({ years: 2 }).toISOString(),
      size_bytes: faker.number.int({ min: 1e9, max: 1e12 }),
      object_count: faker.number.int({ min: 100, max: 100000 }),
      labels: {
        team: faker.helpers.arrayElement(["ml-platform", "training", "research"]),
        environment: faker.helpers.arrayElement(["prod", "dev", "staging"]),
      },
    };
  }

  /**
   * Generate a page of buckets.
   */
  generateBucketPage(offset: number, limit: number): { entries: GeneratedBucket[]; total: number } {
    const entries: GeneratedBucket[] = [];
    const total = this.totalBuckets; // Use getter to read from global config

    const start = Math.max(0, offset);
    const end = Math.min(offset + limit, total);

    for (let i = start; i < end; i++) {
      entries.push(this.generateBucket(i));
    }

    return { entries, total };
  }

  /**
   * Generate artifacts for a workflow with pagination.
   */
  generateWorkflowArtifacts(
    bucketName: string,
    workflowName: string,
    limit: number = 20,
    offset: number = 0,
  ): GeneratedArtifactList {
    faker.seed(this.config.baseSeed + hashString(bucketName + workflowName));

    const prefix = `workflows/${workflowName}/`;
    const total = this.config.artifactsPerWorkflow;
    const artifacts: GeneratedArtifact[] = [];

    // Generate artifacts for this page
    const types = ["checkpoint", "log", "config", "metrics"] as const;
    const start = Math.max(0, offset);
    const end = Math.min(offset + limit, total);

    for (let i = start; i < end; i++) {
      faker.seed(this.config.baseSeed + hashString(bucketName + workflowName) + i);

      const type = types[i % types.length];
      const config = BUCKET_PATTERNS.artifactTypes[type];
      const ext = faker.helpers.arrayElement(config.extensions);

      let key: string;
      switch (type) {
        case "checkpoint":
          key = `${prefix}checkpoints/epoch_${faker.number.int({ min: 1, max: 100 })}${ext}`;
          break;
        case "log":
          key = `${prefix}logs/${faker.helpers.arrayElement(["train", "eval", "main"])}_${i}${ext}`;
          break;
        case "config":
          key = `${prefix}config_v${faker.number.int({ min: 1, max: 10 })}${ext}`;
          break;
        case "metrics":
          key = `${prefix}metrics/${faker.helpers.arrayElement(["training", "validation"])}_${i}${ext}`;
          break;
      }

      artifacts.push({
        key,
        size: faker.number.int({ min: config.sizeRange[0], max: config.sizeRange[1] }),
        last_modified: faker.date.recent({ days: 30 }).toISOString(),
        etag: faker.string.hexadecimal({ length: 32 }).slice(2),
        content_type: this.getContentType(ext),
        metadata: {
          workflow: workflowName,
          type,
        },
      });
    }

    // Common prefixes (subdirectories)
    const commonPrefixes = [`${prefix}checkpoints/`, `${prefix}logs/`, `${prefix}metrics/`];

    return {
      bucket: bucketName,
      prefix,
      artifacts,
      common_prefixes: commonPrefixes,
      is_truncated: end < total,
      next_continuation_token: end < total ? `${end}` : undefined,
    };
  }

  /**
   * Get bucket by name.
   */
  getBucketByName(name: string): GeneratedBucket | null {
    const index = BUCKET_PATTERNS.names.indexOf(name);
    if (index >= 0) {
      return this.generateBucket(index);
    }
    // Generate from hash
    const hash = hashString(name);
    const bucket = this.generateBucket(Math.abs(hash) % this.totalBuckets); // Use getter
    return { ...bucket, name };
  }

  // --------------------------------------------------------------------------
  // Private helpers
  // --------------------------------------------------------------------------

  private getContentType(ext: string): string {
    const types: Record<string, string> = {
      ".pt": "application/octet-stream",
      ".ckpt": "application/octet-stream",
      ".safetensors": "application/octet-stream",
      ".onnx": "application/octet-stream",
      ".engine": "application/octet-stream",
      ".log": "text/plain",
      ".txt": "text/plain",
      ".jsonl": "application/x-ndjson",
      ".yaml": "text/yaml",
      ".yml": "text/yaml",
      ".json": "application/json",
      ".csv": "text/csv",
      ".parquet": "application/octet-stream",
    };
    return types[ext] || "application/octet-stream";
  }
}

// ============================================================================
// Singleton instance
// ============================================================================

export const bucketGenerator = new BucketGenerator();

// ============================================================================
// Configuration helpers
// ============================================================================

export function setBucketTotal(total: number): void {
  bucketGenerator.totalBuckets = total;
}

export function getBucketTotal(): number {
  return bucketGenerator.totalBuckets;
}
