<!--
SPDX-FileCopyrightText: Copyright (c) 2025 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
SPDX-License-Identifier: Apache-2.0
-->

# Skill: Preflight

**Align your container's runtime with the repo's target versions.** "Close enough" is not aligned — you must match exactly.

## What to do

1. Discover what runtimes and versions the repo targets by reading its build configs.
2. Check what your container has.
3. If there is a mismatch, install the correct version — even if a build system manages its own toolchain. The system runtime is used for more than builds: dependency resolution, lock file generation, code generation, linting, and ad-hoc scripts all use it. You cannot predict every way the system runtime will be invoked. Align it. You have `sudo` access. If installation fails, you are **blocked** — report it and exit.
4. Verify alignment by running the repo's build command.
5. Write `/tmp/environment.json`. This is a runtime artifact — do NOT commit it.
