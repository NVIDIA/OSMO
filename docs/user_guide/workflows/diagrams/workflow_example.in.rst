..
  SPDX-FileCopyrightText: Copyright (c) 2025 NVIDIA CORPORATION & AFFILIATES. All rights reserved.

  Licensed under the Apache License, Version 2.0 (the "License");
  you may not use this file except in compliance with the License.
  You may obtain a copy of the License at

  http://www.apache.org/licenses/LICENSE-2.0

  Unless required by applicable law or agreed to in writing, software
  distributed under the License is distributed on an "AS IS" BASIS,
  WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
  See the License for the specific language governing permissions and
  limitations under the License.

  SPDX-License-Identifier: Apache-2.0
..

.. raw:: html

    <style>
        .workflow-dag {
            text-align: center;
            margin: 2em 0;
        }

        .workflow-dag .workflow-node,
        .workflow-dag .workflow-arrow,
        .workflow-dag .workflow-arrow-split {
            opacity: 0;
            animation: 10s ease-in-out infinite both;
        }

        .workflow-dag .workflow-node {
            font-size: 1.1em;
            padding: 0.5em 1em;
            margin: 0.4em 0.5em;
            background-color: var(--nv-green);
        }

        .workflow-dag .workflow-arrow {
            margin: 0.4em auto;
            width: 3px;
            height: 25px;
            background-color: var(--annotation-text);
            position: relative;
        }

        .workflow-dag .workflow-arrow::after {
            content: "";
            position: absolute;
            bottom: -6px;
            left: 50%;
            transform: translateX(-50%);
            width: 0;
            height: 0;
            border-left: 6px solid transparent;
            border-right: 6px solid transparent;
            border-top: 8px solid var(--annotation-text);
        }

        .workflow-dag .workflow-arrow-split {
            margin: 0.4em 0 0.2em 0;
            display: flex;
            justify-content: center;
            align-items: center;
            gap: 4em;
            height: 32px;
            position: relative;
        }

        .workflow-dag .workflow-arrow-diagonal {
            position: absolute;
            width: 42px;
            height: 3px;
            background-color: var(--annotation-text);
            transform-origin: center;
        }

        .workflow-dag .workflow-arrow-diagonal.left {
            left: calc(50% - 48px);
            top: 8px;
            transform: rotate(-50deg);
        }

        .workflow-dag .workflow-arrow-diagonal.left::after {
            content: "";
            position: absolute;
            left: -5px;
            top: 50%;
            transform: translateY(-50%);
            width: 0;
            height: 0;
            border-top: 6px solid transparent;
            border-bottom: 6px solid transparent;
            border-right: 8px solid var(--annotation-text);
        }

        .workflow-dag .workflow-arrow-diagonal.right {
            right: calc(50% - 48px);
            top: 8px;
            transform: rotate(50deg);
        }

        .workflow-dag .workflow-arrow-diagonal.right::after {
            content: "";
            position: absolute;
            right: -5px;
            top: 50%;
            transform: translateY(-50%);
            width: 0;
            height: 0;
            border-top: 6px solid transparent;
            border-bottom: 6px solid transparent;
            border-left: 8px solid var(--annotation-text);
        }

        /* Staggered fade-in (6%, 12%, 18%, 24%, 30%), synchronized fade-out (80-85%) */
        @keyframes workflowDagStep1 {
            0% { opacity: 0; transform: translateY(10px); }
            6%, 80% { opacity: 1; transform: translateY(0); }
            85%, 100% { opacity: 0; transform: translateY(10px); }
        }

        @keyframes workflowDagStep2 {
            0%, 6% { opacity: 0; transform: translateY(10px); }
            12%, 80% { opacity: 1; transform: translateY(0); }
            85%, 100% { opacity: 0; transform: translateY(10px); }
        }

        @keyframes workflowDagStep3 {
            0%, 12% { opacity: 0; transform: translateY(10px); }
            18%, 80% { opacity: 1; transform: translateY(0); }
            85%, 100% { opacity: 0; transform: translateY(10px); }
        }

        @keyframes workflowDagStep4 {
            0%, 18% { opacity: 0; transform: translateY(10px); }
            24%, 80% { opacity: 1; transform: translateY(0); }
            85%, 100% { opacity: 0; transform: translateY(10px); }
        }

        @keyframes workflowDagStep5 {
            0%, 24% { opacity: 0; transform: translateY(10px); }
            30%, 80% { opacity: 1; transform: translateY(0); }
            85%, 100% { opacity: 0; transform: translateY(10px); }
        }

        .workflow-dag .workflow-step-1 { animation-name: workflowDagStep1; }
        .workflow-dag .workflow-step-2 { animation-name: workflowDagStep2; }
        .workflow-dag .workflow-step-3 { animation-name: workflowDagStep3; }
        .workflow-dag .workflow-step-4 { animation-name: workflowDagStep4; }
        .workflow-dag .workflow-step-5 { animation-name: workflowDagStep5; }
    </style>

    <div class="workflow-dag">
        <span class="sd-badge sd-bg-text-primary workflow-node workflow-step-1">preprocess</span>
        <div class="workflow-arrow workflow-step-2"></div>
        <span class="sd-badge sd-bg-text-primary workflow-node workflow-step-3">train</span>
        <div class="workflow-arrow-split workflow-step-4">
            <div class="workflow-arrow-diagonal left"></div>
            <div class="workflow-arrow-diagonal right"></div>
        </div>
        <span class="sd-badge sd-bg-text-primary workflow-node workflow-step-5">evaluate</span>
        <span class="sd-badge sd-bg-text-primary workflow-node workflow-step-5">export-onnx</span>
    </div>
