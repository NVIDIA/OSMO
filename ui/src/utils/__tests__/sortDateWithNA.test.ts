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
import { type Row } from "@tanstack/react-table";

import { sortDateWithNA } from "../string";

describe("sortDateWithNA", () => {
  const createMockRow = (date?: Date): Row<{ date: Date }> => ({
    getValue: (_columnId: string) => date,
  } as Row<{ date: Date }>);

  it("should return 0 when both dates are undefined", () => {
    const rowA = createMockRow();
    const rowB = createMockRow();
    expect(sortDateWithNA(rowA, rowB, "date")).toBe(0);
  });

  it("should return -1 when first date is undefined", () => {
    const rowA = createMockRow();
    const rowB = createMockRow(new Date("2024-03-20"));
    expect(sortDateWithNA(rowA, rowB, "date")).toBe(-1);
  });

  it("should return 1 when second date is undefined", () => {
    const rowA = createMockRow(new Date("2024-03-20"));
    const rowB = createMockRow();
    expect(sortDateWithNA(rowA, rowB, "date")).toBe(1);
  });

  it("should return 0 when dates are equal", () => {
    const date = new Date("2024-03-20");
    const rowA = createMockRow(date);
    const rowB = createMockRow(date);
    expect(sortDateWithNA(rowA, rowB, "date")).toBe(0);
  });

  it("should return 1 when first date is greater", () => {
    const rowA = createMockRow(new Date("2024-03-21"));
    const rowB = createMockRow(new Date("2024-03-20"));
    expect(sortDateWithNA(rowA, rowB, "date")).toBe(1);
  });

  it("should return -1 when first date is less", () => {
    const rowA = createMockRow(new Date("2024-03-19"));
    const rowB = createMockRow(new Date("2024-03-20"));
    expect(sortDateWithNA(rowA, rowB, "date")).toBe(-1);
  });
});
