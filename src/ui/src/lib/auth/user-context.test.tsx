// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
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

import { afterEach, describe, expect, it } from "vitest";

import { getLogoutUrl } from "@/lib/auth/user-context";

describe("getLogoutUrl", () => {
  const originalBasePath = process.env.NEXT_PUBLIC_BASE_PATH;

  afterEach(() => {
    if (originalBasePath === undefined) {
      delete process.env.NEXT_PUBLIC_BASE_PATH;
    } else {
      process.env.NEXT_PUBLIC_BASE_PATH = originalBasePath;
    }
    window.history.replaceState(null, "", "/");
  });

  it("returns the gateway sign-out path", () => {
    delete process.env.NEXT_PUBLIC_BASE_PATH;

    expect(getLogoutUrl()).toBe("/signout");
  });

  it("ignores the configured base path because sign out is routed at the gateway root", () => {
    process.env.NEXT_PUBLIC_BASE_PATH = "/v2";

    expect(getLogoutUrl()).toBe("/signout");
  });

  it("ignores the detected base path because sign out is routed at the gateway root", () => {
    delete process.env.NEXT_PUBLIC_BASE_PATH;
    window.history.replaceState(null, "", "/v2/workflows");

    expect(getLogoutUrl()).toBe("/signout");
  });
});
