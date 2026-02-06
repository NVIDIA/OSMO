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
 * Profile Generator
 *
 * Generates user profile and settings data.
 */

import { faker } from "@faker-js/faker";
import { MOCK_CONFIG } from "../seed/types";
import { hashString } from "../utils";

// ============================================================================
// Types
// ============================================================================

export interface GeneratedProfile {
  username: string;
  email: string;
  display_name: string;
  avatar_url?: string;
  created_at: string;
  last_login: string;
  roles: string[];
  teams: string[];
}

export interface GeneratedProfileSettings {
  default_pool: string | null;
  default_bucket: string | null;
  default_priority: string;
  notifications: {
    email: boolean;
    slack: boolean;
    webhook_url?: string;
  };
  ui_preferences: {
    theme: "light" | "dark" | "system";
    workflows_per_page: number;
    show_completed: boolean;
    auto_refresh: boolean;
    refresh_interval: number;
  };
  api_keys: GeneratedApiKey[];
}

export interface GeneratedApiKey {
  id: string;
  name: string;
  prefix: string;
  created_at: string;
  last_used?: string;
  expires_at?: string;
}

// ============================================================================
// Generator Class
// ============================================================================

export class ProfileGenerator {
  private baseSeed: number;

  constructor(baseSeed: number = 66666) {
    this.baseSeed = baseSeed;
  }

  /**
   * Generate a user profile
   */
  generateProfile(username?: string): GeneratedProfile {
    faker.seed(this.baseSeed + (username ? hashString(username) : 0));

    const user = username || faker.helpers.arrayElement(MOCK_CONFIG.workflows.users);
    const firstName = user.split(".")[0] || user;
    const lastName = user.split(".")[1] || "";

    return {
      username: user,
      email: `${user}@nvidia.com`,
      display_name: `${this.capitalize(firstName)} ${this.capitalize(lastName)}`.trim(),
      avatar_url: `https://api.dicebear.com/7.x/initials/svg?seed=${user}`,
      created_at: faker.date.past({ years: 3 }).toISOString(),
      last_login: faker.date.recent({ days: 7 }).toISOString(),
      roles: faker.helpers.arrayElements(["user", "admin", "viewer"], { min: 1, max: 2 }),
      teams: faker.helpers.arrayElements(["ml-platform", "training", "inference", "research", "sre"], {
        min: 1,
        max: 3,
      }),
    };
  }

  /**
   * Generate user settings
   */
  generateSettings(username?: string): GeneratedProfileSettings {
    faker.seed(this.baseSeed + (username ? hashString(username) : 0) + 1000);

    const pools = MOCK_CONFIG.pools.names;

    return {
      default_pool: faker.datatype.boolean({ probability: 0.7 }) ? faker.helpers.arrayElement(pools) : null,
      default_bucket: faker.datatype.boolean({ probability: 0.6 })
        ? faker.helpers.arrayElement(["osmo-artifacts", "osmo-checkpoints"])
        : null,
      default_priority: "NORMAL",
      notifications: {
        email: faker.datatype.boolean({ probability: 0.8 }),
        slack: faker.datatype.boolean({ probability: 0.5 }),
        webhook_url: faker.datatype.boolean({ probability: 0.2 })
          ? `https://hooks.slack.com/services/${faker.string.alphanumeric(20)}`
          : undefined,
      },
      ui_preferences: {
        theme: faker.helpers.arrayElement(["light", "dark", "system"]),
        workflows_per_page: faker.helpers.arrayElement([20, 50, 100]),
        show_completed: true,
        auto_refresh: true,
        refresh_interval: faker.helpers.arrayElement([5, 10, 30, 60]),
      },
      api_keys: this.generateApiKeys(faker.number.int({ min: 0, max: 3 })),
    };
  }

  /**
   * Generate API keys
   */
  generateApiKeys(count: number): GeneratedApiKey[] {
    const keys: GeneratedApiKey[] = [];

    for (let i = 0; i < count; i++) {
      keys.push({
        id: faker.string.uuid(),
        name: faker.helpers.arrayElement([
          "CI Pipeline",
          "Local Dev",
          "Jupyter Notebook",
          "VS Code Extension",
          "CLI Tool",
        ]),
        prefix: `osmo_${faker.string.alphanumeric(8)}`,
        created_at: faker.date.past({ years: 1 }).toISOString(),
        last_used: faker.datatype.boolean({ probability: 0.7 })
          ? faker.date.recent({ days: 30 }).toISOString()
          : undefined,
        expires_at: faker.datatype.boolean({ probability: 0.3 })
          ? faker.date.future({ years: 1 }).toISOString()
          : undefined,
      });
    }

    return keys;
  }

  private capitalize(str: string): string {
    return str.charAt(0).toUpperCase() + str.slice(1);
  }
}

// ============================================================================
// Singleton instance
// ============================================================================

export const profileGenerator = new ProfileGenerator();
