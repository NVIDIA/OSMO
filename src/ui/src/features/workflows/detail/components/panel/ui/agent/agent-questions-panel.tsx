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

import { memo, useState, useCallback } from "react";
import { MessageCircleQuestion, CheckCircle2, ChevronDown, ChevronRight, Loader2 } from "lucide-react";
import { Button } from "@/components/shadcn/button";
import { Badge } from "@/components/shadcn/badge";
import { Card, CardContent } from "@/components/shadcn/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/shadcn/collapsible";
import { InlineErrorBoundary } from "@/components/error/inline-error-boundary";
import { formatDateTimeFull } from "@/lib/format-date";
import {
  useAgentQuestions,
  type AgentQuestion,
} from "@/features/workflows/detail/components/panel/ui/agent/use-agent-questions";

// =============================================================================
// Sub-components
// =============================================================================

function PendingQuestionCard({
  question,
  onSubmitAnswer,
}: {
  question: AgentQuestion;
  onSubmitAnswer: (questionId: string, answerKey: string, comment: string) => Promise<void>;
}) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const handleSelect = useCallback(
    async (option: string) => {
      // Extract the key (e.g., "A" from "A: Skip this module")
      const key = option.split(":")[0]?.trim() ?? option;
      setIsSubmitting(true);
      setSubmitError(null);
      try {
        await onSubmitAnswer(question.id, key, "");
      } catch (error) {
        setSubmitError(error instanceof Error ? error.message : "Failed to submit answer");
      } finally {
        setIsSubmitting(false);
      }
    },
    [question.id, onSubmitAnswer],
  );

  return (
    <Card className="border-amber-200 bg-amber-50/50 py-0 dark:border-amber-800 dark:bg-amber-950/20">
      <CardContent className="space-y-3 p-3">
        <div className="flex items-start gap-2">
          <MessageCircleQuestion className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" />
          <div className="min-w-0 flex-1">
            <p className="text-foreground text-sm font-medium">{question.question}</p>
            <p className="text-muted-foreground mt-1 text-xs">{question.context}</p>
            <p className="text-muted-foreground mt-1 text-xs">
              Subtask: <span className="font-mono">{question.subtask}</span>
              {" \u00b7 "}
              {formatDateTimeFull(question.asked)}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          {question.options.map((option) => (
            <Button
              key={option}
              variant="outline"
              size="sm"
              disabled={isSubmitting}
              onClick={() => handleSelect(option)}
              className="text-xs"
            >
              {isSubmitting ? <Loader2 className="size-3 animate-spin" /> : null}
              {option}
            </Button>
          ))}
        </div>

        {submitError ? <p className="text-destructive text-xs">{submitError}</p> : null}
      </CardContent>
    </Card>
  );
}

function AnsweredQuestionCard({ question }: { question: AgentQuestion }) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <Collapsible
      open={isOpen}
      onOpenChange={setIsOpen}
    >
      <CollapsibleTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="text-muted-foreground w-full justify-start gap-2 text-xs"
        >
          {isOpen ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
          <CheckCircle2 className="size-3 text-green-600 dark:text-green-400" />
          <span className="truncate">{question.question}</span>
          {question.answer ? (
            <Badge
              variant="secondary"
              className="ml-auto text-[10px]"
            >
              {question.answer.key}
            </Badge>
          ) : null}
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="text-muted-foreground space-y-1 py-2 pl-8 text-xs">
          <p>{question.context}</p>
          {question.answer ? (
            <p>
              Answered <span className="font-medium">{question.answer.key}</span>
              {question.answer.comment ? `: ${question.answer.comment}` : ""}
              {" \u00b7 "}
              {formatDateTimeFull(question.answer.at)}
            </p>
          ) : null}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

// =============================================================================
// Main Component
// =============================================================================

export interface AgentQuestionsPanelProps {
  taskId: string;
  enabled: boolean;
}

export const AgentQuestionsPanel = memo(function AgentQuestionsPanel({ taskId, enabled }: AgentQuestionsPanelProps) {
  const { pendingQuestions, answeredQuestions, pendingCount, isLoading, error, refetch, submitAnswer } =
    useAgentQuestions(taskId, enabled);

  if (!enabled) return null;

  return (
    <InlineErrorBoundary
      title="Agent questions error"
      compact
      onReset={() => refetch()}
    >
      <section className="space-y-3">
        {/* Header */}
        <div className="flex items-center gap-2">
          <MessageCircleQuestion className="size-4 text-amber-600 dark:text-amber-400" />
          <h3 className="text-muted-foreground text-xs font-semibold tracking-wider uppercase">Agent Questions</h3>
          {pendingCount > 0 ? (
            <Badge
              variant="destructive"
              className="text-[10px]"
            >
              {pendingCount}
            </Badge>
          ) : null}
          {isLoading ? <Loader2 className="text-muted-foreground size-3 animate-spin" /> : null}
        </div>

        {/* Error state */}
        {error ? <p className="text-destructive text-xs">Failed to load questions: {error.message}</p> : null}

        {/* Pending questions */}
        {pendingQuestions.length > 0 ? (
          <div className="space-y-2">
            {pendingQuestions.map((question) => (
              <PendingQuestionCard
                key={question.id}
                question={question}
                onSubmitAnswer={submitAnswer}
              />
            ))}
          </div>
        ) : null}

        {/* Empty state (no pending, no answered) */}
        {!isLoading && pendingQuestions.length === 0 && answeredQuestions.length === 0 ? (
          <p className="text-muted-foreground text-xs">No agent questions yet.</p>
        ) : null}

        {/* Answered questions (collapsed) */}
        {answeredQuestions.length > 0 ? (
          <div>
            <p className="text-muted-foreground mb-1 text-xs">{answeredQuestions.length} answered</p>
            {answeredQuestions.map((question) => (
              <AnsweredQuestionCard
                key={question.id}
                question={question}
              />
            ))}
          </div>
        ) : null}
      </section>
    </InlineErrorBoundary>
  );
});
