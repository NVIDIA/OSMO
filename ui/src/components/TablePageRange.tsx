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
interface CalculateRangeArgs {
  currentPage: number;
  pageSize: number;
  totalRows: number;
  maxRangeItems: number;
}

export const calculateRange = ({ currentPage, pageSize, totalRows, maxRangeItems }: CalculateRangeArgs) => {
  const totalPages = Math.ceil(totalRows / pageSize);
  const length = totalPages > maxRangeItems ? maxRangeItems : totalPages;

  let start = Math.max(currentPage - Math.trunc(length / 2), 1);
  if (start >= Math.max(totalPages - length + 1)) {
    start = Math.max(totalPages - length + 1, 1);
  }

  return Array.from({ length }, (_, i) => i + start);
};

const TablePageRange = ({
  currentPage,
  pageSize,
  totalRows,
  maxRangeItems,
  setCurrentPage,
}: CalculateRangeArgs & { setCurrentPage: (page: number) => void }) => {
  const totalPages = Math.ceil(totalRows / pageSize);
  const range = calculateRange({
    currentPage,
    pageSize,
    totalRows,
    maxRangeItems,
  });

  return (
    <div className="flex items-center gap-global">
      <button
        className="btn btn-tertiary"
        onClick={() => setCurrentPage(1)}
        disabled={currentPage === 1}
      >
        &laquo; First
      </button>
      <button
        className="btn btn-tertiary"
        onClick={() => setCurrentPage(currentPage - 1)}
        aria-label="Previous"
        disabled={currentPage === 1}
      >
        &lt;
      </button>
      <div className="flex items-center gap-global">
        {range.map((page) => (
          <button
            key={page}
            className={`btn rounded-none ${page === currentPage ? "border-t-0 border-l-0 border-r-0 border-b-3 border-brand" : "btn-tertiary"}`}
            onClick={() => setCurrentPage(page)}
            aria-current={page === currentPage ? "page" : undefined}
          >
            {page}
          </button>
        ))}
      </div>
      <button
        className="btn btn-tertiary"
        onClick={() => setCurrentPage(currentPage + 1)}
        disabled={currentPage === totalPages}
        aria-label="Next"
      >
        &gt;
      </button>
      <button
        className="btn btn-tertiary"
        onClick={() => setCurrentPage(totalPages)}
        disabled={currentPage === totalPages}
      >
        Last &raquo;
      </button>
    </div>
  );
};

export default TablePageRange;
