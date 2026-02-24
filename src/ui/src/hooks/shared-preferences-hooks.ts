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

import { useHydratedStore } from "@/hooks/use-hydrated-store";
import {
  useSharedPreferences,
  initialState,
  type SharedPreferencesStore,
  type DisplayMode,
} from "@/stores/shared-preferences-store";

export function useDisplayMode(): DisplayMode {
  return useHydratedStore<SharedPreferencesStore, DisplayMode>(
    useSharedPreferences,
    (s) => s.displayMode,
    initialState.displayMode,
  );
}

export function useCompactMode(): boolean {
  return useHydratedStore<SharedPreferencesStore, boolean>(
    useSharedPreferences,
    (s) => s.compactMode,
    initialState.compactMode,
  );
}

export function useSidebarOpen(): boolean {
  return useHydratedStore<SharedPreferencesStore, boolean>(
    useSharedPreferences,
    (s) => s.sidebarOpen,
    initialState.sidebarOpen,
  );
}
