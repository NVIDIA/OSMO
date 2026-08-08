#!/bin/ash
# shellcheck shell=sh disable=SC2187,SC3040
# SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: Apache-2.0

set -eu
set -o pipefail

fail_if_missing=false
namespace=""
release_name=""
secret_names=""

log_error() {
    printf 'ERROR %s\n' "$*" >&2
}

read_secret_name() {
    kubectl get secret "$1" \
        --namespace "$namespace" \
        --ignore-not-found=true \
        -o go-template='{{.metadata.name}}'
}

decode_token() {
    secret_name="$1"
    token_key="$2"
    output_file="$3"

    encoded_token=$(kubectl get secret "$secret_name" \
        --namespace "$namespace" \
        -o "go-template={{with index .data \"$token_key\"}}{{.}}{{end}}") || {
        log_error "Unable to read backend token Secret $secret_name"
        return 1
    }
    if [ -z "$encoded_token" ]; then
        return 2
    fi
    if ! printf '%s' "$encoded_token" | base64 -d > "$output_file"; then
        log_error "Backend token Secret $secret_name key $token_key is invalid"
        return 1
    fi
}

normalize_token() {
    token_file="$1"
    token_length=$(wc -c < "$token_file" | tr -d ' ')

    case "$token_length" in
        43|64)
            ;;
        44|65)
            if [ "$(tail -c 1 "$token_file" | od -An -tu1 | tr -d ' ')" != "10" ]; then
                return 1
            fi
            head -c $((token_length - 1)) "$token_file" > "$token_file.normalized"
            mv "$token_file.normalized" "$token_file"
            ;;
        45|66)
            if [ "$(tail -c 2 "$token_file" | od -An -tu1 | tr -s ' ' | sed 's/^ //')" \
                    != "13 10" ]; then
                return 1
            fi
            head -c $((token_length - 2)) "$token_file" > "$token_file.normalized"
            mv "$token_file.normalized" "$token_file"
            ;;
        *)
            return 1
            ;;
    esac

    token_length=$(wc -c < "$token_file" | tr -d ' ')
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

validate_secret() {
    secret_name="$1"
    temporary_directory=$(mktemp -d)
    trap 'rm -rf "$temporary_directory"' EXIT INT TERM

    if decode_token "$secret_name" token "$temporary_directory/token"; then
        :
    else
        status=$?
        if [ "$status" -eq 2 ]; then
            log_error "Backend token Secret $secret_name is missing key token"
        fi
        return 1
    fi
    if ! normalize_token "$temporary_directory/token"; then
        log_error "Backend token Secret $secret_name key token has invalid format"
        return 1
    fi

    if decode_token "$secret_name" previous-token "$temporary_directory/previous-token"; then
        if ! normalize_token "$temporary_directory/previous-token"; then
            log_error "Backend token Secret $secret_name key previous-token has invalid format"
            return 1
        fi
        if cmp -s "$temporary_directory/token" "$temporary_directory/previous-token"; then
            log_error "Backend token Secret $secret_name contains duplicate tokens"
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

create_secret() {
    secret_name="$1"
    if head -c 32 /dev/urandom \
            | base64 \
            | tr '/+' '_-' \
            | tr -d '=\n' \
            | kubectl create secret generic "$secret_name" \
                --namespace "$namespace" \
                --from-file=token=/dev/stdin \
                --dry-run=client \
                -o yaml \
            | kubectl label --local -f - \
                app.kubernetes.io/managed-by=osmo-backend-token-bootstrap \
                "app.kubernetes.io/instance=$release_name" \
                -o yaml \
            | kubectl annotate --local -f - \
                osmo.nvidia.com/credential-source=service-chart-bootstrap \
                -o yaml \
            | kubectl create -f - >/dev/null; then
        printf 'INFO Created backend token Secret %s\n' "$secret_name"
        return
    fi

    existing_name=$(read_secret_name "$secret_name") || {
        log_error "Unable to verify backend token Secret $secret_name after create failure"
        return 1
    }
    if [ -z "$existing_name" ]; then
        log_error "Unable to create backend token Secret $secret_name"
        return 1
    fi
    validate_secret "$secret_name"
    printf 'INFO Backend token Secret %s was created concurrently; preserving it\n' \
        "$secret_name"
}

ensure_secret() {
    secret_name="$1"
    existing_name=$(read_secret_name "$secret_name") || {
        log_error "Unable to read backend token Secret $secret_name"
        return 1
    }

    if [ -n "$existing_name" ]; then
        validate_secret "$secret_name"
        printf 'INFO Backend token Secret %s already exists; preserving it\n' "$secret_name"
        return
    fi
    if [ "$fail_if_missing" = true ]; then
        log_error "Backend token Secret $secret_name is missing during upgrade; restore it instead of generating a new credential"
        return 1
    fi
    create_secret "$secret_name"
}

while [ "$#" -gt 0 ]; do
    case "$1" in
        --fail-if-missing)
            fail_if_missing=true
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
        --secret-name)
            if [ "$#" -lt 2 ]; then
                log_error 'Missing value for --secret-name'
                exit 2
            fi
            secret_names="${secret_names}${secret_names:+ }$2"
            shift 2
            ;;
        *)
            log_error "Unknown argument $1"
            exit 2
            ;;
    esac
done

if [ -z "$namespace" ] || [ -z "$release_name" ]; then
    log_error 'Namespace and release name are required'
    exit 2
fi
if [ -z "$secret_names" ]; then
    log_error 'At least one Secret name is required'
    exit 2
fi

for secret_name in $secret_names; do
    ensure_secret "$secret_name"
done
