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

import { describe, it, expect, beforeEach } from "vitest";
import { parseEventLine, resetEventIdCounter } from "@/lib/api/adapter/events/events-parser";

describe("events-parser", () => {
  beforeEach(() => {
    resetEventIdCounter();
  });

  describe("retry_id extraction", () => {
    it("should parse retry_id=0 for tasks without retry suffix", () => {
      const line = "2026-02-12 08:38:57+00:00 [worker_27] Created: Created container worker-27";
      const event = parseEventLine(line);

      expect(event).toBeDefined();
      expect(event?.entity).toBe("worker_27");
      expect(event?.taskName).toBe("worker_27");
      expect(event?.retryId).toBe(0);
    });

    it("should parse retry_id from retry-N suffix", () => {
      const line = "2026-02-12 08:38:57+00:00 [worker_27 retry-2] Created: Created container worker-27";
      const event = parseEventLine(line);

      expect(event).toBeDefined();
      expect(event?.entity).toBe("worker_27 retry-2");
      expect(event?.taskName).toBe("worker_27");
      expect(event?.retryId).toBe(2);
    });

    it("should handle retry_id=1", () => {
      const line = "2026-02-12 08:38:57+00:00 [worker_27 retry-1] Started: Started container";
      const event = parseEventLine(line);

      expect(event).toBeDefined();
      expect(event?.entity).toBe("worker_27 retry-1");
      expect(event?.taskName).toBe("worker_27");
      expect(event?.retryId).toBe(1);
    });

    it("should handle high retry numbers", () => {
      const line = "2026-02-12 08:38:57+00:00 [worker_27 retry-99] Failed: Container failed";
      const event = parseEventLine(line);

      expect(event).toBeDefined();
      expect(event?.entity).toBe("worker_27 retry-99");
      expect(event?.taskName).toBe("worker_27");
      expect(event?.retryId).toBe(99);
    });

    it("should handle task names with underscores and numbers", () => {
      const line = "2026-02-12 08:38:57+00:00 [my_task_123] Created: Container created";
      const event = parseEventLine(line);

      expect(event).toBeDefined();
      expect(event?.entity).toBe("my_task_123");
      expect(event?.taskName).toBe("my_task_123");
      expect(event?.retryId).toBe(0);
    });

    it("should handle task names with underscores and retry suffix", () => {
      const line = "2026-02-12 08:38:57+00:00 [my_task_123 retry-5] Created: Container created";
      const event = parseEventLine(line);

      expect(event).toBeDefined();
      expect(event?.entity).toBe("my_task_123 retry-5");
      expect(event?.taskName).toBe("my_task_123");
      expect(event?.retryId).toBe(5);
    });
  });

  describe("basic parsing", () => {
    it("should parse valid event line", () => {
      const line = "2026-02-12 08:38:57+00:00 [worker_27] Created: Created container worker-27";
      const event = parseEventLine(line);

      expect(event).toBeDefined();
      expect(event?.timestamp).toBeInstanceOf(Date);
      expect(event?.entity).toBe("worker_27");
      expect(event?.reason).toBe("Created");
      expect(event?.message).toBe("Created container worker-27");
    });

    it("should return null for empty line", () => {
      const event = parseEventLine("");
      expect(event).toBeNull();
    });

    it("should return null for malformed line", () => {
      const event = parseEventLine("not a valid event line");
      expect(event).toBeNull();
    });
  });
});
