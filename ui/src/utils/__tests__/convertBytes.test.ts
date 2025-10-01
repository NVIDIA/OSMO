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
import { convertBytes } from "../string";

describe("convertBytes", () => {
  it("should return '0.00 B' for zero bytes", () => {
    expect(convertBytes(0)).toBe("0.00 B");
  });

  it("should convert bytes to KB", () => {
    expect(convertBytes(1024)).toBe("1.00 Kb");
    expect(convertBytes(1536)).toBe("1.50 Kb");
  });

  it("should convert bytes to MB", () => {
    expect(convertBytes(1024 * 1024)).toBe("1.00 Mb");
    expect(convertBytes(1.5 * 1024 * 1024)).toBe("1.50 Mb");
  });

  it("should convert bytes to GB", () => {
    expect(convertBytes(1024 * 1024 * 1024)).toBe("1.00 Gb");
    expect(convertBytes(1.5 * 1024 * 1024 * 1024)).toBe("1.50 Gb");
  });

  it("should convert bytes to TB", () => {
    expect(convertBytes(1024 * 1024 * 1024 * 1024)).toBe("1.00 Tb");
    expect(convertBytes(1.5 * 1024 * 1024 * 1024 * 1024)).toBe("1.50 Tb");
  });

  it("should convert bytes to PB", () => {
    expect(convertBytes(1024 * 1024 * 1024 * 1024 * 1024)).toBe("1.00 Pb");
    expect(convertBytes(1.5 * 1024 * 1024 * 1024 * 1024 * 1024)).toBe("1.50 Pb");
  });

  it("should handle small byte values", () => {
    expect(convertBytes(1)).toBe("1.00 B");
    expect(convertBytes(500)).toBe("500.00 B");
  });
});
