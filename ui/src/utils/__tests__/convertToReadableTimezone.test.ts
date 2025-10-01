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
import { convertToReadableTimezone } from "../string";

describe("convertToReadableTimezone", () => {
  it("should return 'N/A' for null or undefined input", () => {
    expect(convertToReadableTimezone(null)).toBe("N/A");
    expect(convertToReadableTimezone(undefined)).toBe("N/A");
  });

  it("should format a valid timestamp correctly", () => {
    const timestamp = "2024-03-20T15:30:00Z";
    const result = convertToReadableTimezone(timestamp);
    // The exact format will depend on the user's locale, but we can check the structure
    expect(result).toMatch(/^\d{2}\/\d{2}\/\d{2}, \d{2}:\d{2} [AP]M$/);
  });

  it("should handle timestamp without Z suffix", () => {
    const timestamp = "2024-03-20T15:30:00";
    const result = convertToReadableTimezone(timestamp);
    expect(result).toMatch(/^\d{2}\/\d{2}\/\d{2}, \d{2}:\d{2} [AP]M$/);
  });

  it("should handle invalid timestamp", () => {
    const timestamp = "invalid-date";
    const result = convertToReadableTimezone(timestamp);
    expect(result).toBe("N/A");
  });
});
