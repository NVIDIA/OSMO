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
import { convertToTimestamp } from "../string";

describe("convertToTimestamp", () => {
  it("should return undefined for null or undefined input", () => {
    expect(convertToTimestamp(null)).toBeUndefined();
    expect(convertToTimestamp(undefined)).toBeUndefined();
  });

  it("should convert a valid timestamp with Z suffix", () => {
    const timestamp = "2024-03-20T15:30:00Z";
    const result = convertToTimestamp(timestamp);
    expect(result).toBeInstanceOf(Date);
    expect(result?.toISOString()).toBe("2024-03-20T15:30:00.000Z");
  });

  it("should append Z suffix to timestamps without it", () => {
    const timestamp = "2024-03-20T15:30:00";
    const result = convertToTimestamp(timestamp);
    expect(result).toBeInstanceOf(Date);
    expect(result?.toISOString()).toBe("2024-03-20T15:30:00.000Z");
  });

  it("should handle invalid timestamp", () => {
    const timestamp = "invalid-date";
    const result = convertToTimestamp(timestamp);
    expect(result).toBeUndefined();
  });

  it("should handle empty string", () => {
    const timestamp = "";
    const result = convertToTimestamp(timestamp);
    expect(result).toBeUndefined();
  });

  it("should handle various valid timestamp formats", () => {
    const testCases = [
      { input: "2024-03-20T15:30:00Z", expected: "2024-03-20T15:30:00.000Z" },
      { input: "2024-03-20T15:30:00.123Z", expected: "2024-03-20T15:30:00.123Z" },
      { input: "2024-03-20T15:30:00+00:00", expected: "2024-03-20T15:30:00.000Z" },
      { input: "2024-03-20T15:30:00.123+00:00", expected: "2024-03-20T15:30:00.123Z" }
    ];

    testCases.forEach(({ input, expected }) => {
      const result = convertToTimestamp(input);
      expect(result).toBeInstanceOf(Date);
      expect(result?.toISOString()).toBe(expected);
    });
  });
});
