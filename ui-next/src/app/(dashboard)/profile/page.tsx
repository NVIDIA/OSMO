/**
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION. All rights reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 *
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Profile Page
 *
 * User profile settings page with card-based sections for:
 * - User Information (read-only)
 * - Notification Preferences (stage+commit)
 * - Default Bucket (stage+commit)
 * - Pools Selection (stage+commit)
 * - Credentials Management (immediate save)
 *
 * Design Patterns:
 * - Stage+commit: Make changes, then explicitly Save or Reset
 * - Immediate save: CRUD operations save instantly
 * - Collapsible inline forms: No modals except delete confirmation
 *
 * Note: This page uses client-side data fetching since profile data
 * is user-specific and cannot be prefetched on the server without
 * authentication context.
 */

import { ProfileLayout } from "./components/ProfileLayout";

export default function ProfilePage() {
  return <ProfileLayout />;
}
