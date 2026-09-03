#!/bin/ash
# shellcheck shell=sh disable=SC2187,SC3040
# SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: Apache-2.0

set -eu
set -o pipefail

is_upgrade=false
namespace=""
release_name=""
state_config_map=""
api_deployment_name=""
credential_specs=""
previously_managed_secret_names=""

log_error() {
    printf 'ERROR %s\n' "$*" >&2
}

read_secret_name() {
    kubectl get secret "$1" \
        --namespace "$namespace" \
        --ignore-not-found=true \
        -o go-template='{{.metadata.name}}'
}

read_managed_secret_state() {
    kubectl get configmap "$state_config_map" \
        --namespace "$namespace" \
        --ignore-not-found=true \
        -o go-template='{{with index .data "managed-secrets"}}{{.}}{{end}}'
}

read_pre_state_managed_secrets() {
    kubectl get deployment "$api_deployment_name" \
        --namespace "$namespace" \
        --ignore-not-found=true \
        -o go-template='{{range .spec.template.spec.volumes}}{{.name}} {{with .secret}}{{.secretName}}{{end}}{{"\n"}}{{end}}' \
        | awk '$1 ~ /^(backend-token-|service-account-token-)/ && NF == 2 { print $2 }'
}

read_api_deployment_name() {
    kubectl get deployment "$api_deployment_name" \
        --namespace "$namespace" \
        --ignore-not-found=true \
        -o go-template='{{.metadata.name}}'
}

was_previously_managed() {
    printf '%s\n' "$previously_managed_secret_names" | grep -Fxq -- "$1"
}

decode_secret_value() {
    secret_name="$1"
    token_key="$2"
    output_file="$3"

    encoded_token=$(kubectl get secret "$secret_name" \
        --namespace "$namespace" \
        -o "go-template={{with index .data \"$token_key\"}}{{.}}{{end}}") || {
        log_error "Unable to read service account token Secret $secret_name"
        return 1
    }
    if [ -z "$encoded_token" ]; then
        return 2
    fi
    if ! printf '%s' "$encoded_token" | base64 -d >"$output_file"; then
        log_error "Service account token Secret $secret_name key $token_key is invalid"
        return 1
    fi
}

normalize_token() {
    token_file="$1"
    token_length=$(wc -c <"$token_file" | tr -d ' ')

    case "$token_length" in
        43|64)
            ;;
        44|65)
            if [ "$(tail -c 1 "$token_file" | od -An -tu1 | tr -d ' ')" != "10" ]; then
                return 1
            fi
            head -c $((token_length - 1)) "$token_file" >"$token_file.normalized"
            mv "$token_file.normalized" "$token_file"
            ;;
        45|66)
            if [ "$(tail -c 2 "$token_file" | od -An -tu1 | tr -s ' ' | sed 's/^ //')" \
                    != "13 10" ]; then
                return 1
            fi
            head -c $((token_length - 2)) "$token_file" >"$token_file.normalized"
            mv "$token_file.normalized" "$token_file"
            ;;
        *)
            return 1
            ;;
    esac

    token_length=$(wc -c <"$token_file" | tr -d ' ')
    case "$token_length" in
        43|64)
            ;;
        *)
            return 1
            ;;
    esac
    if LC_ALL=C grep -q '[^A-Za-z0-9_-]' "$token_file"; then
        return 1
    fi
}

validate_identity() {
    username="$1"
    roles="$2"

    username_length=$(printf '%s' "$username" | wc -c | tr -d ' ')
    if [ "$username_length" -gt 255 ] || \
            ! printf '%s' "$username" | grep -Eq \
                '^[A-Za-z0-9]([A-Za-z0-9_.@-]*[A-Za-z0-9])?$'; then
        return 1
    fi
    if [ -z "$roles" ] || printf '%s\n' "$roles" | grep -Eq '^$'; then
        return 1
    fi
    if [ "$(printf '%s\n' "$roles" | sort | uniq -d | wc -l | tr -d ' ')" -ne 0 ]; then
        return 1
    fi
    while IFS= read -r role; do
        role_length=$(printf '%s' "$role" | wc -c | tr -d ' ')
        if [ "$role_length" -gt 255 ] || \
                ! printf '%s' "$role" | grep -Eq \
                    '^[A-Za-z0-9]([-A-Za-z0-9_.:@/]*[A-Za-z0-9])?$'; then
            return 1
        fi
    done <<EOF
$roles
EOF
}

