//SPDX-FileCopyrightText: Copyright (c) 2025 NVIDIA CORPORATION & AFFILIATES. All rights reserved.

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
import { calcDuration } from "../string";

describe("calcDuration", () => {
  it("should return undefined for null or undefined start time", () => {
    expect(calcDuration(null)).toBeUndefined();
    expect(calcDuration(undefined)).toBeUndefined();
  });

  it("should calculate duration between two timestamps", () => {
    const start = "2024-03-20T15:30:00Z";
    const end = "2024-03-20T16:30:00Z";
    expect(calcDuration(start, end)).toBe("1h");
  });

  it("should calculate duration with minutes and seconds", () => {
    const start = "2024-03-20T15:30:00Z";
    const end = "2024-03-20T15:31:30Z";
    expect(calcDuration(start, end)).toBe("1m30s");
  });

  it("should calculate duration with days", () => {
    const start = "2024-03-20T15:30:00Z";
    const end = "2024-03-22T15:30:00Z";
    expect(calcDuration(start, end)).toBe("2d");
  });

  it("should use current time when end time is not provided", () => {
    const start = new Date(Date.now() - 3600000).toISOString(); // 1 hour ago
    const result = calcDuration(start);
    expect(result).toBe("1h");
  });

  it("should handle invalid timestamps", () => {
    const start = new Date(Date.now() - 3600000).toISOString(); // 1 hour ago
    const end = "invalid-date";
    const result = calcDuration(start, end);
    expect(result).toBeUndefined();
  });
});
