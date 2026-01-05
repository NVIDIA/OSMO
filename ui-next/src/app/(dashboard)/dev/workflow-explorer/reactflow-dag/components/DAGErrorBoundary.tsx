// Copyright (c) 2025, NVIDIA CORPORATION. All rights reserved.
//
// NVIDIA CORPORATION and its licensors retain all intellectual property
// and proprietary rights in and to this software, related documentation
// and any modifications thereto. Any use, reproduction, disclosure or
// distribution of this software and related documentation without an express
// license agreement from NVIDIA CORPORATION is strictly prohibited.

/**
 * DAGErrorBoundary Component
 *
 * Error boundary for the DAG visualization.
 * Catches layout and rendering errors and displays a friendly fallback.
 */

"use client";

import { Component, type ReactNode } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { Button } from "@/components/shadcn/button";

interface Props {
  children: ReactNode;
  onRetry?: () => void;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class DAGErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error("DAG visualization error:", error, errorInfo);
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: null });
    this.props.onRetry?.();
  };

  render() {
    if (this.state.hasError) {
      return (
        <div
          className="flex flex-1 flex-col items-center justify-center gap-4 bg-gray-50 p-8 dark:bg-zinc-950"
          role="alert"
          aria-live="assertive"
        >
          <div className="flex items-center gap-3 text-amber-600 dark:text-amber-500">
            <AlertTriangle
              className="h-8 w-8"
              aria-hidden="true"
            />
            <h2 className="text-xl font-semibold">Visualization Error</h2>
          </div>
          <p className="max-w-md text-center text-gray-500 dark:text-zinc-400">
            The DAG visualization encountered an error. This might be due to invalid workflow data or a layout
            calculation failure.
          </p>
          {this.state.error && (
            <details className="max-w-lg text-sm text-gray-500 dark:text-zinc-500">
              <summary className="cursor-pointer hover:text-gray-700 dark:hover:text-zinc-400">
                Technical details
              </summary>
              <pre className="mt-2 overflow-auto rounded-lg bg-gray-100 p-3 text-xs dark:bg-zinc-900">
                {this.state.error.message}
              </pre>
            </details>
          )}
          <Button
            variant="outline"
            onClick={this.handleRetry}
            className="mt-4"
          >
            <RefreshCw
              className="mr-2 h-4 w-4"
              aria-hidden="true"
            />
            Try Again
          </Button>
        </div>
      );
    }

    return this.props.children;
  }
}
