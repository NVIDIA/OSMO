#!/usr/bin/env bash
# SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: Apache-2.0

set -euo pipefail

CHART_DIRECTORY=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
if [[ -n "${TEST_SRCDIR:-}" && -n "${TEST_WORKSPACE:-}" ]]; then
    BOOTSTRAP_SCRIPT="$TEST_SRCDIR/$TEST_WORKSPACE/deployments/charts/osmo/files/service-account-token-bootstrap.sh"
else
    BOOTSTRAP_SCRIPT="$CHART_DIRECTORY/files/service-account-token-bootstrap.sh"
fi
TEST_DIRECTORY=$(mktemp -d)
trap 'rm -rf "$TEST_DIRECTORY"' EXIT INT TERM
FAKE_BIN="$TEST_DIRECTORY/bin"
FAKE_STATE_DIRECTORY="$TEST_DIRECTORY/state"
mkdir -p "$FAKE_BIN" "$FAKE_STATE_DIRECTORY"

cat >"$FAKE_BIN/kubectl" <<'FAKE_KUBECTL'
#!/bin/sh
set -eu

printf '%s\n' "$*" >>"$FAKE_STATE_DIRECTORY/commands"

if [ "$1" = get ]; then
    if [ "$2" = configmap ]; then
        config_map_name="$3"
        state_file="$FAKE_STATE_DIRECTORY/$config_map_name.managed-secrets"
        if [ ! -f "$state_file" ]; then
            case "$*" in
                *--ignore-not-found=true*) exit 0 ;;
                *) exit 1 ;;
            esac
        fi
        cat "$state_file"
        exit 0
    fi
    if [ "$2" = deployment ]; then
        deployment_name="$3"
        state_file="$FAKE_STATE_DIRECTORY/$deployment_name.backend-token-volumes"
        if [ ! -f "$state_file" ]; then
            case "$*" in
                *--ignore-not-found=true*) exit 0 ;;
                *) exit 1 ;;
            esac
        fi
        case "$*" in
            *metadata.name*) printf '%s' "$deployment_name" ;;
            *) cat "$state_file" ;;
        esac
        exit 0
    fi
    secret_name="$3"
    output_arguments="$*"
    if [ ! -f "$FAKE_STATE_DIRECTORY/$secret_name.token" ]; then
        case "$output_arguments" in
            *--ignore-not-found=true*) exit 0 ;;
            *) exit 1 ;;
        esac
    fi
    case "$output_arguments" in
        *metadata.name*) printf '%s' "$secret_name" ;;
        *previous-token*)
            if [ -f "$FAKE_STATE_DIRECTORY/$secret_name.previous-token" ]; then
                base64 <"$FAKE_STATE_DIRECTORY/$secret_name.previous-token" | tr -d '\n'
            else
                case "$output_arguments" in
                    *'{{with index '*) ;;
                    *) printf '<no value>' ;;
                esac
            fi
            ;;
        *username*)
            if [ -f "$FAKE_STATE_DIRECTORY/$secret_name.username" ]; then
                base64 <"$FAKE_STATE_DIRECTORY/$secret_name.username" | tr -d '\n'
            fi
            ;;
        *roles*)
            if [ -f "$FAKE_STATE_DIRECTORY/$secret_name.roles" ]; then
                base64 <"$FAKE_STATE_DIRECTORY/$secret_name.roles" | tr -d '\n'
            fi
            ;;
        *token*) base64 <"$FAKE_STATE_DIRECTORY/$secret_name.token" | tr -d '\n' ;;
    esac
    exit 0
fi

if [ "$1" = create ] && [ "$2" = -f ]; then
    manifest_file="$FAKE_STATE_DIRECTORY/created-secret.yaml"
    cat >"$manifest_file"
    secret_name=$(awk '$1 == "name:" { print $2; exit }' "$manifest_file")
    encoded_token=$(awk '$1 == "token:" { print $2; exit }' "$manifest_file")
    encoded_username=$(awk '$1 == "username:" { print $2; exit }' "$manifest_file")
    encoded_roles=$(awk '$1 == "roles:" { print $2; exit }' "$manifest_file")
    printf '%s' "$encoded_token" | base64 --decode \
        >"$FAKE_STATE_DIRECTORY/pending-token"
    if [ "${FAKE_CREATE_FAILURE:-false}" = true ]; then
        rm -f "$FAKE_STATE_DIRECTORY/pending-token"
        exit 1
    fi
    cp "$FAKE_STATE_DIRECTORY/pending-token" \
        "$FAKE_STATE_DIRECTORY/$secret_name.token"
    printf '%s' "$encoded_username" | base64 --decode \
        >"$FAKE_STATE_DIRECTORY/$secret_name.username"
    printf '%s' "$encoded_roles" | base64 --decode \
        >"$FAKE_STATE_DIRECTORY/$secret_name.roles"
    rm -f "$FAKE_STATE_DIRECTORY/pending-token"
    if [ "${FAKE_CREATE_RACE:-false}" = true ]; then
        exit 1
    fi
    exit 0
