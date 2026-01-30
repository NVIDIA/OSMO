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
 * LeadBadge Component
 *
 * Reusable badge that indicates a "Lead" task in the workflow UI.
 * Lead tasks are the first task to run in a group.
 */

import { memo } from "react";

export const LeadBadge = memo(function LeadBadge() {
  return (
    <span className="shrink-0 rounded bg-amber-100 px-1 py-0.5 text-[10px] font-medium tracking-wide text-amber-700 uppercase ring-1 ring-amber-600/20 ring-inset dark:bg-amber-500/20 dark:text-amber-400 dark:ring-amber-500/30">
      Lead
    </span>
  );
});
