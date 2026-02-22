//SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION. All rights reserved.

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

/**
 * Date Range Filter Utilities
 *
 * Provides preset suggestions for created_at/updated_at filtering
 * in the datasets FilterBar.
 */

import { DATE_RANGE_PRESETS } from "@/lib/date-range-utils";

/**
 * Get preset suggestions for FilterBar autocomplete using "value|label" encoding.
 *
 * Each string encodes the chip value (ISO date or range) and the human-readable
 * hint label separated by "|". The FilterBar splits on "|" to display the hint
 * as right-aligned secondary text while storing only the ISO value in the chip.
 *
 * Examples:
 *   "2026-02-20|today"               → chip value "2026-02-20", hint "today"
 *   "2026-02-13..2026-02-20|last 7 days"  → chip value "2026-02-13..2026-02-20", hint "last 7 days"
 */
export function getDateRangePresetSuggestions(): string[] {
  return DATE_RANGE_PRESETS.map((p) => `${p.getValue()}|${p.label}`);
}
