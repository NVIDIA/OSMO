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

"use client";

import { useMemo, useCallback } from "react";
import { useNavigationRouter } from "@/hooks/use-navigation-router";

/** Matches workflow names ending with a dash and a number, e.g. "my-workflow-5" */
const SEQUENCE_PATTERN = /^(.+-)(\d+)$/;

export interface SequenceNav {
  /** Navigate to the previous workflow in the sequence */
  onPrevious: () => void;
  /** Navigate to the next workflow in the sequence */
  onNext: () => void;
  /** Whether the previous button should be disabled (at #1) */
  hasPrevious: boolean;
}

/**
 * Parses a sequential workflow name (e.g. "my-workflow-5") and provides
 * navigation to the previous/next workflow in the sequence.
 *
 * Returns null if the workflow name doesn't match the pattern.
 */
export function useWorkflowSequenceNav(workflowName: string): SequenceNav | null {
  const router = useNavigationRouter();

  const parsed = useMemo(() => {
    const match = SEQUENCE_PATTERN.exec(workflowName);
    if (!match) return null;
    return { prefix: match[1], number: parseInt(match[2], 10) };
  }, [workflowName]);

  const onPrevious = useCallback(() => {
    if (!parsed || parsed.number <= 1) return;
    router.push(`/workflows/${encodeURIComponent(parsed.prefix + (parsed.number - 1))}`);
  }, [parsed, router]);

  const onNext = useCallback(() => {
    if (!parsed) return;
    router.push(`/workflows/${encodeURIComponent(parsed.prefix + (parsed.number + 1))}`);
  }, [parsed, router]);

  if (!parsed) return null;

  return {
    onPrevious,
    onNext,
    hasPrevious: parsed.number > 1,
  };
}
