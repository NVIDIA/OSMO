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

import { useAutoRefreshSettings } from "@/hooks/use-auto-refresh-settings";
import { AUTO_REFRESH_INTERVALS } from "@/lib/config";

/** Default: 2min - workflow list updates less frequently than active workflows */
export function useWorkflowsAutoRefresh() {
  return useAutoRefreshSettings("workflows-auto-refresh", AUTO_REFRESH_INTERVALS.STANDARD);
}
