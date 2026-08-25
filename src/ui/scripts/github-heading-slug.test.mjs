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

import assert from "node:assert/strict";
import { test } from "node:test";

// eslint-disable-next-line no-restricted-imports -- Node tests cannot use the UI's @ alias.
import { githubHeadingSlug } from "./github-heading-slug.mjs";

const cases = [
  ["Apache-2.0 (6 packages)", "apache-20-6-packages"],
  ["CC-BY-4.0 (1 packages)", "cc-by-40-1-packages"],
  ["MIT OR Apache-2.0 (1 packages)", "mit-or-apache-20-1-packages"],
  ["GPL-2.0+ (1 packages)", "gpl-20-1-packages"],
  ["License/Foo (1 packages)", "licensefoo-1-packages"],
  ["License (with exception) (1 packages)", "license-with-exception-1-packages"],
];

for (const [heading, expected] of cases) {
  test(`matches GitHub's anchor for ${heading}`, () => {
    assert.equal(githubHeadingSlug(heading), expected);
  });
}
