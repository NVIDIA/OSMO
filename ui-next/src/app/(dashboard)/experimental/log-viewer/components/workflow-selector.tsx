"use client";

import { useState, useCallback, FormEvent, useId } from "react";
import { useRouter } from "next/navigation";
import { Search, Clock, AlertCircle, RefreshCw } from "lucide-react";
import { getRecentWorkflows } from "../lib/recent-workflows";

interface WorkflowSelectorProps {
  error?: {
    message: string;
    isTransient: boolean;
  };
  initialWorkflowId?: string;
}

export function WorkflowSelector({ error, initialWorkflowId = "" }: WorkflowSelectorProps) {
  const router = useRouter();
  const [workflowId, setWorkflowId] = useState(initialWorkflowId);
  const [recentWorkflows] = useState<string[]>(() => getRecentWorkflows());
  const workflowInputId = useId();

  const handleSubmit = useCallback(
    (e: FormEvent) => {
      e.preventDefault();
      const trimmed = workflowId.trim();
      if (!trimmed) return;

      // Navigate to log-viewer with workflow parameter
      router.push(`/experimental/log-viewer?workflow=${encodeURIComponent(trimmed)}`);
    },
    [workflowId, router],
  );

  const handleSelectRecent = useCallback(
    (wfId: string) => {
      router.push(`/experimental/log-viewer?workflow=${encodeURIComponent(wfId)}`);
    },
    [router],
  );

  const handleRetry = useCallback(() => {
    if (initialWorkflowId) {
      router.push(`/experimental/log-viewer?workflow=${encodeURIComponent(initialWorkflowId)}`);
    }
  }, [initialWorkflowId, router]);

  const handleModify = useCallback(() => {
    // Clear error by removing workflow from URL
    router.push("/experimental/log-viewer");
  }, [router]);

  return (
    <div className="flex h-full items-center justify-center p-8">
      <div className="w-full max-w-2xl space-y-6">
        {/* Header */}
        <div className="text-center">
          <h2 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-100">Log Viewer</h2>
          <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
            Enter a workflow ID or name to view logs with timeline visualization
          </p>
        </div>

        {/* Error Display */}
        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 p-4 dark:border-red-900/50 dark:bg-red-950/30">
            <div className="flex items-start gap-3">
              <AlertCircle className="h-5 w-5 shrink-0 text-red-600 dark:text-red-500" />
              <div className="flex-1">
                <p className="text-sm font-medium text-red-900 dark:text-red-100">
                  {error.isTransient ? "Unable to load workflow" : "Workflow not found"}
                </p>
                <p className="mt-1 text-sm text-red-700 dark:text-red-300">{error.message}</p>
              </div>
            </div>
            <div className="mt-4 flex gap-3">
              {error.isTransient && (
                <button
                  type="button"
                  onClick={handleRetry}
                  className="inline-flex items-center gap-2 rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700 dark:bg-red-600 dark:hover:bg-red-700"
                >
                  <RefreshCw className="h-4 w-4" />
                  Retry
                </button>
              )}
              <button
                type="button"
                onClick={handleModify}
                className="inline-flex items-center gap-2 rounded-md border border-red-300 bg-white px-3 py-1.5 text-sm font-medium text-red-700 hover:bg-red-50 dark:border-red-800 dark:bg-red-950/50 dark:text-red-300 dark:hover:bg-red-900/50"
              >
                Modify Input
              </button>
            </div>
          </div>
        )}

        {/* Input Form */}
        <form
          onSubmit={handleSubmit}
          className="space-y-4"
        >
          <div className="relative">
            <label
              htmlFor={workflowInputId}
              className="sr-only"
            >
              Workflow ID or name
            </label>
            <Search className="absolute top-1/2 left-3 h-5 w-5 -translate-y-1/2 text-zinc-400 dark:text-zinc-500" />
            <input
              id={workflowInputId}
              type="text"
              value={workflowId}
              onChange={(e) => setWorkflowId(e.target.value)}
              placeholder="Enter workflow ID or name..."
              className="w-full rounded-lg border border-zinc-300 bg-white py-3 pr-4 pl-10 text-sm text-zinc-900 placeholder:text-zinc-500 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:placeholder:text-zinc-500 dark:focus:border-blue-500 dark:focus:ring-blue-500/20"
            />
          </div>
          <button
            type="submit"
            disabled={!workflowId.trim()}
            className="w-full rounded-lg bg-blue-600 py-3 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-zinc-300 disabled:text-zinc-500 dark:bg-blue-600 dark:hover:bg-blue-700 dark:disabled:bg-zinc-800 dark:disabled:text-zinc-600"
          >
            Load Workflow
          </button>
        </form>

        {/* Recent Workflows */}
        {recentWorkflows.length > 0 && (
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-sm font-medium text-zinc-700 dark:text-zinc-300">
              <Clock className="h-4 w-4" />
              Recent Workflows
            </div>
            <div className="space-y-2">
              {recentWorkflows.slice(0, 5).map((wfId) => (
                <button
                  key={wfId}
                  type="button"
                  onClick={() => handleSelectRecent(wfId)}
                  className="w-full rounded-lg border border-zinc-200 bg-white px-4 py-3 text-left text-sm text-zinc-900 hover:border-zinc-300 hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100 dark:hover:border-zinc-700 dark:hover:bg-zinc-800"
                >
                  {wfId}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Helper Text */}
        <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-800 dark:bg-zinc-900">
          <h3 className="text-sm font-medium text-zinc-900 dark:text-zinc-100">Mock Workflows for Testing</h3>
          <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
            Use these mock workflow IDs to test different scenarios:
          </p>
          <ul className="mt-3 space-y-1 text-sm text-zinc-700 dark:text-zinc-300">
            <li>
              <code className="rounded bg-zinc-200 px-1.5 py-0.5 font-mono dark:bg-zinc-800 dark:text-zinc-200">
                mock-workflow-1
              </code>{" "}
              - Completed workflow
            </li>
            <li>
              <code className="rounded bg-zinc-200 px-1.5 py-0.5 font-mono dark:bg-zinc-800 dark:text-zinc-200">
                mock-workflow-2
              </code>{" "}
              - Running workflow
            </li>
            <li>
              <code className="rounded bg-zinc-200 px-1.5 py-0.5 font-mono dark:bg-zinc-800 dark:text-zinc-200">
                mock-workflow-3
              </code>{" "}
              - Failed workflow
            </li>
          </ul>
        </div>
      </div>
    </div>
  );
}
