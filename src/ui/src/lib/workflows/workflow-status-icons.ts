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

import { Clock, CheckCircle2, XCircle, Loader2, AlertTriangle } from "lucide-react";
import type { ComponentType } from "react";
import type { StatusCategory } from "@/lib/workflows/workflow-constants";

export const WORKFLOW_STATUS_ICONS: Record<StatusCategory, ComponentType<{ className?: string }>> = {
  waiting: Clock,
  pending: Loader2,
  running: Loader2,
  completed: CheckCircle2,
  failed: XCircle,
  unknown: AlertTriangle,
};

export function getWorkflowStatusIcon(category: StatusCategory): ComponentType<{ className?: string }> {
  return WORKFLOW_STATUS_ICONS[category];
}
