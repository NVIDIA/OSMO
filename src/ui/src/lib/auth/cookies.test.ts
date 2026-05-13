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

import { beforeEach, describe, expect, it } from "vitest";

import { getCookie, updateALBCookies } from "@/lib/auth/cookies";

function clearCookies() {
  for (const cookie of document.cookie.split(";")) {
    const name = cookie.trim().split("=")[0];
    if (name) {
      document.cookie = `${name}=; Max-Age=0; Path=/`;
    }
  }
}

describe("updateALBCookies", () => {
  beforeEach(() => {
    clearCookies();
  });

  it("sets a single Envoy router affinity cookie", () => {
    updateALBCookies("_osmo_router_affinity=abc123; Path=/; SameSite=Lax; Secure");

    expect(getCookie("_osmo_router_affinity")).toBe("abc123");
  });

  it("keeps setting two ALB cookies", () => {
    updateALBCookies("AWSALB=primary; Path=/, AWSALBCORS=cors; Path=/; SameSite=None; Secure");

    expect(getCookie("AWSALB")).toBe("primary");
    expect(getCookie("AWSALBCORS")).toBe("cors");
  });
});
