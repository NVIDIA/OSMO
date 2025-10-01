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
import { convertSeconds } from "../string";

describe("convertSeconds", () => {
  it("should handle negative input", () => {
    expect(convertSeconds(-1)).toBe("Invalid input: Negative value");
  });

  it("should format seconds only", () => {
    expect(convertSeconds(30)).toBe("30s");
    expect(convertSeconds(59)).toBe("59s");
  });

  it("should format minutes and seconds", () => {
    expect(convertSeconds(90)).toBe("1m30s");
    expect(convertSeconds(150)).toBe("2m30s");
  });

  it("should format hours and minutes", () => {
    expect(convertSeconds(3600)).toBe("1h");
    expect(convertSeconds(3660)).toBe("1h1m");
    expect(convertSeconds(3720)).toBe("1h2m");
  });

  it("should format days and hours", () => {
    expect(convertSeconds(86400)).toBe("1d");
    expect(convertSeconds(90000)).toBe("1d1h");
    expect(convertSeconds(93600)).toBe("1d2h");
  });

  it("should handle decimal input by truncating", () => {
    expect(convertSeconds(90.7)).toBe("1m30s");
    expect(convertSeconds(3600.9)).toBe("1h");
  });

  it("should handle zero seconds", () => {
    expect(convertSeconds(0)).toBe("0s");
  });
});
