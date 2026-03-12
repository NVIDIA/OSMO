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

import { ArrowDown, ArrowUp, Circle } from "lucide-react";
import { WorkflowPriority } from "@/lib/api/generated";
import { PRIORITY_STYLES } from "@/lib/workflows/workflow-constants";

export const PRIORITY_DISPLAY = {
  [WorkflowPriority.HIGH]: { ...PRIORITY_STYLES[WorkflowPriority.HIGH], Icon: ArrowUp, iconClass: "size-3 shrink-0" },
  [WorkflowPriority.NORMAL]: { ...PRIORITY_STYLES[WorkflowPriority.NORMAL], Icon: Circle, iconClass: "size-1.5 shrink-0 fill-current opacity-50 mr-0.5" },
  [WorkflowPriority.LOW]: { ...PRIORITY_STYLES[WorkflowPriority.LOW], Icon: ArrowDown, iconClass: "size-3 shrink-0" },
} as const;

export type PriorityDisplay = (typeof PRIORITY_DISPLAY)[keyof typeof PRIORITY_DISPLAY];