fi

if [ "$1" = patch ] && [ "$2" = secret ]; then
    secret_name="$3"
    patch_json="$9"
    encoded_username=$(printf '%s' "$patch_json" \
        | sed -n 's/.*"username":"\([^"]*\)".*/\1/p')
    encoded_roles=$(printf '%s' "$patch_json" \
        | sed -n 's/.*"roles":"\([^"]*\)".*/\1/p')
    printf '%s' "$encoded_username" | base64 --decode \
        >"$FAKE_STATE_DIRECTORY/$secret_name.username"
    printf '%s' "$encoded_roles" | base64 --decode \
        >"$FAKE_STATE_DIRECTORY/$secret_name.roles"
    exit 0
fi

printf 'Unexpected fake kubectl command: %s\n' "$*" >&2
exit 1
FAKE_KUBECTL
chmod +x "$FAKE_BIN/kubectl"

export FAKE_STATE_DIRECTORY
export PATH="$FAKE_BIN:$PATH"

run_bootstrap() {
    bash "$BOOTSTRAP_SCRIPT" \
        --namespace osmo \
        --release-name test-release \
        --state-config-map service-account-token-bootstrap-state \
        --api-deployment-name osmo-api \
        "$@"
}

require_command_count() {
    local command=$1
    local expected=$2
    local actual
    actual=$(grep -Fc -- "$command" "$FAKE_STATE_DIRECTORY/commands" || true)
    if [[ "$actual" -ne "$expected" ]]; then
        echo "Expected '$command' $expected times, found $actual" >&2
        exit 1
    fi
}

