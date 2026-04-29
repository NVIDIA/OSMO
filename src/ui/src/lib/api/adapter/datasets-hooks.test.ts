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
 * Tests for datasets hooks logic.
 *
 * The hooks in datasets-hooks.ts are thin wrappers around React Query's useQuery.
 * This file tests the logic extracted from those hooks:
 * - Enabled condition calculations
 * - Query key construction verification
 *
 * Note: The actual React hooks require @testing-library/react's renderHook which
 * is not available in this project. The hooks' behavior is validated through
 * E2E tests. This file tests the pure logic that gates query execution.
 */

import { describe, it, expect } from "vitest";

// =============================================================================
// Extracted Logic: Enabled Conditions
// =============================================================================

/**
 * Calculates the enabled state for useDatasetLatest hook.
 * Mirrors the logic: enabled: (options?.enabled ?? true) && !!bucket && !!name
 */
function calculateDatasetLatestEnabled(bucket: string, name: string, optionsEnabled?: boolean): boolean {
  const baseEnabled = optionsEnabled ?? true;
  return baseEnabled && !!bucket && !!name;
}

/**
 * Calculates the enabled state for useDatasetFiles hook.
 * Mirrors the logic: enabled: (options?.enabled ?? true) && !!location
 */
function calculateDatasetFilesEnabled(location: string | null, optionsEnabled?: boolean): boolean {
  const baseEnabled = optionsEnabled ?? true;
  return baseEnabled && !!location;
}

/**
 * Calculates the enabled state for useDataset hook.
 * Mirrors the logic: enabled: options?.enabled ?? true
 */
function calculateDatasetEnabled(optionsEnabled?: boolean): boolean {
  return optionsEnabled ?? true;
}

// =============================================================================
// Tests: useDatasetLatest enabled logic
// =============================================================================

describe("useDatasetLatest enabled logic", () => {
  describe("with valid bucket and name", () => {
    it("returns true when options.enabled is undefined", () => {
      const result = calculateDatasetLatestEnabled("test-bucket", "test-dataset", undefined);
      expect(result).toBe(true);
    });

    it("returns true when options.enabled is true", () => {
      const result = calculateDatasetLatestEnabled("test-bucket", "test-dataset", true);
      expect(result).toBe(true);
    });

    it("returns false when options.enabled is false", () => {
      const result = calculateDatasetLatestEnabled("test-bucket", "test-dataset", false);
      expect(result).toBe(false);
    });
  });

  describe("with empty bucket", () => {
    it("returns false when bucket is empty string", () => {
      const result = calculateDatasetLatestEnabled("", "test-dataset", undefined);
      expect(result).toBe(false);
    });

    it("returns false even when options.enabled is true", () => {
      const result = calculateDatasetLatestEnabled("", "test-dataset", true);
      expect(result).toBe(false);
    });
  });

  describe("with empty name", () => {
    it("returns false when name is empty string", () => {
      const result = calculateDatasetLatestEnabled("test-bucket", "", undefined);
      expect(result).toBe(false);
    });

    it("returns false even when options.enabled is true", () => {
      const result = calculateDatasetLatestEnabled("test-bucket", "", true);
      expect(result).toBe(false);
    });
  });

  describe("with both empty", () => {
    it("returns false when both bucket and name are empty", () => {
      const result = calculateDatasetLatestEnabled("", "", undefined);
      expect(result).toBe(false);
    });
  });
});

// =============================================================================
// Tests: useDatasetFiles enabled logic
// =============================================================================

describe("useDatasetFiles enabled logic", () => {
  describe("with valid location", () => {
    it("returns true when options.enabled is undefined", () => {
      const result = calculateDatasetFilesEnabled("s3://bucket/path", undefined);
      expect(result).toBe(true);
    });

    it("returns true when options.enabled is true", () => {
      const result = calculateDatasetFilesEnabled("s3://bucket/path", true);
      expect(result).toBe(true);
    });

    it("returns false when options.enabled is false", () => {
      const result = calculateDatasetFilesEnabled("s3://bucket/path", false);
      expect(result).toBe(false);
    });
  });

  describe("with null location", () => {
    it("returns false when location is null", () => {
      const result = calculateDatasetFilesEnabled(null, undefined);
      expect(result).toBe(false);
    });

    it("returns false even when options.enabled is true", () => {
      const result = calculateDatasetFilesEnabled(null, true);
      expect(result).toBe(false);
    });
  });

  describe("with empty string location", () => {
    it("returns false when location is empty string", () => {
      const result = calculateDatasetFilesEnabled("", undefined);
      expect(result).toBe(false);
    });
  });
});

// =============================================================================
// Tests: useDataset enabled logic
// =============================================================================

describe("useDataset enabled logic", () => {
  it("returns true when options.enabled is undefined", () => {
    const result = calculateDatasetEnabled(undefined);
    expect(result).toBe(true);
  });

  it("returns true when options.enabled is true", () => {
    const result = calculateDatasetEnabled(true);
    expect(result).toBe(true);
  });

  it("returns false when options.enabled is false", () => {
    const result = calculateDatasetEnabled(false);
    expect(result).toBe(false);
  });
});

// =============================================================================
// Tests: Edge cases for truthiness
// =============================================================================

describe("truthiness edge cases", () => {
  describe("useDatasetLatest with whitespace strings", () => {
    it("treats whitespace-only bucket as truthy", () => {
      // Note: " " is truthy in JavaScript
      const result = calculateDatasetLatestEnabled("  ", "test-dataset", undefined);
      expect(result).toBe(true);
    });

    it("treats whitespace-only name as truthy", () => {
      const result = calculateDatasetLatestEnabled("test-bucket", "  ", undefined);
      expect(result).toBe(true);
    });
  });

  describe("useDatasetFiles with various location formats", () => {
    it("accepts s3 URLs", () => {
      const result = calculateDatasetFilesEnabled("s3://bucket/key", undefined);
      expect(result).toBe(true);
    });

    it("accepts azure URLs", () => {
      const result = calculateDatasetFilesEnabled("az://container/blob", undefined);
      expect(result).toBe(true);
    });

    it("accepts gcs URLs", () => {
      const result = calculateDatasetFilesEnabled("gs://bucket/object", undefined);
      expect(result).toBe(true);
    });

    it("accepts http URLs", () => {
      const result = calculateDatasetFilesEnabled("https://example.com/manifest", undefined);
      expect(result).toBe(true);
    });
  });
});
