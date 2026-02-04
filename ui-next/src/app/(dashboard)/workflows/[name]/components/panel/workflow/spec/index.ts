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
 * Spec Viewer Components
 *
 * CodeMirror-based YAML/template spec viewer for workflow details panel.
 *
 * @example
 * ```tsx
 * import { WorkflowSpecViewer } from './spec';
 *
 * <WorkflowSpecViewer workflowId={workflow.name} />
 * ```
 */

// Main container
export { WorkflowSpecViewer, type WorkflowSpecViewerProps } from "./WorkflowSpecViewer";

// Components (for advanced composition)
export { SpecToolbar, type SpecToolbarProps } from "./SpecToolbar";
export { SpecCodePanel, type SpecCodePanelProps } from "./SpecCodePanel";

// Hooks
export { useSpecData, type SpecView, type UseSpecDataReturn } from "./hooks/useSpecData";
export { useSpecViewState, type UseSpecViewStateReturn } from "./hooks/useSpecViewState";
