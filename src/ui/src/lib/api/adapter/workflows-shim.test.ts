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

import { describe, expect, it } from "vitest";
import { buildWorkflowApiParams, buildWorkflowsQueryKey } from "@/lib/api/adapter/workflows-shim";
import { getListWorkflowApiWorkflowGetUrl, getSubmitWorkflowApiPoolPoolNameWorkflowPostUrl } from "@/lib/api/generated";

const chips = [
  { field: "label", value: "team=robotics", label: "label: team=robotics" },
  { field: "label", value: "run=42", label: "label: run=42" },
  { field: "no_label", value: "deprecated", label: "no-label: deprecated" },
];

describe("workflow label filters", () => {
  it("maps chips to repeatable backend query parameters", () => {
    expect(buildWorkflowApiParams(chips, false, 0, 50, "DESC")).toMatchObject({
      label: ["team=robotics", "run=42"],
      no_label: ["deprecated"],
    });
  });

  it("keeps label selectors in the stable query key", () => {
    expect(buildWorkflowsQueryKey(chips, false, "DESC")).toEqual([
      "workflows",
      "paginated",
      {
        labels: ["run=42", "team=robotics"],
        missingLabels: ["deprecated"],
        showAllUsers: false,
        sortDirection: "DESC",
      },
    ]);
  });

  it("serializes repeated list and submit labels as separate query values", () => {
    const listUrl = new URL(
      getListWorkflowApiWorkflowGetUrl({ label: ["team=robotics", "run=42"] }),
      "https://osmo.invalid",
    );
    const submitUrl = new URL(
      getSubmitWorkflowApiPoolPoolNameWorkflowPostUrl("pool-a", {
        label: ["team=robotics", "run=42"],
      }),
      "https://osmo.invalid",
    );

    expect(listUrl.searchParams.getAll("label")).toEqual(["team=robotics", "run=42"]);
    expect(submitUrl.searchParams.getAll("label")).toEqual(["team=robotics", "run=42"]);
  });

  it("forwards wildcard alternatives and inline alternatives unchanged", () => {
    const selectors = ["PPP=(team_*|osmo_*)", "PPP=team_(a|b)"];
    const selectorChips = selectors.map((selector) => ({
      field: "label",
      value: selector,
      label: `label: ${selector}`,
    }));

    expect(buildWorkflowApiParams(selectorChips, true, 0, 50, "DESC").label).toEqual(selectors);

    const listUrl = new URL(getListWorkflowApiWorkflowGetUrl({ label: selectors }), "https://osmo.invalid");
    expect(listUrl.searchParams.getAll("label")).toEqual(selectors);
    expect(buildWorkflowsQueryKey(selectorChips, true, "DESC")).toEqual([
      "workflows",
      "paginated",
      {
        labels: ["PPP=(team_*|osmo_*)", "PPP=team_(a|b)"],
        showAllUsers: true,
        sortDirection: "DESC",
      },
    ]);
  });
});
