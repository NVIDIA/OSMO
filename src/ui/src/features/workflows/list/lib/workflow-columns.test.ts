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

import { describe, expect, it } from "vitest";
import {
  COLUMN_LABELS,
  DEFAULT_COLUMN_ORDER,
  DEFAULT_VISIBLE_COLUMNS,
  isWorkflowColumnId,
} from "@/features/workflows/list/lib/workflow-columns";

describe("workflow labels column", () => {
  it("is visible by default and has a stable column identity", () => {
    expect(isWorkflowColumnId("labels")).toBe(true);
    expect(COLUMN_LABELS.labels).toBe("Labels");
    expect(DEFAULT_COLUMN_ORDER).toContain("labels");
    expect(DEFAULT_VISIBLE_COLUMNS).toContain("labels");
  });
});