validate_secret() {
    secret_name="$1"
    temporary_directory=$(mktemp -d)
    trap 'rm -rf "$temporary_directory"' EXIT INT TERM

    if decode_secret_value "$secret_name" token "$temporary_directory/token"; then
        :
    else
        status=$?
        if [ "$status" -eq 2 ]; then
            log_error "Service account token Secret $secret_name is missing key token"
        fi
        return 1
    fi
    if ! normalize_token "$temporary_directory/token"; then
        log_error "Service account token Secret $secret_name key token has invalid format"
        return 1
    fi

    if decode_secret_value "$secret_name" previous-token "$temporary_directory/previous-token"; then
        if ! normalize_token "$temporary_directory/previous-token"; then
            log_error "Service account token Secret $secret_name key previous-token has invalid format"
            return 1
        fi
        if cmp -s "$temporary_directory/token" "$temporary_directory/previous-token"; then
            log_error "Service account token Secret $secret_name contains duplicate tokens"
            return 1
        fi
    else
        status=$?
        if [ "$status" -ne 2 ]; then
            return 1
        fi
    fi

    rm -rf "$temporary_directory"
    trap - EXIT INT TERM
}

reconcile_identity() {
    secret_name="$1"
    expected_username="$2"
    expected_roles="$3"
    temporary_directory=$(mktemp -d)
    trap 'rm -rf "$temporary_directory"' EXIT INT TERM

    actual_username=""
    actual_roles=""
    if decode_secret_value "$secret_name" username "$temporary_directory/username"; then
        actual_username=$(cat "$temporary_directory/username")
    else
        status=$?
        if [ "$status" -ne 2 ]; then
            return 1
        fi
    fi
    if decode_secret_value "$secret_name" roles "$temporary_directory/roles"; then
        actual_roles=$(cat "$temporary_directory/roles")
    else
        status=$?
        if [ "$status" -ne 2 ]; then
            return 1
        fi
    fi
    if [ "$actual_username" = "$expected_username" ] && [ "$actual_roles" = "$expected_roles" ]; then
        rm -rf "$temporary_directory"
        trap - EXIT INT TERM
        return
    fi

    encoded_username=$(printf '%s' "$expected_username" | base64 | tr -d '\n')
    encoded_roles=$(printf '%s' "$expected_roles" | base64 | tr -d '\n')
    if ! kubectl patch secret "$secret_name" \
            --namespace "$namespace" \
            --type merge \
            -p "{\"data\":{\"username\":\"$encoded_username\",\"roles\":\"$encoded_roles\"}}" \
            >/dev/null; then
        log_error "Unable to reconcile service account identity in Secret $secret_name"
        return 1
    fi
    printf 'INFO Reconciled service account identity in Secret %s\n' "$secret_name"
    rm -rf "$temporary_directory"
    trap - EXIT INT TERM
}

create_secret() {
    secret_name="$1"
    username="$2"
    roles="$3"
    encoded_token=$(head -c 32 /dev/urandom \
        | base64 \
        | tr '/+' '_-' \
        | tr -d '=\n' \
        | base64 \
        | tr -d '\n')
    encoded_username=$(printf '%s' "$username" | base64 | tr -d '\n')
    encoded_roles=$(printf '%s' "$roles" | base64 | tr -d '\n')
    if printf '%s\n' \
            'apiVersion: v1' \
            'kind: Secret' \
            'metadata:' \
            "  name: $secret_name" \
            "  namespace: $namespace" \
            '  labels:' \
            '    app.kubernetes.io/managed-by: osmo-service-account-token-bootstrap' \
            "    app.kubernetes.io/instance: $release_name" \
            '  annotations:' \
            '    osmo.nvidia.com/credential-source: osmo-chart-bootstrap' \
            'type: Opaque' \
            'data:' \
            "  token: $encoded_token" \
            "  username: $encoded_username" \
            "  roles: $encoded_roles" \
            | kubectl create -f - >/dev/null; then
        printf 'INFO Created service account token Secret %s\n' "$secret_name"
        return
    fi

    existing_name=$(read_secret_name "$secret_name") || {
        log_error "Unable to verify service account token Secret $secret_name after create failure"
        return 1
    }
    if [ -z "$existing_name" ]; then
        log_error "Unable to create service account token Secret $secret_name"
        return 1
    fi
    validate_secret "$secret_name"
    reconcile_identity "$secret_name" "$username" "$roles"
    printf 'INFO Service account token Secret %s was created concurrently; preserving it\n' \
        "$secret_name"
}

