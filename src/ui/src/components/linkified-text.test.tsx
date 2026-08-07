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

import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { LinkifiedText } from "@/components/linkified-text";

describe("LinkifiedText", () => {
  it("turns an embedded URL into a safe external link", () => {
    const html = renderToStaticMarkup(
      <LinkifiedText text="Look up valid PPP values at https://aihub.nvidia.com/home." />,
    );
    // URL is a real anchor with the exact href (trailing sentence period excluded)
    expect(html).toContain('href="https://aihub.nvidia.com/home"');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
    // surrounding text is preserved as text
    expect(html).toContain("Look up valid PPP values at");
  });

  it("leaves the trailing period outside the link", () => {
    const html = renderToStaticMarkup(<LinkifiedText text="See https://aihub.nvidia.com/home." />);
    expect(html).toContain("</a>.");
    expect(html).not.toContain('href="https://aihub.nvidia.com/home."');
  });

  it("renders plain text without any links unchanged", () => {
    const html = renderToStaticMarkup(<LinkifiedText text="No links in this message" />);
    expect(html).not.toContain("<a ");
    expect(html).toContain("No links in this message");
  });
});
