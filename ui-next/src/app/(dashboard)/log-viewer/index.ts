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
 * Log Viewer Feature Public API
 *
 * This is the public interface for the log-viewer feature. Other features should
 * only import from this file, not from internal paths.
 *
 * ## Architecture
 *
 * ```
 * log-viewer/
 * ├── index.ts          <- You are here (public API)
 * ├── page.tsx          <- Page component (workflow selector or viewer)
 * ├── components/       <- UI components (internal)
 * └── lib/              <- Utilities (internal)
 * ```
 *
 * ## Usage
 *
 * ```tsx
 * // Import from public API when using log-viewer in other features
 * import { addRecentWorkflow } from "@/app/(dashboard)/log-viewer";
 * ```
 *
 * Note: Most log-viewer functionality is accessed via @/components/log-viewer
 * which provides reusable LogViewerContainer component. This index.ts is for
 * page-specific exports if needed by other features.
 */

// =============================================================================
// Components
// =============================================================================

// Currently, log-viewer doesn't export components for use by other features.
// The LogViewerContainer is exported from @/components/log-viewer instead.
// This file exists to establish the feature module pattern for future exports.

// =============================================================================
// Utilities
// =============================================================================

export { addRecentWorkflow, getRecentWorkflows, clearRecentWorkflows } from "./lib/recent-workflows";
