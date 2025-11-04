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
        .workflow-groups-container {
            --diagram-base-size: 0.8em;
            --diagram-gap: 2em;
            --group-gap: 1em;
            --column-padding: 0.6em 0.5em;
            --task-padding: 0.4em 0.7em;
            --dataset-padding: 0.6em 0.3em;
            --border-width: 2px;
            --border-radius: 4px;
            --node-font-size: 0.9em;
            --node-min-width: 55px;
            --cylinder-cap-height: 0.6em;
            --cylinder-cap-offset: -0.3em;
            --arrow-thickness: 2px;
            --arrow-head-width: 0.5em;
            --arrow-head-height: 0.4em;
            --arrow-vertical-offset: 5em;
            --inner-arrow-width: 1.2em;
            --inner-arrow-head-width: 0.4em;
            --inner-arrow-head-height: 0.3em;

            max-width: 100%;
            overflow-x: auto;
            margin: 1.5em 0;
            display: flex;
            justify-content: center;
        }

        @media (max-width: 900px) { .workflow-groups-container { --diagram-base-size: 0.8em; --diagram-gap: 1.7em; } }
        @media (max-width: 750px) { .workflow-groups-container { --diagram-base-size: 0.7em; --diagram-gap: 1.5em; } }
        @media (max-width: 600px) { .workflow-groups-container { --diagram-base-size: 0.6em; --diagram-gap: 1.2em; } }
        @media (max-width: 500px) { .workflow-groups-container { --diagram-base-size: 0.5em; --diagram-gap: 1em; } }

        .workflow-groups-container .workflow-groups {
            position: relative;
            display: flex;
            gap: var(--diagram-gap);
            align-items: stretch;
            justify-content: center;
            min-width: min-content;
            padding: 0.5em;
        }

        .workflow-groups-container .workflow-groups-left,
        .workflow-groups-container .workflow-groups-right {
            flex: 0 0 auto;
            display: flex;
        }

        .workflow-groups-container .workflow-groups-left {
            align-items: center;
        }

        .workflow-groups-container .workflow-groups-right {
            flex-direction: column;
            justify-content: space-evenly;
            gap: var(--diagram-gap);
        }

        .workflow-groups-container .workflow-group {
            position: relative;
            font-size: var(--diagram-base-size);
            border: var(--border-width) solid var(--sd-color-primary);
            border-radius: var(--border-radius);
            background: var(--sd-color-card-background);
            overflow: hidden;
            margin-bottom: 1.0em;
        }

        .workflow-groups-container .workflow-group-header {
            padding: 0.4em 0.8em;
            background: var(--nv-green);
            color: var(--sd-color-primary-text);
            font-weight: bold;
            text-align: center;
        }

        .workflow-groups-container .workflow-group-body {
            display: grid;
            grid-template-columns: repeat(3, 1fr);
            border-top: 1px solid var(--sd-color-card-border);
        }

        .workflow-groups-container .workflow-group-column {
            padding: var(--column-padding);
            display: flex;
            flex-direction: column;
            gap: var(--group-gap);
            align-items: center;
            border-right: 1px solid var(--sd-color-card-border);
            padding-bottom: 1.5em;
        }

        .workflow-groups-container .workflow-group-column:last-child {
            border-right: none;
        }

        .workflow-groups-container .workflow-group-column-title {
            margin-bottom: 0.3em;
            font-weight: bold;
            font-size: 0.95em;
            color: var(--sd-color-card-text);
        }

        .workflow-groups-container .workflow-task,
        .workflow-groups-container .workflow-dataset {
            position: relative;
            font-size: var(--node-font-size);
            text-align: center;
            white-space: nowrap;
        }

        .workflow-groups-container .workflow-task {
            z-index: 2;
            min-width: var(--node-min-width);
            padding: var(--task-padding);
            background: var(--nv-green);
            color: var(--sd-color-primary-text);
            border-radius: 3px;
            font-weight: normal;
        }

        .workflow-groups-container .workflow-dataset {
            z-index: 1;
            width: fit-content;
            padding: var(--dataset-padding);
            border-left: var(--border-width) solid var(--sd-color-muted);
            border-right: var(--border-width) solid var(--sd-color-muted);
            background: var(--sd-color-card-background);
            color: var(--sd-color-card-text);
        }

        .workflow-groups-container .workflow-dataset::before,
        .workflow-groups-container .workflow-dataset::after {
            content: "";
            position: absolute;
            left: calc(-1 * var(--border-width));
            right: calc(-1 * var(--border-width));
            height: var(--cylinder-cap-height);
            border: var(--border-width) solid var(--sd-color-muted);
            background: var(--sd-color-card-background);
        }

        .workflow-groups-container .workflow-dataset::before {
            top: var(--cylinder-cap-offset);
            border-radius: 50%;
        }

        .workflow-groups-container .workflow-dataset::after {
            bottom: var(--cylinder-cap-offset);
            border-top: none;
            border-radius: 0 0 50% 50% / 0 0 50% 50%;
        }

        .workflow-groups-container .workflow-connector {
            position: relative;
            width: calc(var(--diagram-gap) * 1);
            margin: 0 0.3em;
            flex-shrink: 0;
            z-index: 1;
        }

        .workflow-groups-container .workflow-arrow {
            position: absolute;
            top: 50%;
            height: 0;
            left: 0;
            pointer-events: none;
        }

        .workflow-groups-container .workflow-arrow::before,
        .workflow-groups-container .workflow-arrow::after {
            content: "";
            position: absolute;
            background: var(--annotation-text);
        }

        .workflow-groups-container .workflow-arrow::before {
            left: calc(var(--diagram-gap) * -0.5);
            top: 0;
            width: calc(var(--diagram-gap) * 1);
            height: var(--arrow-thickness);
        }

        .workflow-groups-container .workflow-arrow::after {
            left: calc(var(--diagram-gap) * 0.5);
            width: var(--arrow-thickness);
        }

        .workflow-groups-container .workflow-arrow-end {
            position: absolute;
            left: calc(var(--diagram-gap) * 0.5);
            height: var(--arrow-thickness);
            width: calc(var(--diagram-gap) * 1);
            background: var(--annotation-text);
        }

        .workflow-groups-container .workflow-arrow-end::after {
            content: "";
            position: absolute;
            right: -0.05em;
            top: 50%;
            transform: translateY(-50%);
            width: 0;
            height: 0;
            border-left: var(--arrow-head-width) solid var(--annotation-text);
            border-top: var(--arrow-head-height) solid transparent;
            border-bottom: var(--arrow-head-height) solid transparent;
        }

        .workflow-groups-container .workflow-arrow-to-group2::after {
            top: calc(-1 * var(--arrow-vertical-offset));
            height: var(--arrow-vertical-offset);
        }

        .workflow-groups-container .workflow-arrow-to-group2 .workflow-arrow-end {
            top: calc(-1 * var(--arrow-vertical-offset));
        }

        .workflow-groups-container .workflow-arrow-to-group3::after {
            top: 0;
            height: var(--arrow-vertical-offset);
        }

        .workflow-groups-container .workflow-arrow-to-group3 .workflow-arrow-end {
            top: var(--arrow-vertical-offset);
        }

        .workflow-groups-container .horizontal-arrow::after {
            content: "";
            position: absolute;
            left: 100%;
            top: 50%;
            width: var(--inner-arrow-width);
            height: var(--arrow-thickness);
            background: var(--annotation-text);
            transform: translateY(-50%);
            z-index: 10;
        }

        .workflow-groups-container .horizontal-arrow::before {
            content: "";
            position: absolute;
            left: calc(100% + var(--inner-arrow-width));
            top: 50%;
            width: 0;
            height: 0;
            border-left: var(--inner-arrow-head-width) solid var(--annotation-text);
            border-top: var(--inner-arrow-head-height) solid transparent;
            border-bottom: var(--inner-arrow-head-height) solid transparent;
            transform: translateY(-50%);
            z-index: 10;
        }

        .workflow-groups-container .arrow-wrapper {
            position: relative;
            display: inline-block;
        }

        .workflow-groups-container .diagonal-arrow {
            position: absolute;
            left: 100%;
            height: var(--arrow-thickness);
            background: var(--annotation-text);
            transform-origin: left center;
            z-index: 10;
        }

        .workflow-groups-container .diagonal-arrow::after {
            content: "";
            position: absolute;
            right: calc(-1 * var(--inner-arrow-head-width));
            top: 50%;
            width: 0;
            height: 0;
            border-left: var(--inner-arrow-head-width) solid var(--annotation-text);
            border-top: var(--inner-arrow-head-height) solid transparent;
            border-bottom: var(--inner-arrow-head-height) solid transparent;
            transform: translateY(-50%);
        }

        .workflow-groups-container .diagonal-up-1 { top: 40%; width: 1.4em; transform: rotate(-30deg); }
        .workflow-groups-container .diagonal-down-1 { top: 60%; width: 1.4em; transform: rotate(35deg); }
        .workflow-groups-container .diagonal-up-2 { top: 40%; width: 1.2em; transform: rotate(-25deg); }
        .workflow-groups-container .diagonal-down-2 { top: 60%; width: 1.4em; transform: rotate(35deg); }
    </style>
    <div class="workflow-groups-container">
        <div class="workflow-groups">

            <div class="workflow-groups-left">

                <div class="workflow-group">
                    <div class="workflow-group-header">Group 1</div>
                    <div class="workflow-group-body">
                        <div class="workflow-group-column">
                            <div class="workflow-group-column-title">Inputs</div>
                            <div style="flex: 0;"></div>
                            <div class="arrow-wrapper">
                                <div class="workflow-dataset">Dataset 1</div>
                                <div class="diagonal-arrow diagonal-up-1"></div>
                                <div class="diagonal-arrow diagonal-down-1"></div>
                            </div>
                            <div class="arrow-wrapper">
                                <div class="workflow-dataset">Dataset 2</div>
                                <div class="diagonal-arrow diagonal-up-2"></div>
                                <div class="diagonal-arrow diagonal-down-2"></div>
                            </div>
                        </div>
                        <div class="workflow-group-column">
                            <div class="workflow-group-column-title">Tasks</div>
                            <div class="workflow-task">Task 1</div>
                            <div class="workflow-task horizontal-arrow">Task 2</div>
                            <div class="workflow-task">Task 3</div>
                        </div>
                        <div class="workflow-group-column">
                            <div class="workflow-group-column-title">Outputs</div>
                            <div style="flex: 0.4;"></div>
                            <div class="workflow-dataset">Dataset 3</div>
                        </div>
                    </div>
                </div>

            </div>

            <div class="workflow-connector">
                <div class="workflow-arrow workflow-arrow-to-group2">
                    <div class="workflow-arrow-end"></div>
                </div>
                <div class="workflow-arrow workflow-arrow-to-group3">
                    <div class="workflow-arrow-end"></div>
                </div>
            </div>

            <div class="workflow-groups-right">

                <div class="workflow-group">
                    <div class="workflow-group-header">Group 2</div>
                    <div class="workflow-group-body">
                        <div class="workflow-group-column">
                            <div class="workflow-group-column-title">Inputs</div>
                            <div style="flex: 1;"></div>
                            <div class="arrow-wrapper">
                                <div class="workflow-dataset">Dataset 3</div>
                                <div class="horizontal-arrow"></div>
                            </div>
                        </div>
                        <div class="workflow-group-column">
                            <div class="workflow-group-column-title">Tasks</div>
                            <div style="flex: 1;"></div>
                            <div class="workflow-task horizontal-arrow">Task 4</div>
                        </div>
                        <div class="workflow-group-column">
                            <div class="workflow-group-column-title">Outputs</div>
                            <div style="flex: 1;"></div>
                            <div class="workflow-dataset">Dataset 4</div>
                        </div>
                    </div>
                </div>

                <div class="workflow-group">
                    <div class="workflow-group-header">Group 3</div>
                    <div class="workflow-group-body">
                        <div class="workflow-group-column">
                            <div class="workflow-group-column-title">Inputs</div>
                            <div class="arrow-wrapper">
                                <div class="workflow-dataset">Dataset 3</div>
                                <div class="horizontal-arrow"></div>
                            </div>
                        </div>
                        <div class="workflow-group-column">
                            <div class="workflow-group-column-title">Tasks</div>
                            <div class="workflow-task">Task 5</div>
                            <div class="workflow-task horizontal-arrow">Task 6</div>
                        </div>
                        <div class="workflow-group-column">
                            <div class="workflow-group-column-title">Outputs</div>
                            <div style="flex: 1;"></div>
                            <div class="workflow-dataset">Dataset 5</div>
                        </div>
                    </div>
                </div>

            </div>
        </div>
    </div>
