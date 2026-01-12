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
 * Contexts
 *
 * Dependency injection contexts for the application.
 *
 * - ConfigContext: Application-wide configuration (table heights, panel sizes, etc.)
 * - ServiceContext: Cross-cutting services (clipboard, announcer)
 *
 * These contexts enable:
 * 1. Testability - Override dependencies in tests
 * 2. Flexibility - Different configs per section if needed
 * 3. Discoverability - Single source for configuration
 */

// =============================================================================
// Config Context
// =============================================================================

export {
  ConfigContext,
  ConfigProvider,
  useConfig,
  defaultConfig,
  type AppConfig,
  type TableConfig,
  type PanelConfig,
  type ViewportConfig,
  type TimingConfig,
  type ConfigProviderProps,
} from "./config-context";

// =============================================================================
// Service Context
// =============================================================================

export {
  ServiceContext,
  ServiceProvider,
  useServices,
  type Services,
  type ClipboardService,
  type AnnouncerService,
  type AnnouncerPoliteness,
  type ServiceProviderProps,
} from "./service-context";
