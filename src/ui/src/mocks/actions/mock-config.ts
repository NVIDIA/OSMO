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

"use server";

import type { MockVolumes } from "@/mocks/global-config";
import { getGlobalMockConfig, setGlobalMockConfig } from "@/mocks/global-config";

export async function setMockVolumes(volumes: Partial<MockVolumes>): Promise<MockVolumes> {
  setGlobalMockConfig(volumes);

  if (volumes.workflows !== undefined) {
    try {
      const { workflowGenerator } = await import("@/mocks/generators/workflow-generator");
      workflowGenerator.clearCache();
    } catch {
      // Cache clear failed, not critical
    }
  }

  return getGlobalMockConfig();
}

export async function getMockVolumes(): Promise<MockVolumes> {
  return getGlobalMockConfig();
}
