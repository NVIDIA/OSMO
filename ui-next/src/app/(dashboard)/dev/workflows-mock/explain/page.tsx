// Copyright (c) 2025, NVIDIA CORPORATION. All rights reserved.
//
// NVIDIA CORPORATION and its licensors retain all intellectual property
// and proprietary rights in and to this software, related documentation
// and any modifications thereto. Any use, reproduction, disclosure or
// distribution of this software and related documentation without an express
// license agreement from NVIDIA CORPORATION is strictly prohibited.

"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  ChevronLeft,
  ChevronRight,
  Clock,
  AlertCircle,
  XCircle,
  CheckCircle,
  Loader2,
  Info,
  Lightbulb,
  ArrowRight,
  Key,
  Image,
  Timer,
  Zap,
  Users,
  HardDrive,
  RefreshCw,
  ExternalLink,
  Copy,
} from "lucide-react";

// ============================================================================
// EXPLAINER COMPONENTS - "Why isn't it running?" / "Why did it fail?"
// ============================================================================

// Scenario 1: Workflow is queued - explain why and what to do
function QueuedExplainer() {
  return (
    <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 overflow-hidden">
      {/* Header */}
      <div className="px-6 py-4 border-b border-amber-500/20 bg-amber-500/10">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-amber-500/20">
            <Clock className="h-5 w-5 text-amber-400" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-amber-200">Why is this workflow waiting?</h2>
            <p className="text-sm text-amber-300/70">Position #3 in queue • Estimated wait: ~30 minutes</p>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="p-6 space-y-6">
        {/* Resource Requirements */}
        <div>
          <h3 className="text-sm font-medium text-zinc-300 mb-3 flex items-center gap-2">
            <Info className="h-4 w-4 text-zinc-400" />
            Your workflow needs
          </h3>
          <div className="grid grid-cols-4 gap-3">
            <div className="p-3 rounded-lg bg-zinc-800/50 text-center">
              <div className="text-2xl font-bold text-amber-400">4</div>
              <div className="text-xs text-zinc-400">GPUs</div>
            </div>
            <div className="p-3 rounded-lg bg-zinc-800/50 text-center">
              <div className="text-2xl font-bold text-zinc-300">8</div>
              <div className="text-xs text-zinc-400">CPUs</div>
            </div>
            <div className="p-3 rounded-lg bg-zinc-800/50 text-center">
              <div className="text-lg font-bold text-zinc-300">64Gi</div>
              <div className="text-xs text-zinc-400">Memory</div>
            </div>
            <div className="p-3 rounded-lg bg-zinc-800/50 text-center">
              <div className="text-lg font-bold text-zinc-300">100Gi</div>
              <div className="text-xs text-zinc-400">Storage</div>
            </div>
          </div>
        </div>

        {/* Pool Status */}
        <div>
          <h3 className="text-sm font-medium text-zinc-300 mb-3 flex items-center gap-2">
            <HardDrive className="h-4 w-4 text-zinc-400" />
            Pool status: gpu-pool-us-east
          </h3>
          <div className="p-4 rounded-lg bg-zinc-800/50 space-y-3">
            <div className="flex items-center justify-between text-sm">
              <span className="text-zinc-400">Total capacity</span>
              <span className="font-mono text-zinc-200">16 GPUs</span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-zinc-400">Currently in use</span>
              <span className="font-mono text-red-400">14 GPUs</span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-zinc-400">Available now</span>
              <span className="font-mono text-amber-400">2 GPUs</span>
            </div>
            <div className="w-full h-2 rounded-full bg-zinc-700 overflow-hidden">
              <div
                className="h-full bg-red-500"
                style={{ width: "87.5%" }}
              />
            </div>
            <div className="text-xs text-zinc-500">87.5% utilized • 2 workflows ahead of you</div>
          </div>
        </div>

        {/* Suggestions */}
        <div>
          <h3 className="text-sm font-medium text-zinc-300 mb-3 flex items-center gap-2">
            <Lightbulb className="h-4 w-4 text-amber-400" />
            Options to reduce wait time
          </h3>
          <div className="space-y-2">
            <button className="w-full p-3 rounded-lg bg-zinc-800/50 hover:bg-zinc-800 border border-zinc-700/50 hover:border-zinc-600 transition-all text-left group">
              <div className="flex items-center justify-between">
                <div>
                  <div className="font-medium text-zinc-200 text-sm">Try a different pool</div>
                  <div className="text-xs text-zinc-400 mt-0.5">gpu-pool-us-west has 6 GPUs available</div>
                </div>
                <ArrowRight className="h-4 w-4 text-zinc-500 group-hover:text-zinc-300 transition-colors" />
              </div>
            </button>
            <button className="w-full p-3 rounded-lg bg-zinc-800/50 hover:bg-zinc-800 border border-zinc-700/50 hover:border-zinc-600 transition-all text-left group">
              <div className="flex items-center justify-between">
                <div>
                  <div className="font-medium text-zinc-200 text-sm">Submit with HIGH priority</div>
                  <div className="text-xs text-zinc-400 mt-0.5">Will schedule before NORMAL/LOW priority workflows</div>
                </div>
                <ArrowRight className="h-4 w-4 text-zinc-500 group-hover:text-zinc-300 transition-colors" />
              </div>
            </button>
            <button className="w-full p-3 rounded-lg bg-zinc-800/50 hover:bg-zinc-800 border border-zinc-700/50 hover:border-zinc-600 transition-all text-left group">
              <div className="flex items-center justify-between">
                <div>
                  <div className="font-medium text-zinc-200 text-sm">Reduce GPU requirements</div>
                  <div className="text-xs text-zinc-400 mt-0.5">2 GPUs available now - modify workflow spec</div>
                </div>
                <ArrowRight className="h-4 w-4 text-zinc-500 group-hover:text-zinc-300 transition-colors" />
              </div>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// Scenario 2: Image pull failure
function ImagePullFailureExplainer() {
  return (
    <div className="rounded-xl border border-red-500/30 bg-red-500/5 overflow-hidden">
      {/* Header */}
      <div className="px-6 py-4 border-b border-red-500/20 bg-red-500/10">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-red-500/20">
            <Image className="h-5 w-5 text-red-400" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-red-200">Image Pull Failed</h2>
            <p className="text-sm text-red-300/70">Could not pull the container image</p>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="p-6 space-y-6">
        {/* Error Details */}
        <div>
          <h3 className="text-sm font-medium text-zinc-300 mb-3 flex items-center gap-2">
            <AlertCircle className="h-4 w-4 text-red-400" />
            Error Details
          </h3>
          <div className="p-4 rounded-lg bg-zinc-900 border border-zinc-800 font-mono text-sm">
            <div className="text-red-400 mb-2">Error: ImagePullBackOff</div>
            <div className="text-zinc-400">
              Image: <span className="text-zinc-200">nvcr.io/nvidia/pytorch:24.03-custom</span>
            </div>
            <div className="text-zinc-400 mt-2">
              Message: <span className="text-red-300">unauthorized: authentication required</span>
            </div>
          </div>
        </div>

        {/* Likely Causes */}
        <div>
          <h3 className="text-sm font-medium text-zinc-300 mb-3 flex items-center gap-2">
            <Info className="h-4 w-4 text-zinc-400" />
            Likely causes
          </h3>
          <ul className="space-y-2 text-sm">
            <li className="flex items-start gap-2 text-zinc-400">
              <span className="text-red-400 mt-0.5">1.</span>
              <span>
                <strong className="text-zinc-200">Missing registry credentials</strong> - You need to add NGC
                credentials to access nvcr.io images
              </span>
            </li>
            <li className="flex items-start gap-2 text-zinc-400">
              <span className="text-red-400 mt-0.5">2.</span>
              <span>
                <strong className="text-zinc-200">Image doesn&apos;t exist</strong> - The tag &quot;24.03-custom&quot;
                may not exist in the registry
              </span>
            </li>
            <li className="flex items-start gap-2 text-zinc-400">
              <span className="text-red-400 mt-0.5">3.</span>
              <span>
                <strong className="text-zinc-200">Expired credentials</strong> - Your NGC API key may have expired
              </span>
            </li>
          </ul>
        </div>

        {/* How to Fix */}
        <div>
          <h3 className="text-sm font-medium text-zinc-300 mb-3 flex items-center gap-2">
            <Lightbulb className="h-4 w-4 text-green-400" />
            How to fix this
          </h3>
          <div className="space-y-3">
            <div className="p-4 rounded-lg bg-zinc-800/50 border border-zinc-700/50">
              <div className="flex items-center gap-2 text-zinc-200 font-medium mb-2">
                <span className="flex items-center justify-center w-5 h-5 rounded-full bg-zinc-700 text-xs">1</span>
                Verify the image exists
              </div>
              <div className="flex items-center gap-2 mt-2">
                <code className="flex-1 px-3 py-2 rounded bg-zinc-900 text-sm font-mono text-zinc-300">
                  docker pull nvcr.io/nvidia/pytorch:24.03-custom
                </code>
                <Button
                  variant="ghost"
                  size="sm"
                >
                  <Copy className="h-4 w-4" />
                </Button>
              </div>
            </div>

            <div className="p-4 rounded-lg bg-zinc-800/50 border border-zinc-700/50">
              <div className="flex items-center gap-2 text-zinc-200 font-medium mb-2">
                <span className="flex items-center justify-center w-5 h-5 rounded-full bg-zinc-700 text-xs">2</span>
                Add or update NGC credentials
              </div>
              <p className="text-sm text-zinc-400 mb-3">Add your NGC API key to authenticate with nvcr.io</p>
              <Button
                size="sm"
                className="bg-green-600 hover:bg-green-700"
              >
                <Key className="h-4 w-4 mr-2" />
                Add NGC Credential
              </Button>
            </div>

            <div className="p-4 rounded-lg bg-zinc-800/50 border border-zinc-700/50">
              <div className="flex items-center gap-2 text-zinc-200 font-medium mb-2">
                <span className="flex items-center justify-center w-5 h-5 rounded-full bg-zinc-700 text-xs">3</span>
                Restart the workflow
              </div>
              <p className="text-sm text-zinc-400 mb-3">After fixing credentials, restart with the same spec</p>
              <Button
                size="sm"
                variant="outline"
              >
                <RefreshCw className="h-4 w-4 mr-2" />
                Restart Workflow
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// Scenario 3: Execution timeout
function TimeoutExplainer() {
  return (
    <div className="rounded-xl border border-red-500/30 bg-red-500/5 overflow-hidden">
      {/* Header */}
      <div className="px-6 py-4 border-b border-red-500/20 bg-red-500/10">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-red-500/20">
            <Timer className="h-5 w-5 text-red-400" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-red-200">Execution Timeout</h2>
            <p className="text-sm text-red-300/70">Task exceeded maximum execution time</p>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="p-6 space-y-6">
        {/* Timeout Details */}
        <div>
          <h3 className="text-sm font-medium text-zinc-300 mb-3 flex items-center gap-2">
            <Clock className="h-4 w-4 text-zinc-400" />
            Timeout Details
          </h3>
          <div className="grid grid-cols-2 gap-4">
            <div className="p-4 rounded-lg bg-zinc-800/50">
              <div className="text-xs text-zinc-400 uppercase tracking-wider">Configured Timeout</div>
              <div className="text-2xl font-bold text-zinc-200 mt-1">2 hours</div>
            </div>
            <div className="p-4 rounded-lg bg-zinc-800/50">
              <div className="text-xs text-zinc-400 uppercase tracking-wider">Actual Runtime</div>
              <div className="text-2xl font-bold text-red-400 mt-1">2h 0m 3s</div>
            </div>
          </div>
        </div>

        {/* Task that timed out */}
        <div>
          <h3 className="text-sm font-medium text-zinc-300 mb-3">Task that exceeded timeout</h3>
          <div className="p-4 rounded-lg bg-zinc-800/50 border border-zinc-700/50">
            <div className="flex items-center gap-3">
              <XCircle className="h-5 w-5 text-red-400" />
              <div>
                <div className="font-mono text-sm text-zinc-200">train</div>
                <div className="text-xs text-zinc-400">Ran on gpu-node-02 • 1 GPU, 32Gi memory</div>
              </div>
            </div>
          </div>
        </div>

        {/* Suggestions */}
        <div>
          <h3 className="text-sm font-medium text-zinc-300 mb-3 flex items-center gap-2">
            <Lightbulb className="h-4 w-4 text-green-400" />
            How to fix this
          </h3>
          <div className="space-y-2">
            <button className="w-full p-3 rounded-lg bg-zinc-800/50 hover:bg-zinc-800 border border-zinc-700/50 hover:border-zinc-600 transition-all text-left group">
              <div className="flex items-center justify-between">
                <div>
                  <div className="font-medium text-zinc-200 text-sm">Increase exec_timeout</div>
                  <div className="text-xs text-zinc-400 mt-0.5">Set timeout.exec_timeout: 4h in your workflow spec</div>
                </div>
                <ArrowRight className="h-4 w-4 text-zinc-500 group-hover:text-zinc-300 transition-colors" />
              </div>
            </button>
            <button className="w-full p-3 rounded-lg bg-zinc-800/50 hover:bg-zinc-800 border border-zinc-700/50 hover:border-zinc-600 transition-all text-left group">
              <div className="flex items-center justify-between">
                <div>
                  <div className="font-medium text-zinc-200 text-sm">Optimize your code</div>
                  <div className="text-xs text-zinc-400 mt-0.5">
                    Check logs for bottlenecks, consider distributed training
                  </div>
                </div>
                <ArrowRight className="h-4 w-4 text-zinc-500 group-hover:text-zinc-300 transition-colors" />
              </div>
            </button>
            <button className="w-full p-3 rounded-lg bg-zinc-800/50 hover:bg-zinc-800 border border-zinc-700/50 hover:border-zinc-600 transition-all text-left group">
              <div className="flex items-center justify-between">
                <div>
                  <div className="font-medium text-zinc-200 text-sm">Use checkpointing</div>
                  <div className="text-xs text-zinc-400 mt-0.5">
                    Save progress periodically to resume from last checkpoint
                  </div>
                </div>
                <ArrowRight className="h-4 w-4 text-zinc-500 group-hover:text-zinc-300 transition-colors" />
              </div>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// Scenario 4: Preempted
function PreemptedExplainer() {
  return (
    <div className="rounded-xl border border-orange-500/30 bg-orange-500/5 overflow-hidden">
      {/* Header */}
      <div className="px-6 py-4 border-b border-orange-500/20 bg-orange-500/10">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-orange-500/20">
            <Zap className="h-5 w-5 text-orange-400" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-orange-200">Workflow Preempted</h2>
            <p className="text-sm text-orange-300/70">Evicted to make room for higher priority work</p>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="p-6 space-y-6">
        {/* Explanation */}
        <div>
          <h3 className="text-sm font-medium text-zinc-300 mb-3 flex items-center gap-2">
            <Info className="h-4 w-4 text-zinc-400" />
            What happened
          </h3>
          <p className="text-sm text-zinc-400">
            Your workflow was submitted with <span className="text-blue-400 font-medium">LOW priority</span>. When a{" "}
            <span className="text-red-400 font-medium">HIGH</span> or{" "}
            <span className="text-zinc-300 font-medium">NORMAL</span> priority workflow needed the GPUs you were using,
            your workflow was preempted to free up resources.
          </p>
        </div>

        {/* Priority Explanation */}
        <div>
          <h3 className="text-sm font-medium text-zinc-300 mb-3">How priority works</h3>
          <div className="space-y-2">
            <div className="flex items-center gap-3 p-3 rounded-lg bg-red-500/10 border border-red-500/20">
              <span className="px-2 py-0.5 rounded text-xs font-medium bg-red-500/20 text-red-400">HIGH</span>
              <span className="text-sm text-zinc-300">Scheduled first, never preempted, counts against quota</span>
            </div>
            <div className="flex items-center gap-3 p-3 rounded-lg bg-zinc-500/10 border border-zinc-500/20">
              <span className="px-2 py-0.5 rounded text-xs font-medium bg-zinc-500/20 text-zinc-300">NORMAL</span>
              <span className="text-sm text-zinc-300">Scheduled after HIGH, never preempted, counts against quota</span>
            </div>
            <div className="flex items-center gap-3 p-3 rounded-lg bg-blue-500/10 border border-blue-500/20">
              <span className="px-2 py-0.5 rounded text-xs font-medium bg-blue-500/20 text-blue-400">LOW</span>
              <span className="text-sm text-zinc-300">
                Uses spare capacity, <strong className="text-orange-400">can be preempted</strong>
              </span>
            </div>
          </div>
        </div>

        {/* Suggestions */}
        <div>
          <h3 className="text-sm font-medium text-zinc-300 mb-3 flex items-center gap-2">
            <Lightbulb className="h-4 w-4 text-green-400" />
            What to do
          </h3>
          <div className="space-y-2">
            <button className="w-full p-3 rounded-lg bg-zinc-800/50 hover:bg-zinc-800 border border-zinc-700/50 hover:border-zinc-600 transition-all text-left group">
              <div className="flex items-center justify-between">
                <div>
                  <div className="font-medium text-zinc-200 text-sm">Restart with NORMAL priority</div>
                  <div className="text-xs text-zinc-400 mt-0.5">
                    Won&apos;t be preempted, will count against your pool quota
                  </div>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                >
                  Restart
                </Button>
              </div>
            </button>
            <button className="w-full p-3 rounded-lg bg-zinc-800/50 hover:bg-zinc-800 border border-zinc-700/50 hover:border-zinc-600 transition-all text-left group">
              <div className="flex items-center justify-between">
                <div>
                  <div className="font-medium text-zinc-200 text-sm">Use checkpointing</div>
                  <div className="text-xs text-zinc-400 mt-0.5">
                    Save progress periodically to minimize lost work on preemption
                  </div>
                </div>
                <ExternalLink className="h-4 w-4 text-zinc-500" />
              </div>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// MAIN PAGE COMPONENT
// ============================================================================

export default function ExplainMockPage() {
  const [activeScenario, setActiveScenario] = useState<"queued" | "image_pull" | "timeout" | "preempted">("queued");

  return (
    <div className="max-w-3xl mx-auto py-8 px-4 space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Workflow Status Explainers</h1>
        <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1">
          Interactive mockups for &quot;Why isn&apos;t it running?&quot; and &quot;Why did it fail?&quot; experiences
        </p>
      </div>

      {/* Scenario Picker */}
      <Tabs
        value={activeScenario}
        onValueChange={(v) => setActiveScenario(v as typeof activeScenario)}
      >
        <TabsList className="grid w-full grid-cols-4 bg-zinc-800">
          <TabsTrigger value="queued">
            <Clock className="h-4 w-4 mr-1.5" />
            Queued
          </TabsTrigger>
          <TabsTrigger value="image_pull">
            <Image className="h-4 w-4 mr-1.5" />
            Image Pull
          </TabsTrigger>
          <TabsTrigger value="timeout">
            <Timer className="h-4 w-4 mr-1.5" />
            Timeout
          </TabsTrigger>
          <TabsTrigger value="preempted">
            <Zap className="h-4 w-4 mr-1.5" />
            Preempted
          </TabsTrigger>
        </TabsList>

        <div className="mt-6">
          <TabsContent value="queued">
            <QueuedExplainer />
          </TabsContent>
          <TabsContent value="image_pull">
            <ImagePullFailureExplainer />
          </TabsContent>
          <TabsContent value="timeout">
            <TimeoutExplainer />
          </TabsContent>
          <TabsContent value="preempted">
            <PreemptedExplainer />
          </TabsContent>
        </div>
      </Tabs>

      {/* Design Notes */}
      <div className="p-6 rounded-lg border border-dashed border-zinc-700 bg-zinc-900/30">
        <h3 className="text-lg font-semibold mb-4 text-zinc-300">🎨 Design Principles</h3>
        <ul className="space-y-2 text-sm text-zinc-400">
          <li>
            ✅ <strong>Answer first</strong>: Lead with the status and a clear explanation
          </li>
          <li>
            ✅ <strong>Show context</strong>: Display relevant data (resources, pool status, timing)
          </li>
          <li>
            ✅ <strong>Actionable suggestions</strong>: Every explainer ends with concrete next steps
          </li>
          <li>
            ✅ <strong>Visual hierarchy</strong>: Color coding (amber=queued, red=failed, orange=warning)
          </li>
          <li>
            ✅ <strong>Progressive disclosure</strong>: Essential info first, details available on demand
          </li>
          <li>
            ✅ <strong>Copy-friendly</strong>: Commands can be copied to terminal
          </li>
          <li>
            ✅ <strong>Deep links</strong>: Buttons navigate to related pages (credentials, pools, docs)
          </li>
        </ul>
      </div>
    </div>
  );
}
