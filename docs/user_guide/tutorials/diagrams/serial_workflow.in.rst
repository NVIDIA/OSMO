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
        .serial-workflow-container {
            --diagram-size: 1em;
            --gap: 2.5em;
            --node-width: 90px;
            --storage-offset: 5.5em;
            max-width: 100%;
            overflow-x: auto;
            margin: 2em 0;
            display: flex;
            justify-content: center;
        }

        @media (max-width: 900px) { .serial-workflow-container { --diagram-size: 0.95em; --gap: 2.2em; } }
        @media (max-width: 700px) { .serial-workflow-container { --diagram-size: 0.85em; --gap: 1.8em; } }
        @media (max-width: 550px) { .serial-workflow-container { --diagram-size: 0.75em; --gap: 1.5em; } }

        .serial-workflow-container .serial-workflow {
            position: relative;
            display: flex;
            align-items: center;
            gap: var(--gap);
            font-size: var(--diagram-size);
            padding: calc(var(--storage-offset) + 2em) 1.5em 2.5em;
            min-width: min-content;
        }

        /* Storage cylinder */
        .serial-workflow-container .workflow-storage {
            position: absolute;
            top: 3em;
            left: 50%;
            transform: translateX(-50%);
            min-width: calc(var(--node-width) * 3 + var(--gap) * 2);
            padding: 0.5em 0.8em;
            font-size: 0.85em;
            text-align: center;
            white-space: nowrap;
            border-left: 2px solid var(--sd-color-muted);
            border-right: 2px solid var(--sd-color-muted);
            background: var(--sd-color-card-background);
            color: var(--sd-color-card-text);
            z-index: 1;
        }

        .serial-workflow-container .workflow-storage::before,
        .serial-workflow-container .workflow-storage::after {
            content: "";
            position: absolute;
            left: -2px;
            right: -2px;
            height: 0.5em;
            border: 2px solid var(--sd-color-muted);
            background: var(--sd-color-card-background);
        }

        .serial-workflow-container .workflow-storage::before {
            top: -0.25em;
            border-radius: 50%;
        }

        .serial-workflow-container .workflow-storage::after {
            bottom: -0.25em;
            border-top: none;
            border-radius: 0 0 50% 50% / 0 0 50% 50%;
        }

        /* Task nodes */
        .serial-workflow-container .workflow-task {
            position: relative;
            min-width: var(--node-width);
            padding: 0.6em 1.2em;
            font-weight: 600;
            text-align: center;
            white-space: nowrap;
            background: var(--nv-green);
            color: var(--sd-color-primary-text);
            border-radius: 4px;
            box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
        }

        /* Horizontal arrows */
        .serial-workflow-container .stage-arrow {
            position: relative;
            width: var(--gap);
            height: 2.5px;
            background: var(--annotation-text);
            flex-shrink: 0;
            margin: 0 calc(-0.5 * var(--gap));
        }

        .serial-workflow-container .stage-arrow::after {
            content: "";
            position: absolute;
            right: -0.65em;
            top: 50%;
            transform: translateY(-50%);
            border-left: 0.7em solid var(--annotation-text);
            border-top: 0.5em solid transparent;
            border-bottom: 0.5em solid transparent;
        }

        /* Vertical dashed arrows */
        .serial-workflow-container .storage-connector {
            position: absolute;
            bottom: 100%;
            height: calc(var(--storage-offset) - 3em);
            width: 2px;
            transform: translateX(-50%);
            border-left: 2px dashed var(--annotation-text);
            opacity: 0.6;
            pointer-events: none;
        }

        .serial-workflow-container .storage-connector::before {
            content: "";
            position: absolute;
            left: 50%;
            transform: translateX(-50%);
            border-left: 0.4em solid transparent;
            border-right: 0.4em solid transparent;
        }

        .serial-workflow-container .with-storage-input { left: 20%; }
        .serial-workflow-container .with-storage-input::before {
            bottom: 0;
            border-top: 0.5em solid var(--annotation-text);
        }

        .serial-workflow-container .with-storage-output { left: 80%; }
        .serial-workflow-container .with-storage-output::before {
            top: 0;
            border-bottom: 0.5em solid var(--annotation-text);
        }
    </style>
    <div class="serial-workflow-container">
        <div class="serial-workflow">
            <div class="workflow-storage">Intermediate Storage</div>
            <div class="workflow-task">
                Task 1
                <div class="storage-connector with-storage-output"></div>
            </div>
            <div class="stage-arrow"></div>
            <div class="workflow-task">
                <div class="storage-connector with-storage-input"></div>
                Task 2
                <div class="storage-connector with-storage-output"></div>
            </div>
            <div class="stage-arrow"></div>
            <div class="workflow-task">
                <div class="storage-connector with-storage-input"></div>
                Task 3
            </div>
        </div>
    </div>
