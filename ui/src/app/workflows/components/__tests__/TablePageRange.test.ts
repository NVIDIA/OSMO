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
/* eslint-disable @typescript-eslint/require-await */
/*
SPDX-FileCopyrightText: Copyright (c) 2025 NVIDIA CORPORATION & AFFILIATES. All rights reserved.

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.

SPDX-License-Identifier: Apache-2.0
*/

import { calculateRange } from "~/components/TablePageRange";
describe("calculateRange", () => {
  it("should return correct range when total pages is less than max range items", async () => {
    const result = calculateRange({
      currentPage: 2,
      pageSize: 10,
      totalRows: 25, // 3 total pages
      maxRangeItems: 5,
    });
    expect(result).toEqual([1, 2, 3]);
  });

  it("should center current page in range when possible", async () => {
    const result = calculateRange({
      currentPage: 5,
      pageSize: 10,
      totalRows: 100, // 10 total pages
      maxRangeItems: 5,
    });
    expect(result).toEqual([3, 4, 5, 6, 7]);
  });

  it("should center current page in range when possible (2)", async () => {
    const result = calculateRange({
      currentPage: 7,
      pageSize: 10,
      totalRows: 100, // 10 total pages
      maxRangeItems: 5,
    });
    expect(result).toEqual([5, 6, 7, 8, 9]);
  });

  it("should adjust range when near start", async () => {
    const result = calculateRange({
      currentPage: 2,
      pageSize: 10,
      totalRows: 100, // 10 total pages
      maxRangeItems: 5,
    });
    expect(result).toEqual([1, 2, 3, 4, 5]);
  });

  it("should adjust range when near end", async () => {
    const result = calculateRange({
      currentPage: 9,
      pageSize: 10,
      totalRows: 100, // 10 total pages
      maxRangeItems: 5,
    });
    expect(result).toEqual([6, 7, 8, 9, 10]);
  });
});
