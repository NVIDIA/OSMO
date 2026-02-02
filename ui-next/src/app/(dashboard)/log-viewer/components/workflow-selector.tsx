"use client";

import { useState, useCallback, FormEvent, useId, MouseEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Search, Clock, AlertCircle, X, ArrowRight } from "lucide-react";
import { usePage } from "@/components/chrome";
import { getRecentWorkflows, clearRecentWorkflows, removeRecentWorkflow } from "../lib/recent-workflows";

interface WorkflowSelectorProps {
  error?: {
    message: string;
    isTransient: boolean;
  };
  initialWorkflowId?: string;
}

export function WorkflowSelector({ error, initialWorkflowId = "" }: WorkflowSelectorProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [workflowId, setWorkflowId] = useState(initialWorkflowId);
  const [recentWorkflows, setRecentWorkflows] = useState<string[]>(() => getRecentWorkflows());
  const workflowInputId = useId();

  // Register page with breadcrumbs
  usePage({
    title: "Log Viewer",
  });

  const handleClearRecent = useCallback(() => {
    clearRecentWorkflows();
    setRecentWorkflows([]);
  }, []);

  const handleRemoveRecent = useCallback((wfId: string, e: MouseEvent) => {
    // Prevent the parent button's onClick from firing
    e.stopPropagation();
    removeRecentWorkflow(wfId);
    setRecentWorkflows((prev) => prev.filter((id) => id !== wfId));
  }, []);

  // Helper to build URL with preserved params
  const buildUrl = useCallback(
    (workflow: string) => {
      const params = new URLSearchParams(searchParams);
      params.set("workflow", workflow);
      return `/log-viewer?${params.toString()}`;
    },
    [searchParams],
  );

  const handleSubmit = useCallback(
    (e: FormEvent) => {
      e.preventDefault();
      const trimmed = workflowId.trim();
      if (!trimmed) return;

      // Navigate to log-viewer with workflow parameter and preserved params
      router.push(buildUrl(trimmed));
    },
    [workflowId, router, buildUrl],
  );

  const handleSelectRecent = useCallback(
    (wfId: string) => {
      router.push(buildUrl(wfId));
    },
    [router, buildUrl],
  );

  const handleClearInput = useCallback(() => {
    setWorkflowId("");
  }, []);

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

        {/* Input Form */}
        <form onSubmit={handleSubmit}>
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
              className={`w-full rounded-lg border border-zinc-300 bg-white py-3 pl-10 text-sm text-zinc-900 placeholder:text-zinc-500 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:placeholder:text-zinc-500 dark:focus:border-blue-500 dark:focus:ring-blue-500/20 ${
                workflowId.trim() ? "pr-20" : "pr-12"
              }`}
            />
            {workflowId.trim() && (
              <button
                type="button"
                onClick={handleClearInput}
                aria-label="Clear input"
                className="absolute top-1/2 right-12 -translate-y-1/2 rounded-md p-1.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 dark:text-zinc-500 dark:hover:bg-zinc-800 dark:hover:text-zinc-300"
              >
                <X className="h-4 w-4" />
              </button>
            )}
            <button
              type="submit"
              disabled={!workflowId.trim()}
              aria-label="Load workflow"
              className="absolute top-1/2 right-2 -translate-y-1/2 rounded-md bg-blue-600 p-2 text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-zinc-300 disabled:text-zinc-500 dark:bg-blue-600 dark:hover:bg-blue-700 dark:disabled:bg-zinc-800 dark:disabled:text-zinc-600"
            >
              <ArrowRight className="h-4 w-4" />
            </button>
          </div>
        </form>

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
          </div>
        )}

        {/* Recent Workflows */}
        {recentWorkflows.length > 0 && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm font-medium text-zinc-700 dark:text-zinc-300">
                <Clock className="h-4 w-4" />
                Recent Workflows
              </div>
              <button
                type="button"
                onClick={handleClearRecent}
                className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
                aria-label="Clear recent workflows"
              >
                <X className="h-3 w-3" />
                Clear
              </button>
            </div>
            <div className="space-y-2">
              {recentWorkflows.slice(0, 5).map((wfId) => (
                <div
                  key={wfId}
                  className="group relative"
                >
                  <button
                    type="button"
                    onClick={() => handleSelectRecent(wfId)}
                    className="w-full rounded-lg border border-zinc-200 bg-white px-4 py-3 pr-10 text-left text-sm text-zinc-900 hover:border-zinc-300 hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100 dark:hover:border-zinc-700 dark:hover:bg-zinc-800"
                  >
                    {wfId}
                  </button>
                  <button
                    type="button"
                    onClick={(e) => handleRemoveRecent(wfId, e)}
                    className="absolute top-1/2 right-2 -translate-y-1/2 rounded-md p-1.5 text-zinc-400 opacity-0 transition-opacity group-hover:opacity-100 hover:bg-zinc-200 hover:text-zinc-600 dark:text-zinc-500 dark:hover:bg-zinc-700 dark:hover:text-zinc-300"
                    aria-label={`Remove ${wfId} from recent workflows`}
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Helper Text */}
        <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-800 dark:bg-zinc-900">
          <h3 className="text-sm font-medium text-zinc-900 dark:text-zinc-100">Available Test Workflows</h3>
          <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
            Each workflow includes different log characteristics for testing:
          </p>

          <div className="mt-4 space-y-4">
            <div>
              <h4 className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">Completed</h4>
              <ul className="mt-1.5 space-y-1 text-sm text-zinc-700 dark:text-zinc-300">
                <li>
                  <code className="rounded bg-zinc-200 px-1.5 py-0.5 font-mono text-xs dark:bg-zinc-800 dark:text-zinc-200">
                    mock-typical-completed
                  </code>
                  <span className="ml-2 text-xs text-zinc-500 dark:text-zinc-400">
                    Standard 3-stage training (2k lines)
                  </span>
                </li>
                <li>
                  <code className="rounded bg-zinc-200 px-1.5 py-0.5 font-mono text-xs dark:bg-zinc-800 dark:text-zinc-200">
                    mock-empty-completed
                  </code>
                  <span className="ml-2 text-xs text-zinc-500 dark:text-zinc-400">Instant completion (no logs)</span>
                </li>
              </ul>
            </div>

            <div>
              <h4 className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">Running</h4>
              <ul className="mt-1.5 space-y-1 text-sm text-zinc-700 dark:text-zinc-300">
                <li>
                  <code className="rounded bg-zinc-200 px-1.5 py-0.5 font-mono text-xs dark:bg-zinc-800 dark:text-zinc-200">
                    mock-typical-running
                  </code>
                  <span className="ml-2 text-xs text-zinc-500 dark:text-zinc-400">Standard 2-stage job (2k lines)</span>
                </li>
                <li>
                  <code className="rounded bg-zinc-200 px-1.5 py-0.5 font-mono text-xs dark:bg-zinc-800 dark:text-zinc-200">
                    mock-streaming-running
                  </code>
                  <span className="ml-2 text-xs text-zinc-500 dark:text-zinc-400">Live tailing (infinite)</span>
                </li>
                <li>
                  <code className="rounded bg-zinc-200 px-1.5 py-0.5 font-mono text-xs dark:bg-zinc-800 dark:text-zinc-200">
                    mock-large-running
                  </code>
                  <span className="ml-2 text-xs text-zinc-500 dark:text-zinc-400">Performance test (50k lines)</span>
                </li>
                <li>
                  <code className="rounded bg-zinc-200 px-1.5 py-0.5 font-mono text-xs dark:bg-zinc-800 dark:text-zinc-200">
                    mock-multi-task
                  </code>
                  <span className="ml-2 text-xs text-zinc-500 dark:text-zinc-400">Complex DAG (8 groups)</span>
                </li>
              </ul>
            </div>

            <div>
              <h4 className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">Failed</h4>
              <ul className="mt-1.5 space-y-1 text-sm text-zinc-700 dark:text-zinc-300">
                <li>
                  <code className="rounded bg-zinc-200 px-1.5 py-0.5 font-mono text-xs dark:bg-zinc-800 dark:text-zinc-200">
                    mock-typical-failed
                  </code>
                  <span className="ml-2 text-xs text-zinc-500 dark:text-zinc-400">CUDA OOM with retries</span>
                </li>
                <li>
                  <code className="rounded bg-zinc-200 px-1.5 py-0.5 font-mono text-xs dark:bg-zinc-800 dark:text-zinc-200">
                    mock-high-error-failed
                  </code>
                  <span className="ml-2 text-xs text-zinc-500 dark:text-zinc-400">Extreme error spam (30%)</span>
                </li>
              </ul>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
