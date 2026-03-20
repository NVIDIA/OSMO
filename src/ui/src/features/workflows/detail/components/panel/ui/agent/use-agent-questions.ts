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

import { useMemo, useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

// =============================================================================
// Types
// =============================================================================

interface AgentAnswer {
  key: string;
  comment: string;
  at: string;
}

export interface AgentQuestion {
  id: string;
  status: "pending" | "answered";
  asked: string;
  subtask: string;
  context: string;
  question: string;
  options: string[];
  answer: AgentAnswer | null;
}

interface QuestionsIndex {
  questions: string[];
}

// =============================================================================
// Constants
// =============================================================================

const AGENT_QUESTIONS_BASE_KEY = "agent-questions";
const POLL_INTERVAL_MS = 5_000;

/**
 * S3 base URL for agent questions. In production, this would come from
 * service configuration. For the POC, it reads from the environment
 * variable or falls back to localhost.
 */
function getS3BaseUrl(): string {
  if (typeof window !== "undefined") {
    // Check for a global override (useful for dev/testing)
    const win = window as unknown as Record<string, unknown>;
    const globalOverride = win.__OSMO_AGENT_S3_BASE_URL__;
    if (typeof globalOverride === "string") return globalOverride;
  }
  return process.env.NEXT_PUBLIC_AGENT_S3_BASE_URL ?? "http://localhost:9000";
}

// =============================================================================
// Fetch helpers
// =============================================================================

async function fetchQuestionsIndex(taskId: string): Promise<QuestionsIndex> {
  const baseUrl = getS3BaseUrl();
  const response = await fetch(`${baseUrl}/${taskId}/questions/index.json`);
  if (!response.ok) {
    if (response.status === 404) {
      return { questions: [] };
    }
    throw new Error(`Failed to fetch questions index: ${response.status}`);
  }
  return response.json() as Promise<QuestionsIndex>;
}

async function fetchQuestion(taskId: string, questionFile: string): Promise<AgentQuestion> {
  const baseUrl = getS3BaseUrl();
  const response = await fetch(`${baseUrl}/${taskId}/questions/${questionFile}`);
  if (!response.ok) {
    throw new Error(`Failed to fetch question ${questionFile}: ${response.status}`);
  }
  return response.json() as Promise<AgentQuestion>;
}

async function fetchAllQuestions(taskId: string): Promise<AgentQuestion[]> {
  const index = await fetchQuestionsIndex(taskId);
  if (index.questions.length === 0) return [];

  const results = await Promise.all(index.questions.map((file) => fetchQuestion(taskId, file)));
  // Sort by asked time, newest first
  return results.sort((a, b) => new Date(b.asked).getTime() - new Date(a.asked).getTime());
}

async function submitAnswer(
  taskId: string,
  questionId: string,
  answerKey: string,
  comment: string,
): Promise<AgentQuestion> {
  const baseUrl = getS3BaseUrl();
  const url = `${baseUrl}/${taskId}/questions/${questionId}.json`;

  // Fetch current question first
  const current = await fetchQuestion(taskId, `${questionId}.json`);

  const updated: AgentQuestion = {
    ...current,
    status: "answered",
    answer: {
      key: answerKey,
      comment,
      at: new Date().toISOString(),
    },
  };

  const response = await fetch(url, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(updated),
  });

  if (!response.ok) {
    throw new Error(`Failed to submit answer: ${response.status}`);
  }

  return updated;
}

// =============================================================================
// Hook
// =============================================================================

export function useAgentQuestions(taskId: string, enabled: boolean) {
  const queryClient = useQueryClient();

  const queryKey = useMemo(() => [AGENT_QUESTIONS_BASE_KEY, taskId] as const, [taskId]);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey,
    queryFn: () => fetchAllQuestions(taskId),
    enabled,
    refetchInterval: POLL_INTERVAL_MS,
    staleTime: POLL_INTERVAL_MS / 2,
  });

  const questions = useMemo(() => data ?? [], [data]);
  const pendingQuestions = useMemo(() => questions.filter((q) => q.status === "pending"), [questions]);
  const answeredQuestions = useMemo(() => questions.filter((q) => q.status === "answered"), [questions]);

  const handleSubmitAnswer = useCallback(
    async (questionId: string, answerKey: string, comment: string) => {
      const updated = await submitAnswer(taskId, questionId, answerKey, comment);

      // Optimistic update: replace the question in the cache
      queryClient.setQueryData<AgentQuestion[]>(queryKey, (old) => {
        if (!old) return [updated];
        return old.map((q) => (q.id === questionId ? updated : q));
      });
    },
    [taskId, queryClient, queryKey],
  );

  return {
    questions,
    pendingQuestions,
    answeredQuestions,
    pendingCount: pendingQuestions.length,
    isLoading,
    error,
    refetch,
    submitAnswer: handleSubmitAnswer,
  };
}
