<!--
SPDX-FileCopyrightText: Copyright (c) 2025 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
SPDX-License-Identifier: Apache-2.0
-->

# Quality Gate Fallbacks

Read this only if the repo has no linters, test runners, or CI configs.

| Language | Quick check | Full check |
|----------|------------|------------|
| Python | `python -m py_compile <file>` | `python -m pytest` (if tests exist) |
| Go | `go vet ./...` | `go test ./...` |
| TypeScript | `npx tsc --noEmit` | `npm test` (if configured) |
| JavaScript | `node --check <file>` | `npm test` (if configured) |
| Rust | `cargo check` | `cargo test` |
| C/C++ | `make` (if Makefile) | `make test` (if target exists) |
| Java | `mvn compile` / `gradle build` | `mvn test` / `gradle test` |

If tests don't exist at all, at minimum verify syntax/compilation of changed files.
