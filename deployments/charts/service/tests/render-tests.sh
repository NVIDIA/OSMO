#!/usr/bin/env bash

# SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: Apache-2.0

set -euo pipefail

CHART_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)

helm_args=(
    --namespace osmo
    --set 'services.backendApiTokens.enabled=true'
)

managed_render=$(helm template managed-test "$CHART_DIR" "${helm_args[@]}" \
    --set 'services.backendApiTokens.credentials[0].name=default' \
    --set 'services.backendApiTokens.credentials[0].managedSecret.name=agent-token')
grep -q '^kind: Job$' <<<"$managed_render"
grep -q 'image: "alpine/kubectl:1.33.4"' <<<"$managed_render"
grep -q -- '--from-file=token=/dev/stdin' <<<"$managed_render"
if grep -q 'backend_token_bootstrap' <<<"$managed_render"; then
    echo 'Managed backend credential still uses the service bootstrap binary' >&2
    exit 1
fi
if grep -q '^kind: Secret$' <<<"$managed_render"; then
    echo 'Managed backend credential rendered secret material' >&2
    exit 1
fi

existing_render=$(helm template existing-test "$CHART_DIR" "${helm_args[@]}" \
    --set 'services.backendApiTokens.credentials[0].name=default' \
    --set 'services.backendApiTokens.credentials[0].existingSecret.name=existing-token')
if grep -q 'backend_token_bootstrap' <<<"$existing_render"; then
    echo 'Existing backend credential unexpectedly rendered a bootstrap hook' >&2
    exit 1
fi
grep -q 'secretName: "existing-token"' <<<"$existing_render"

legacy_render=$(helm template legacy-test "$CHART_DIR" "${helm_args[@]}" \
    --set 'services.backendApiTokens.credentials[0].name=default' \
    --set 'services.backendApiTokens.credentials[0].secretName=legacy-token')
grep -q 'secretName: "legacy-token"' <<<"$legacy_render"

if helm template invalid "$CHART_DIR" "${helm_args[@]}" \
        --set 'services.backendApiTokens.credentials[0].name=default' \
        --set 'services.backendApiTokens.credentials[0].existingSecret.name=one' \
        --set 'services.backendApiTokens.credentials[0].managedSecret.name=two' \
        >/dev/null 2>&1; then
    echo 'Conflicting backend credential sources were accepted' >&2
    exit 1
fi

multiple_render=$(helm template multiple-test "$CHART_DIR" "${helm_args[@]}" \
    --set 'services.backendApiTokens.credentials[0].name=one' \
    --set 'services.backendApiTokens.credentials[0].managedSecret.name=token-one' \
    --set 'services.backendApiTokens.credentials[1].name=two' \
    --set 'services.backendApiTokens.credentials[1].managedSecret.name=token-two')
if [[ $(grep -c -- '^        - --secret-name$' <<<"$multiple_render") -ne 2 ]]; then
    echo 'Multiple managed backend credentials were not passed to the hook' >&2
    exit 1
fi

upgrade_render=$(helm template upgrade-test "$CHART_DIR" "${helm_args[@]}" \
    --is-upgrade \
    --set 'services.backendApiTokens.credentials[0].name=default' \
    --set 'services.backendApiTokens.credentials[0].managedSecret.name=agent-token')
grep -q -- '--fail-if-missing' <<<"$upgrade_render"
if [[ $(grep -c 'hook-failed' <<<"$upgrade_render") -ne 3 ]]; then
    echo 'Bootstrap RBAC hooks do not clean up after failure' >&2
    exit 1
fi
if grep -A8 '^kind: Job$' <<<"$upgrade_render" | grep -q 'hook-failed'; then
    echo 'Failed bootstrap Job would be deleted before diagnosis' >&2
    exit 1
fi

bash -n "$CHART_DIR/files/backend-token-bootstrap.sh"
bash "$CHART_DIR/tests/backend-token-bootstrap-tests.sh"