: >"$FAKE_STATE_DIRECTORY/commands"
output=$(run_bootstrap --credential 'generated-token|admin|osmo-admin,osmo-default')
generated_token=$(cat "$FAKE_STATE_DIRECTORY/generated-token.token")
if [[ ${#generated_token} -ne 43 ]]; then
    echo 'Generated service account token does not have the required 43-character length' >&2
    exit 1
fi
if [[ "$generated_token" == *[!A-Za-z0-9_-]* ]]; then
    echo 'Generated service account token is not URL-safe' >&2
    exit 1
fi
if [[ "$output" == *"$generated_token"* ]]; then
    echo 'Bootstrap output exposed generated token material' >&2
    exit 1
fi
if [[ "$(cat "$FAKE_STATE_DIRECTORY/generated-token.username")" != admin ]] || \
        [[ "$(cat "$FAKE_STATE_DIRECTORY/generated-token.roles")" != \
            $'osmo-admin\nosmo-default' ]]; then
    echo 'Generated Secret does not contain the configured identity' >&2
    exit 1
fi
require_command_count "get secret generated-token" 1
require_command_count "create -f -" 1
require_command_count "label --local" 0
require_command_count "annotate --local" 0
if ! grep -Fq 'app.kubernetes.io/managed-by: osmo-service-account-token-bootstrap' \
        "$FAKE_STATE_DIRECTORY/created-secret.yaml" || \
        ! grep -Fq 'osmo.nvidia.com/credential-source: osmo-chart-bootstrap' \
        "$FAKE_STATE_DIRECTORY/created-secret.yaml"; then
    echo 'Created service account token Secret is missing managed metadata' >&2
    exit 1
fi

output=$(run_bootstrap --credential 'generated-token|admin|osmo-admin,osmo-default')
if [[ "$output" != *'already exists; preserving its token'* ]]; then
    echo 'Existing service account token was not preserved' >&2
    exit 1
fi
if ! grep -q '{{with index .data "previous-token"}}{{.}}{{end}}' \
        "$FAKE_STATE_DIRECTORY/commands"; then
    echo 'Optional token lookup does not suppress the kubectl missing-value marker' >&2
    exit 1
fi

previous_token=$(printf 'p%.0s' {1..43})
printf '%s' "$previous_token" > \
    "$FAKE_STATE_DIRECTORY/generated-token.previous-token"
run_bootstrap --credential 'generated-token|admin|osmo-admin,osmo-default' >/dev/null

printf '%s' "$generated_token" > \
    "$FAKE_STATE_DIRECTORY/generated-token.previous-token"
if output=$(run_bootstrap \
        --credential 'generated-token|admin|osmo-admin,osmo-default' 2>&1); then
    echo 'Duplicate current and previous service account tokens were accepted' >&2
    exit 1
fi
if [[ "$output" != *'contains duplicate tokens'* ]]; then
    echo 'Duplicate-token failure did not identify the invalid Secret' >&2
    exit 1
fi
rm -f "$FAKE_STATE_DIRECTORY/generated-token.previous-token"

printf 'short' >"$FAKE_STATE_DIRECTORY/invalid-token.token"
printf 'admin' >"$FAKE_STATE_DIRECTORY/invalid-token.username"
printf 'osmo-admin' >"$FAKE_STATE_DIRECTORY/invalid-token.roles"
if output=$(run_bootstrap --credential 'invalid-token|admin|osmo-admin' 2>&1); then
    echo 'Invalid service account token format was accepted' >&2
    exit 1
fi
if [[ "$output" != *'key token has invalid format'* ]]; then
    echo 'Invalid-token failure did not identify the invalid key' >&2
    exit 1
fi

printf '%s\n' generated-token missing-token \
    >"$FAKE_STATE_DIRECTORY/service-account-token-bootstrap-state.managed-secrets"
output=$(run_bootstrap --is-upgrade \
    --credential 'generated-token|admin|osmo-admin' \
    --credential 'newly-added-token|automation|osmo-default')
if [[ "$output" != *'already exists; preserving its token'* ]] || \
        [[ "$output" != *'Created service account token Secret newly-added-token'* ]]; then
    echo 'Upgrade did not preserve an existing token and create a newly added token' >&2
    exit 1
fi
if [[ "$(cat "$FAKE_STATE_DIRECTORY/generated-token.roles")" != osmo-admin ]] || \
        [[ "$(cat "$FAKE_STATE_DIRECTORY/generated-token.token")" != "$generated_token" ]]; then
    echo 'Upgrade did not reconcile roles while preserving token material' >&2
    exit 1
fi
require_command_count "patch secret generated-token" 1

if output=$(run_bootstrap --is-upgrade \
        --credential 'missing-token|admin|osmo-admin' 2>&1); then
    echo 'Upgrade unexpectedly regenerated a missing service account token' >&2
    exit 1
fi
if [[ "$output" != *'missing during upgrade'* ]]; then
    echo 'Missing-upgrade failure did not explain the recovery action' >&2
    exit 1
fi

rm -f "$FAKE_STATE_DIRECTORY/service-account-token-bootstrap-state.managed-secrets"
printf '%s\n' \
    'backend-token-prior missing-migration-token' \
    >"$FAKE_STATE_DIRECTORY/osmo-api.backend-token-volumes"
if output=$(run_bootstrap --is-upgrade \
        --credential 'missing-migration-token|backend-operator-default|osmo-backend' 2>&1); then
    echo 'Migration upgrade regenerated a missing previously mounted service account token' >&2
    exit 1
fi
if [[ "$output" != *'missing during upgrade'* ]]; then
    echo 'Migration failure did not explain the service account token recovery action' >&2
    exit 1
fi
output=$(run_bootstrap --is-upgrade \
    --credential 'migration-new-token|admin|osmo-admin')
if [[ "$output" != *'Created service account token Secret migration-new-token'* ]]; then
    echo 'Migration upgrade did not create a newly added service account token' >&2
    exit 1
fi

rm -f "$FAKE_STATE_DIRECTORY/osmo-api.backend-token-volumes"
if output=$(run_bootstrap --is-upgrade \
        --credential 'missing-history-token|admin|osmo-admin' 2>&1); then
    echo 'Upgrade without state or an API Deployment regenerated a service account token' >&2
    exit 1
fi
if [[ "$output" != *'No service account token state or API Deployment osmo-api was found during upgrade'* ]]; then
    echo 'Missing-history failure did not explain the recovery action' >&2
    exit 1
fi

export FAKE_CREATE_RACE=true
output=$(run_bootstrap --credential 'raced-token|admin|osmo-admin')
unset FAKE_CREATE_RACE
if [[ "$output" != *'created concurrently; preserving it'* ]]; then
    echo 'Concurrent Secret creation was not reconciled' >&2
    exit 1
fi

export FAKE_CREATE_FAILURE=true
if output=$(run_bootstrap --credential 'failed-token|admin|osmo-admin' 2>&1); then
    echo 'Bootstrap unexpectedly ignored a Secret create failure' >&2
    exit 1
fi
unset FAKE_CREATE_FAILURE
if [[ "$output" != *'Unable to create service account token Secret failed-token'* ]]; then
    echo 'Secret create failure did not identify the affected Secret' >&2
    exit 1
fi

echo 'PASS: service account token bootstrap tests'
