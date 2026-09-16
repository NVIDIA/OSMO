#!/usr/bin/env bash
# SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: Apache-2.0
# Foreground gateway access. Stop with Ctrl-C; no detached watchdog or global process cleanup.
set -euo pipefail
if [[ "${1:-}" == --* ]]; then
    echo 'Usage: port-forward.sh [namespace=osmo] [local-port=9000] [gateway-service=osmo-gateway] [service-port=80]' >&2
    exit 2
fi
exec kubectl --namespace "${1:-osmo}" port-forward "service/${3:-osmo-gateway}" "${2:-9000}:${4:-80}"
