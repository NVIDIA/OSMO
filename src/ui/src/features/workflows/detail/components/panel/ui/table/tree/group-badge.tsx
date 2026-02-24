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

/**
 * GroupBadge Component
 *
 * Reusable badge that indicates a "Group" entity in the workflow UI.
 * Used in table cells, panel headers, and anywhere groups need visual distinction.
 */

import { memo } from "react";
import { Badge } from "@/components/shadcn/badge";

export const GroupBadge = memo(function GroupBadge() {
  return (
    <Badge
      variant="outline"
      className="shrink-0 rounded-md text-[10px] font-medium tracking-wide uppercase"
    >
      Group
    </Badge>
  );
});
