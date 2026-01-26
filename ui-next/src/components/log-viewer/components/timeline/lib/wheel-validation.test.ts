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

import { describe, it, expect } from "vitest";
import {
  validateZoomInConstraints,
  validateZoomOutConstraints,
  calculateSymmetricZoom,
  calculatePan,
} from "./wheel-validation";
import { MIN_RANGE_MS, MAX_RANGE_MS, MIN_BUCKET_COUNT, MAX_BUCKET_COUNT } from "./timeline-constants";

describe("validateZoomInConstraints", () => {
  const BUCKET_WIDTH_MS = 1000; // 1 second buckets

  it("should allow zoom in when range is above MIN_RANGE_MS", () => {
    const result = validateZoomInConstraints(MIN_RANGE_MS + 1000, BUCKET_WIDTH_MS);
    expect(result.blocked).toBe(false);
  });

  it("should block zoom in when range equals MIN_RANGE_MS", () => {
    const result = validateZoomInConstraints(MIN_RANGE_MS - 1, BUCKET_WIDTH_MS);
    expect(result.blocked).toBe(true);
    expect(result.reason).toBe("MIN_RANGE_MS");
  });

  it("should block zoom in when range is below MIN_RANGE_MS", () => {
    const result = validateZoomInConstraints(MIN_RANGE_MS - 1000, BUCKET_WIDTH_MS);
    expect(result.blocked).toBe(true);
    expect(result.reason).toBe("MIN_RANGE_MS");
  });

  it("should allow zoom in when bucket count is above MIN_BUCKET_COUNT", () => {
    // Ensure range is also above MIN_RANGE_MS
    const rangeMs = Math.max((MIN_BUCKET_COUNT + 5) * BUCKET_WIDTH_MS, MIN_RANGE_MS + 1000);
    const result = validateZoomInConstraints(rangeMs, BUCKET_WIDTH_MS);
    expect(result.blocked).toBe(false);
  });

  it("should block zoom in when bucket count is below MIN_BUCKET_COUNT", () => {
    // Use a bucket width that makes (MIN_BUCKET_COUNT - 1) buckets still above MIN_RANGE_MS
    const largeBucketWidth = 10000; // 10 seconds per bucket
    const rangeMs = (MIN_BUCKET_COUNT - 1) * largeBucketWidth; // 19 buckets * 10s = 190s > 60s MIN_RANGE
    const result = validateZoomInConstraints(rangeMs, largeBucketWidth);
    expect(result.blocked).toBe(true);
    expect(result.reason).toContain("MIN_BUCKET_COUNT");
  });

  it("should handle zero bucket width gracefully", () => {
    const result = validateZoomInConstraints(MIN_RANGE_MS + 1000, 0);
    expect(result.blocked).toBe(false); // Only checks MIN_RANGE_MS when bucket width is 0
  });
});

describe("validateZoomOutConstraints", () => {
  const BUCKET_WIDTH_MS = 1000; // 1 second buckets

  it("should allow zoom out when range is below MAX_RANGE_MS", () => {
    // Ensure bucket count is also below MAX_BUCKET_COUNT
    const rangeMs = Math.min(MAX_RANGE_MS - 1000, (MAX_BUCKET_COUNT - 5) * BUCKET_WIDTH_MS);
    const result = validateZoomOutConstraints(rangeMs, BUCKET_WIDTH_MS);
    expect(result.blocked).toBe(false);
  });

  it("should block zoom out when range exceeds MAX_RANGE_MS", () => {
    const result = validateZoomOutConstraints(MAX_RANGE_MS + 1000, BUCKET_WIDTH_MS);
    expect(result.blocked).toBe(true);
    expect(result.reason).toBe("MAX_RANGE_MS");
  });

  it("should allow zoom out when bucket count is below MAX_BUCKET_COUNT", () => {
    // Ensure range is also below MAX_RANGE_MS
    const rangeMs = Math.min((MAX_BUCKET_COUNT - 5) * BUCKET_WIDTH_MS, MAX_RANGE_MS - 1000);
    const result = validateZoomOutConstraints(rangeMs, BUCKET_WIDTH_MS);
    expect(result.blocked).toBe(false);
  });

  it("should block zoom out when bucket count exceeds MAX_BUCKET_COUNT", () => {
    // Use a small bucket width so (MAX_BUCKET_COUNT + 1) buckets stays below MAX_RANGE_MS
    const smallBucketWidth = 100; // 0.1 seconds per bucket
    const rangeMs = (MAX_BUCKET_COUNT + 1) * smallBucketWidth; // 101 buckets * 0.1s = 10.1s < 1 day MAX_RANGE
    const result = validateZoomOutConstraints(rangeMs, smallBucketWidth);
    expect(result.blocked).toBe(true);
    expect(result.reason).toContain("MAX_BUCKET_COUNT");
  });

  it("should handle zero bucket width gracefully", () => {
    const result = validateZoomOutConstraints(MAX_RANGE_MS - 1000, 0);
    expect(result.blocked).toBe(false); // Only checks MAX_RANGE_MS when bucket width is 0
  });
});

describe("calculateSymmetricZoom", () => {
  it("should calculate zoom centered on middle of range", () => {
    const result = calculateSymmetricZoom(1000, 2000, 500);
    expect(result.newStartMs).toBe(1250); // Center at 1500, half-range 250
    expect(result.newEndMs).toBe(1750);
  });

  it("should handle zoom in (smaller range)", () => {
    const result = calculateSymmetricZoom(0, 1000, 500);
    expect(result.newStartMs).toBe(250); // Center at 500
    expect(result.newEndMs).toBe(750);
  });

  it("should handle zoom out (larger range)", () => {
    const result = calculateSymmetricZoom(500, 1500, 2000);
    expect(result.newStartMs).toBe(0); // Center at 1000
    expect(result.newEndMs).toBe(2000);
  });

  it("should allow negative start for zoom out", () => {
    const result = calculateSymmetricZoom(0, 1000, 2000);
    expect(result.newStartMs).toBe(-500); // Center at 500
    expect(result.newEndMs).toBe(1500);
  });
});

describe("calculatePan", () => {
  it("should pan right with positive delta", () => {
    const result = calculatePan(1000, 2000, 100);
    expect(result.newStartMs).toBe(1100);
    expect(result.newEndMs).toBe(2100);
  });

  it("should pan left with negative delta", () => {
    const result = calculatePan(1000, 2000, -100);
    expect(result.newStartMs).toBe(900);
    expect(result.newEndMs).toBe(1900);
  });

  it("should handle zero delta (no change)", () => {
    const result = calculatePan(1000, 2000, 0);
    expect(result.newStartMs).toBe(1000);
    expect(result.newEndMs).toBe(2000);
  });

  it("should allow panning into negative range", () => {
    const result = calculatePan(100, 200, -500);
    expect(result.newStartMs).toBe(-400);
    expect(result.newEndMs).toBe(-300);
  });
});
