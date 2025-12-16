/*
SPDX-FileCopyrightText: Copyright (c) 2025 NVIDIA CORPORATION & AFFILIATES. All rights reserved.

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.

SPDX-License-Identifier: Apache-2.0
*/
import { createEnv } from "@t3-oss/env-nextjs";
import { z } from "zod";

export const getBooleanEnvVar = (/** @type {string | undefined} */ value, defaultValue = false) => {
  return value === "true" ? true : value === "false" ? false : defaultValue;
};

// Helper function to compute environment based on the same logic as getEnvironment()
/**
 * @param {string} nodeEnv
 * @param {string} apiHostname
 * @returns {"mock" | "local" | "local-against-production" | "production"}
 */
const computeEnvironment = (nodeEnv, apiHostname) => {
  if (nodeEnv === "development") {
    return apiHostname.includes(":") ? "local" : "local-against-production";
  }

  return "production";
};

export const env = createEnv({
  /**
   * Specify your server-side environment variables schema here. This way you can ensure the app
   * isn't built with invalid env vars.
   */
  server: {
    AUTH_CLIENT_SECRET: z.string().optional().default(""),
    CLI_INSTALL_SCRIPT_URL: z.string().default("https://raw.githubusercontent.com/NVIDIA/OSMO/refs/heads/main/install.sh"),
    DOCS_BASE_URL: z.string().default("https://nvidia.github.io/OSMO/main/user_guide/"),
  },

  /**
   * Specify your client-side environment variables schema here. This way you can ensure the app
   * isn't built with invalid env vars. To expose them to the client, prefix them with
   * `NEXT_PUBLIC_`.
   */
  client: {
    NEXT_PUBLIC_WORKFLOW_REFETCH_INTERVAL: z.number().default(20),
    NEXT_PUBLIC_APP_NAME: z.string().default("OSMO"),
  },

  /**
   * Specify your shared environment variables here. These are variables that are used on both the
   * server and client side. This way you can ensure the app isn't built with invalid env vars. To
   * expose them to the client, prefix them with `NEXT_PUBLIC_`.
   */
  shared: {
    NODE_ENV: z.enum(["development", "test", "production"]),
    NEXT_PUBLIC_OSMO_API_HOSTNAME: z.string().default(""),
    NEXT_PUBLIC_OSMO_PORT_FORWARD_ENABLED: z.boolean().optional().default(false),
    NEXT_PUBLIC_OSMO_AUTH_HOSTNAME: z.string().default(""),
    NEXT_PUBLIC_OSMO_ENV: z.enum(["mock", "local", "local-against-production", "production"]),
    NEXT_PUBLIC_OSMO_SSL_ENABLED: z.boolean().optional().default(true),
    PORT: z.string().default("3000"),
  },

  /**
   * You can't destruct `process.env` as a regular object in the Next.js edge runtimes (e.g.
   * middlewares) or client-side, so we need to destruct manually.
   */
  runtimeEnv: {
    AUTH_CLIENT_SECRET: process.env.AUTH_CLIENT_SECRET,
    CLI_INSTALL_SCRIPT_URL: process.env.CLI_INSTALL_SCRIPT_URL,
    DOCS_BASE_URL: process.env.DOCS_BASE_URL,
    NODE_ENV: process.env.NODE_ENV,
    NEXT_PUBLIC_OSMO_API_HOSTNAME: process.env.NEXT_PUBLIC_OSMO_API_HOSTNAME,
    NEXT_PUBLIC_OSMO_PORT_FORWARD_ENABLED: getBooleanEnvVar(process.env.NEXT_PUBLIC_OSMO_PORT_FORWARD_ENABLED, false),
    NEXT_PUBLIC_OSMO_AUTH_HOSTNAME: process.env.NEXT_PUBLIC_OSMO_AUTH_HOSTNAME,
    NEXT_PUBLIC_OSMO_ENV: (() => {
      const nodeEnv = process.env.NODE_ENV || "development";
      const apiHostname = process.env.NEXT_PUBLIC_OSMO_API_HOSTNAME || "staging.osmo.nvidia.com";
      return computeEnvironment(nodeEnv, apiHostname);
    })(),
    NEXT_PUBLIC_OSMO_SSL_ENABLED: getBooleanEnvVar(process.env.NEXT_PUBLIC_OSMO_SSL_ENABLED, true),
    NEXT_PUBLIC_WORKFLOW_REFETCH_INTERVAL: process.env.NEXT_PUBLIC_WORKFLOW_REFETCH_INTERVAL,
    PORT: process.env.PORT,
    NEXT_PUBLIC_APP_NAME: process.env.NEXT_PUBLIC_APP_NAME,
  },

  /**
   * Run `build` or `dev` with `SKIP_ENV_VALIDATION` to skip env validation.
   * This is especially useful for Docker builds.
   */
  skipValidation: !!process.env.SKIP_ENV_VALIDATION,

  /**
   * Makes it so that empty strings are treated as undefined.
   * `SOME_VAR: z.string()` and `SOME_VAR=''` will throw an error.
   */
  emptyStringAsUndefined: true,
});
