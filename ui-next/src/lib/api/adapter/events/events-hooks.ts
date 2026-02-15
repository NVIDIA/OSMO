//SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION. All rights reserved.

//Licensed under the Apache License, Version 2.0 (the "License");
//you may not use this file except in compliance with the License.
//You may obtain a copy of the License at

//http://www.apache.org/licenses/LICENSE-2.0

//Unless required by applicable law or agreed to in writing, software
//distributed under the License is distributed on an "AS IS" BASIS,
//WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
//See the License for the specific language governing permissions and
//limitations under the License.

//SPDX-License-Identifier: Apache-2.0

/**
 * @deprecated Use {@link useEventStream} from `use-event-stream.ts` instead.
 *
 * This hook used `customFetch` which calls `await response.text()`, blocking
 * forever on active workflows whose event endpoint streams via Redis XREAD.
 *
 * `useEventStream` uses `ReadableStream` + RAF batching and handles both
 * active (never-ending) and completed (finite) workflows correctly.
 */

export { useEventStream } from "@/lib/api/adapter/events/use-event-stream";
export type {
  UseEventStreamParams,
  UseEventStreamReturn,
  EventStreamPhase,
} from "@/lib/api/adapter/events/use-event-stream";
