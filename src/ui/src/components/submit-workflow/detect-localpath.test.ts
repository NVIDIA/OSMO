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
import { detectLocalpathUsage } from "@/components/submit-workflow/detect-localpath";

describe("detectLocalpathUsage", () => {
  // ── Early exit ───────────────────────────────────────────────────────────

  describe("early exit", () => {
    it("returns both false for empty string", () => {
      expect(detectLocalpathUsage("")).toEqual({
        hasFileLocalpath: false,
        hasDatasetLocalpath: false,
      });
    });

    it("returns both false when localpath: is absent", () => {
      const spec = [
        "workflow:",
        "  name: test",
        "  tasks:",
        "  - name: task1",
        "    files:",
        "    - path: /tmp/a.sh",
        "      contents: hello",
      ].join("\n");
      expect(detectLocalpathUsage(spec)).toEqual({
        hasFileLocalpath: false,
        hasDatasetLocalpath: false,
      });
    });

    it("returns both false when localpath appears without colon", () => {
      const spec = ["  files:", "  - path: /tmp/localpath_example"].join("\n");
      expect(detectLocalpathUsage(spec)).toEqual({
        hasFileLocalpath: false,
        hasDatasetLocalpath: false,
      });
    });
  });

  // ── hasFileLocalpath ─────────────────────────────────────────────────────

  describe("hasFileLocalpath", () => {
    describe("detects localpath: inside files block", () => {
      it("first key in list item", () => {
        const spec = ["  files:", "  - localpath: /home/user/data"].join("\n");
        expect(detectLocalpathUsage(spec).hasFileLocalpath).toBe(true);
      });

      it("subsequent key after path: in same list item", () => {
        const spec = ["  files:", "  - path: /tmp/a.sh", "    localpath: /home/user/a.sh"].join("\n");
        expect(detectLocalpathUsage(spec).hasFileLocalpath).toBe(true);
      });

      it("multiple intermediate lines between files: and localpath:", () => {
        const spec = [
          "    files:",
          "    - path: /tmp/a.sh",
          "      contents: |",
          "        #!/bin/bash",
          "        echo hello",
          "    - localpath: /home/user/b.sh",
        ].join("\n");
        expect(detectLocalpathUsage(spec).hasFileLocalpath).toBe(true);
      });

      it("blank lines between files: and localpath:", () => {
        const spec = ["  files:", "", "  - localpath: /path"].join("\n");
        expect(detectLocalpathUsage(spec).hasFileLocalpath).toBe(true);
      });

      it("whitespace-only blank lines between files: and localpath:", () => {
        const spec = ["  files:", "        ", "  - localpath: /path"].join("\n");
        expect(detectLocalpathUsage(spec).hasFileLocalpath).toBe(true);
      });

      it("deeply indented files block (6+ spaces)", () => {
        const spec = ["      files:", "      - localpath: /path"].join("\n");
        expect(detectLocalpathUsage(spec).hasFileLocalpath).toBe(true);
      });

      it("tab indentation", () => {
        const spec = ["\tfiles:", "\t- localpath: /path"].join("\n");
        expect(detectLocalpathUsage(spec).hasFileLocalpath).toBe(true);
      });

      it("mixed tab and space indentation", () => {
        const spec = ["\t files:", "\t - localpath: /path"].join("\n");
        expect(detectLocalpathUsage(spec).hasFileLocalpath).toBe(true);
      });
    });

    describe("ignores localpath: outside files block", () => {
      it("files: at column 0 (not indented)", () => {
        const spec = ["files:", "  - localpath: /path"].join("\n");
        expect(detectLocalpathUsage(spec).hasFileLocalpath).toBe(false);
      });

      it("localpath: in a value string", () => {
        const spec = ["  files:", "  - path: /tmp/localpath:test"].join("\n");
        expect(detectLocalpathUsage(spec).hasFileLocalpath).toBe(false);
      });

      it("localpath: after a non-list key exits the files block", () => {
        const spec = [
          "    files:",
          "    - path: /tmp/a.sh",
          "    command: [bash]",
          "    localpath: /should/not/match",
        ].join("\n");
        expect(detectLocalpathUsage(spec).hasFileLocalpath).toBe(false);
      });

      it("files: with inline value", () => {
        const spec = ["  files: []", "  localpath: /path"].join("\n");
        expect(detectLocalpathUsage(spec).hasFileLocalpath).toBe(false);
      });

      it("localpath: before files: in spec", () => {
        const spec = ["  localpath: /path", "  files:", "  - path: /tmp/a.sh"].join("\n");
        expect(detectLocalpathUsage(spec).hasFileLocalpath).toBe(false);
      });
    });
  });

  // ── hasDatasetLocalpath ──────────────────────────────────────────────────

  describe("hasDatasetLocalpath", () => {
    describe("detects localpath: inside dataset block", () => {
      it("directly under dataset:", () => {
        const spec = ["  - dataset:", "      localpath: /data"].join("\n");
        expect(detectLocalpathUsage(spec).hasDatasetLocalpath).toBe(true);
      });

      it("after sibling key name: under dataset:", () => {
        const spec = ["  - dataset:", "      name: my-ds", "      localpath: /data"].join("\n");
        expect(detectLocalpathUsage(spec).hasDatasetLocalpath).toBe(true);
      });

      it("dataset: without list dash", () => {
        const spec = ["  dataset:", "    localpath: /data"].join("\n");
        expect(detectLocalpathUsage(spec).hasDatasetLocalpath).toBe(true);
      });

      it("dataset: at column 0", () => {
        const spec = ["dataset:", "  localpath: /data"].join("\n");
        expect(detectLocalpathUsage(spec).hasDatasetLocalpath).toBe(true);
      });
    });

    describe("ignores localpath: outside dataset block", () => {
      it("dataset: with no localpath: child", () => {
        const spec = ["  - dataset:", "      name: my-ds"].join("\n");
        expect(detectLocalpathUsage(spec)).toEqual({
          hasFileLocalpath: false,
          hasDatasetLocalpath: false,
        });
      });

      it("localpath: in unrelated block", () => {
        const spec = ["  - dataset:", "      name: my-ds", "  other:", "    localpath: /should/not/match"].join("\n");
        expect(detectLocalpathUsage(spec).hasDatasetLocalpath).toBe(false);
      });
    });
  });

  // ── Context tracking ─────────────────────────────────────────────────────

  describe("context tracking", () => {
    it("non-list key at same indent as files: exits context", () => {
      const spec = [
        "    files:",
        "    - path: /tmp/a.sh",
        "    command: [bash]",
        "    localpath: /should/not/match",
      ].join("\n");
      expect(detectLocalpathUsage(spec).hasFileLocalpath).toBe(false);
    });

    it("line at lesser indent exits context", () => {
      const spec = ["    files:", "    - path: /tmp/a.sh", "  image: ubuntu", "    localpath: /should/not/match"].join(
        "\n",
      );
      expect(detectLocalpathUsage(spec).hasFileLocalpath).toBe(false);
    });

    it("list item at same indent stays in context", () => {
      const spec = ["    files:", "    - path: /tmp/a.sh", "    - localpath: /should/match"].join("\n");
      expect(detectLocalpathUsage(spec).hasFileLocalpath).toBe(true);
    });

    it("new files: block replaces previous context", () => {
      const spec = [
        "    files:",
        "    - path: /tmp/a.sh",
        "    command: [bash]",
        "    files:",
        "    - localpath: /path",
      ].join("\n");
      expect(detectLocalpathUsage(spec).hasFileLocalpath).toBe(true);
    });

    it("detects both warnings in same spec", () => {
      const spec = ["  files:", "  - localpath: /file", "  inputs:", "  - dataset:", "      localpath: /data"].join(
        "\n",
      );
      expect(detectLocalpathUsage(spec)).toEqual({
        hasFileLocalpath: true,
        hasDatasetLocalpath: true,
      });
    });

    it("dataset context replaces files context", () => {
      const spec = ["  files:", "  - path: /tmp/a.sh", "  - dataset:", "      localpath: /data"].join("\n");
      const result = detectLocalpathUsage(spec);
      expect(result.hasFileLocalpath).toBe(false);
      expect(result.hasDatasetLocalpath).toBe(true);
    });
  });

  // ── Performance ──────────────────────────────────────────────────────────

  describe("performance", () => {
    it("10,000-line spec without localpath: completes in under 50ms", () => {
      const lines = ["workflow:", "  name: test", "  tasks:"];
      for (let i = 0; i < 10_000; i++) {
        lines.push(`  - name: task-${i}`);
        lines.push("    image: ubuntu");
        lines.push("    files:");
        lines.push("    - path: /tmp/test.sh");
        lines.push("      contents: |");
        lines.push("        #!/bin/bash");
        lines.push("        echo hello");
        lines.push("        ");
      }
      const spec = lines.join("\n");

      const start = performance.now();
      const result = detectLocalpathUsage(spec);
      const elapsed = performance.now() - start;

      expect(result).toEqual({ hasFileLocalpath: false, hasDatasetLocalpath: false });
      expect(elapsed).toBeLessThan(50);
    });
  });
});
