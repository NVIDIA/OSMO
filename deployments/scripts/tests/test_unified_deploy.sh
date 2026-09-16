#!/usr/bin/env bash
# SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: Apache-2.0
set -euo pipefail
exec python3 "${TEST_SRCDIR}/_main/deployments/scripts/tests/test_unified_deploy.py"
