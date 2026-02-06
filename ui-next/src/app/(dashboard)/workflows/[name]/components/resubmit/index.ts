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
 * Resubmit Workflow Panel
 *
 * Resizable side panel for workflow resubmission.
 * Provides spec preview, pool selection, and priority configuration.
 *
 * @example
 * ```tsx
 * import { ResubmitPanel } from './resubmit';
 *
 * <ResubmitPanel
 *   workflow={workflow}
 *   open={panelOpen}
 *   onClose={handleClose}
 * >
 *   <WorkflowDetailPage workflow={workflow} />
 * </ResubmitPanel>
 * ```
 */

export { ResubmitPanel, type ResubmitPanelProps } from "./ResubmitPanel";
export { ResubmitPanelHeader, type ResubmitPanelHeaderProps } from "./ResubmitPanelHeader";
export { ResubmitPanelContent, type ResubmitPanelContentProps } from "./ResubmitPanelContent";
export { useResubmitForm, type UseResubmitFormOptions, type UseResubmitFormReturn } from "./hooks";
export { useResubmitMutation, type UseResubmitMutationOptions, type UseResubmitMutationReturn } from "./hooks";