ensure_secret() {
    secret_name="$1"
    username="$2"
    roles="$3"
    existing_name=$(read_secret_name "$secret_name") || {
        log_error "Unable to read service account token Secret $secret_name"
        return 1
    }

    if [ -n "$existing_name" ]; then
        validate_secret "$secret_name"
        reconcile_identity "$secret_name" "$username" "$roles"
        printf 'INFO Service account token Secret %s already exists; preserving its token\n' \
            "$secret_name"
        return
    fi
    if was_previously_managed "$secret_name"; then
        log_error "Service account token Secret $secret_name is missing during upgrade; restore it instead of generating a new credential"
        return 1
    fi
    create_secret "$secret_name" "$username" "$roles"
}

while [ "$#" -gt 0 ]; do
    case "$1" in
        --is-upgrade)
            is_upgrade=true
            shift
            ;;
        --namespace)
            if [ "$#" -lt 2 ]; then
                log_error 'Missing value for --namespace'
                exit 2
            fi
            namespace="$2"
            shift 2
            ;;
        --release-name)
            if [ "$#" -lt 2 ]; then
                log_error 'Missing value for --release-name'
                exit 2
            fi
            release_name="$2"
            shift 2
            ;;
        --state-config-map)
            if [ "$#" -lt 2 ]; then
                log_error 'Missing value for --state-config-map'
                exit 2
            fi
            state_config_map="$2"
            shift 2
            ;;
        --api-deployment-name)
            if [ "$#" -lt 2 ]; then
                log_error 'Missing value for --api-deployment-name'
                exit 2
            fi
            api_deployment_name="$2"
            shift 2
            ;;
        --credential)
            if [ "$#" -lt 2 ]; then
                log_error 'Missing value for --credential'
                exit 2
            fi
            credential_specs="${credential_specs}${credential_specs:+
}$2"
            shift 2
            ;;
        *)
            log_error "Unknown argument $1"
            exit 2
            ;;
    esac
done

if [ -z "$namespace" ] || [ -z "$release_name" ] || \
        [ -z "$state_config_map" ] || [ -z "$api_deployment_name" ]; then
    log_error 'Namespace, release name, state ConfigMap, and API Deployment are required'
    exit 2
fi
if [ -z "$credential_specs" ]; then
    log_error 'At least one managed service account credential is required'
    exit 2
fi

previously_managed_secret_names=$(read_managed_secret_state) || {
    log_error "Unable to read service account token state ConfigMap $state_config_map"
    exit 1
}
if [ -z "$previously_managed_secret_names" ]; then
    existing_api_deployment_name=$(read_api_deployment_name) || {
        log_error "Unable to read API Deployment $api_deployment_name"
        exit 1
    }
    if [ -z "$existing_api_deployment_name" ]; then
        if [ "$is_upgrade" = true ]; then
            log_error "No service account token state or API Deployment $api_deployment_name was found during upgrade; restore the release state before retrying"
            exit 1
        fi
    else
        previously_managed_secret_names=$(read_pre_state_managed_secrets) || {
            log_error "Unable to read service account token volumes from API Deployment $api_deployment_name"
            exit 1
        }
    fi
fi

printf '%s\n' "$credential_specs" | while IFS='|' read -r secret_name username roles_csv; do
    roles=$(printf '%s' "$roles_csv" | tr ',' '\n')
    if [ -z "$secret_name" ] || ! validate_identity "$username" "$roles"; then
        log_error "Managed service account credential for Secret $secret_name has invalid identity metadata"
        exit 2
    fi
    ensure_secret "$secret_name" "$username" "$roles"
done
