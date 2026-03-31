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

import { faker } from "@faker-js/faker";
import { HttpResponse, delay } from "msw";
import { MOCK_CONFIG } from "@/mocks/seed/types";
import { hashString, getMockDelay } from "@/mocks/utils";
import { BUCKET_NAMES } from "@/mocks/generators/bucket-generator";
import type { ProfileResponse, CredentialGetResponse } from "@/lib/api/generated";

const BASE_SEED = 66666;

export class ProfileGenerator {
  private settings: {
    email_notification?: boolean;
    slack_notification?: boolean;
    bucket?: string;
    pool?: string;
  } = {};

  private credentials = new Map<string, Record<string, string>>();

  generateProfile(username?: string) {
    faker.seed(BASE_SEED + (username ? hashString(username) : 0));

    const user = username ?? faker.helpers.arrayElement(MOCK_CONFIG.workflows.users);
    const [first = user, last = ""] = user.split(".");
    const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

    return {
      username: user,
      email: `${user}@example.com`,
      display_name: `${capitalize(first)} ${capitalize(last)}`.trim(),
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

  generateSettings(username?: string) {
    faker.seed(BASE_SEED + (username ? hashString(username) : 0) + 1000);

    return {
      default_pool: faker.helpers.arrayElement(MOCK_CONFIG.pools.names),
      default_bucket: faker.helpers.arrayElement(BUCKET_NAMES),
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
      api_keys: Array.from({ length: faker.number.int({ min: 0, max: 3 }) }, () => ({
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
      })),
    };
  }

  generateCredentials(count: number = 5) {
    faker.seed(BASE_SEED + 2000);

    const types = ["REGISTRY", "DATA", "GENERIC"] as const;
    const minCount = Math.max(count, types.length);

    return Array.from({ length: minCount }, (_, i) => {
      const cred_type = i < types.length ? types[i] : faker.helpers.arrayElement(types);
      const baseName = faker.helpers.arrayElement([
        "my-ngc-cred",
        "docker-hub-cred",
        "s3-data-cred",
        "azure-storage-cred",
        "api-token",
        "ssh-key",
        "github-token",
      ]);

      const profile =
        cred_type === "REGISTRY"
          ? faker.helpers.arrayElement(["nvcr.io", "docker.io", "ghcr.io", "quay.io"])
          : cred_type === "DATA"
            ? `s3://${faker.location.countryCode().toLowerCase()}-bucket-${i}`
            : "";

      return { cred_name: `${baseName}-${i}`, cred_type, profile };
    });
  }

  handleGetSettings = async (): Promise<ProfileResponse> => {
    await delay(getMockDelay());

    const userProfile = this.generateProfile("current.user");
    const settings = this.generateSettings("current.user");
    const pools = MOCK_CONFIG.pools.names;

    const emailNotification = this.settings.email_notification ?? settings.notifications.email;
    const slackNotification = this.settings.slack_notification ?? settings.notifications.slack;
    const defaultBucket = this.settings.bucket ?? settings.default_bucket;
    const defaultPool = this.settings.pool ?? settings.default_pool;

    const accessiblePools = pools.includes(defaultPool) ? pools : [defaultPool, ...pools];

    return {
      profile: {
        username: userProfile.email,
        email_notification: emailNotification,
        slack_notification: slackNotification,
        bucket: defaultBucket,
        pool: defaultPool,
      },
      roles: [],
      pools: accessiblePools,
    };
  };

  handlePostSettings = async ({ request }: { request: Request }): Promise<Response> => {
    await delay(getMockDelay());

    const body = (await request.json()) as Record<string, unknown>;
    if ("email_notification" in body) this.settings.email_notification = body.email_notification as boolean;
    if ("slack_notification" in body) this.settings.slack_notification = body.slack_notification as boolean;
    if ("bucket" in body) this.settings.bucket = body.bucket as string;
    if ("pool" in body) this.settings.pool = body.pool as string;

    return HttpResponse.json({ ...body, updated_at: new Date().toISOString() });
  };

  handleGetCredentials = async (): Promise<CredentialGetResponse> => {
    await delay(getMockDelay());

    if (this.credentials.size > 0) {
      return { credentials: Array.from(this.credentials.values()) };
    }

    const creds = this.generateCredentials(5);
    for (const cred of creds) {
      this.credentials.set(cred.cred_name, cred);
    }
    return { credentials: Array.from(this.credentials.values()) };
  };

  handlePostCredential = async ({
    params,
    request,
  }: {
    params: Record<string, string | readonly string[] | undefined>;
    request: Request;
  }): Promise<Response> => {
    await delay(getMockDelay());

    const name = String(params.name);
    const body = (await request.json()) as Record<string, unknown>;

    let cred_type: "REGISTRY" | "DATA" | "GENERIC" = "GENERIC";
    let profile = "";

    if (body.registry_credential && typeof body.registry_credential === "object") {
      cred_type = "REGISTRY";
      profile = String((body.registry_credential as Record<string, unknown>).registry ?? "");
    } else if (body.data_credential && typeof body.data_credential === "object") {
      cred_type = "DATA";
      profile = String((body.data_credential as Record<string, unknown>).endpoint ?? "");
    }

    const credential = { cred_name: name, cred_type, profile };
    this.credentials.set(name, credential);
    return HttpResponse.json(credential);
  };

  handleDeleteCredential = async ({
    params,
  }: {
    params: Record<string, string | readonly string[] | undefined>;
  }): Promise<CredentialGetResponse> => {
    await delay(getMockDelay());
    this.credentials.delete(String(params.credName));
    return { credentials: Array.from(this.credentials.values()) };
  };
}

export const profileGenerator = new ProfileGenerator();
