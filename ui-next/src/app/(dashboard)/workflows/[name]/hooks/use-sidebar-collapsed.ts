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
 * Hook for managing workflow details sidebar collapsed state.
 * Uses useLocalStorage from usehooks-ts for localStorage persistence.
 */

"use client";

import { useCallback } from "react";
import { useLocalStorage } from "usehooks-ts";

export function useSidebarCollapsed() {
  const [collapsed, setCollapsed] = useLocalStorage("osmo-workflow-details-sidebar-collapsed", false);

  const toggle = useCallback(() => {
    setCollapsed(!collapsed);
  }, [collapsed, setCollapsed]);

  const expand = useCallback(() => {
    setCollapsed(false);
  }, [setCollapsed]);

  const collapse = useCallback(() => {
    setCollapsed(true);
  }, [setCollapsed]);

  return {
    collapsed,
    toggle,
    expand,
    collapse,
  };
}
