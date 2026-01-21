//SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
//
//Licensed under the Apache License, Version 2.0 (the "License");
//you may not use this file except in compliance with the License.
//You may obtain a copy of the License at
//
//http://www.apache.org/licenses/LICENSE-2.0
//
//Unless required by applicable law or agreed to in writing, software
//distributed under the License is distributed on an "AS IS" BASIS,
//WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
//See the License for the specific language governing permissions and
//limitations under the License.
//
//SPDX-License-Identifier: Apache-2.0
import { serviceConfigSchema } from "../ServiceConfigEditor";

const baseValidConfig = {
  changeDescription: "Update service config",
  tags: ["release", "prod"],
  service_base_url: "https://service.example.com",
  max_pod_restart_limit: "15m",
  agent_queue_size: "10",
  max_token_duration: "24h",
  latest_version: "1.2.3",
  min_supported_version: "1.0.0.96df7749",
  issuer: "https://issuer.example.com",
  audience: "example-audience",
  user_roles: "admin, user",
  ctrl_roles: "",
  device_client_id: "device-client",
  browser_client_id: "browser-client",
  device_endpoint: "https://auth.example.com/device",
  browser_endpoint: "https://auth.example.com/browser",
  token_endpoint: "https://auth.example.com/token",
  logout_endpoint: "https://auth.example.com/logout",
};

const validateConfig = async (overrides: Partial<typeof baseValidConfig> = {}) => {
  return await serviceConfigSchema.validate(
    {
      ...baseValidConfig,
      ...overrides,
    },
    { abortEarly: false },
  );
};

describe("serviceConfigSchema", () => {
  it("accepts a valid config", async () => {
    await expect(serviceConfigSchema.isValid(baseValidConfig)).resolves.toBe(true);
  });

  it("rejects invalid URLs", async () => {
    await expect(
      validateConfig({
        service_base_url: "not a url",
      }),
    ).rejects.toThrow("Service Base URL must be a valid URL");
    await expect(
      validateConfig({
        device_endpoint: "http://",
      }),
    ).rejects.toThrow("Device Endpoint must be a valid URL");
  });

  it("accepts URLs with query strings and ports", async () => {
    await expect(
      serviceConfigSchema.isValid({
        ...baseValidConfig,
        service_base_url: "https://service.example.com:8443/api?env=prod",
        token_endpoint: "https://auth.example.com:9443/token?grant=client_credentials",
      }),
    ).resolves.toBe(true);
  });

  it("rejects empty user roles", async () => {
    await expect(
      validateConfig({
        user_roles: "",
      }),
    ).rejects.toMatchObject({
      errors: expect.arrayContaining(["User Roles is required", "User Roles must include at least one role"]),
    });
    await expect(
      validateConfig({
        user_roles: " , ",
      }),
    ).rejects.toMatchObject({
      errors: expect.arrayContaining(["User Roles must include at least one role"]),
    });
  });

  it("trims and normalizes user roles", async () => {
    const validated = await validateConfig({
      user_roles: " admin , user ,  ",
    });
    expect(validated.user_roles).toBe("admin , user ,");
  });

  it("validates agent queue size as a whole number", async () => {
    await expect(
      validateConfig({
        agent_queue_size: "10",
      }),
    ).resolves.toBeTruthy();
    await expect(
      validateConfig({
        agent_queue_size: "10.5",
      }),
    ).rejects.toThrow("Agent Queue Size must be a whole number");
  });

  it("rejects agent queue size with whitespace or signs", async () => {
    await expect(
      validateConfig({
        agent_queue_size: " 10",
      }),
    ).rejects.toThrow("Agent Queue Size must be a whole number");
    await expect(
      validateConfig({
        agent_queue_size: "+10",
      }),
    ).rejects.toThrow("Agent Queue Size must be a whole number");
  });

  it("accepts valid duration formats", async () => {
    const validDurations = ["1d", "2h", "30m", "15s", "500ms", "250us", "0s"];

    for (const duration of validDurations) {
      await expect(
        serviceConfigSchema.isValid({
          ...baseValidConfig,
          max_pod_restart_limit: duration,
        }),
      ).resolves.toBe(true);
      await expect(
        serviceConfigSchema.isValid({
          ...baseValidConfig,
          max_token_duration: duration,
        }),
      ).resolves.toBe(true);
    }
  });

  it("rejects invalid duration formats", async () => {
    const invalidDurations = ["1", "1w", "1.5s", "-1s", "1msm", "1s2"];

    for (const duration of invalidDurations) {
      await expect(
        serviceConfigSchema.isValid({
          ...baseValidConfig,
          max_pod_restart_limit: duration,
        }),
      ).resolves.toBe(false);
      await expect(
        serviceConfigSchema.isValid({
          ...baseValidConfig,
          max_token_duration: duration,
        }),
      ).resolves.toBe(false);
    }
  });

  it("accepts durations with leading or trailing whitespace after trimming", async () => {
    await expect(
      serviceConfigSchema.isValid({
        ...baseValidConfig,
        max_pod_restart_limit: " 1h",
      }),
    ).resolves.toBe(true);
  });

  it("accepts valid version strings", async () => {
    const validVersions = ["1.2.3", "1.2.3-rc1", "1.0.0.96df7749"];

    for (const version of validVersions) {
      await expect(
        serviceConfigSchema.isValid({
          ...baseValidConfig,
          latest_version: version,
          min_supported_version: version,
        }),
      ).resolves.toBe(true);
    }
  });

  it("rejects invalid version strings", async () => {
    const invalidVersions = ["1.2", "v1.2.3", "1.2.3.", "1.2.3+build"];

    for (const version of invalidVersions) {
      await expect(
        serviceConfigSchema.isValid({
          ...baseValidConfig,
          latest_version: version,
        }),
      ).resolves.toBe(false);
      await expect(
        serviceConfigSchema.isValid({
          ...baseValidConfig,
          min_supported_version: version,
        }),
      ).resolves.toBe(false);
    }
  });

  it("rejects missing required fields", async () => {
    await expect(
      serviceConfigSchema.isValid({
        ...baseValidConfig,
        service_base_url: "",
      }),
    ).resolves.toBe(false);
    await expect(
      serviceConfigSchema.isValid({
        ...baseValidConfig,
        issuer: "",
      }),
    ).resolves.toBe(false);
  });
});

