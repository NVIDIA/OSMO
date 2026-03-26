<!--
SPDX-FileCopyrightText: Copyright (c) 2025 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
SPDX-License-Identifier: Apache-2.0
-->

# Skill: Validate Beyond Tests

Read this after the quality gates pass. Tests passing means the test suite is green — it does not mean your changes work.

## What to think about

The test suite was written before your changes. It tests what the original authors thought to test. Your changes may have introduced behavior that no test exercises.

Ask yourself:
- What code paths did I change that are NOT covered by any test?
- Do the entry points (services, CLI commands, scripts) still start?
- Do the configs, models, and data structures I changed actually load at runtime?
- If I changed an API or interface, do all callers still work — not just the ones with tests?
- Are there integration points (between services, between modules) that only fail when run together?

## How to validate

Use your judgment. The right approach depends on what you changed. During discovery you may have found how to run the system locally — use it. The goal is confidence that your changes work in the real system, not just in the test harness.
