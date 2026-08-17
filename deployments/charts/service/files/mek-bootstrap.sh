#!/bin/ash
# shellcheck shell=sh disable=SC3040
# SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: Apache-2.0

set -eu
set -o pipefail

fail_if_missing=false
namespace=""
release_name=""
secret_name=""
secret_key=""

log_error() {
    printf 'ERROR %s\n' "$*" >&2
}

read_secret_name() {
    kubectl get secret "$secret_name" \
        --namespace "$namespace" \
        --ignore-not-found=true \
        -o go-template='{{.metadata.name}}'
}

wait_for_access() {
    attempt=1
    while [ "$attempt" -le 30 ]; do
        if read_secret_name >/dev/null 2>&1; then
            return
        fi
        attempt=$((attempt + 1))
        sleep 1
    done
    log_error "Timed out waiting for MEK bootstrap RBAC"
    return 1
}

validate_secret() {
    encoded_keyring=$(kubectl get secret "$secret_name" \
        --namespace "$namespace" \
        -o "go-template={{with index .data \"$secret_key\"}}{{.}}{{end}}") || {
        log_error "Unable to read MEK Secret $secret_name"
        return 1
    }
    if [ -z "$encoded_keyring" ]; then
        log_error "MEK Secret $secret_name is missing key $secret_key"
        return 1
    fi

    temporary_directory=$(mktemp -d)
    trap 'rm -rf "$temporary_directory"' EXIT INT TERM
    if ! printf '%s' "$encoded_keyring" \
            | base64 -d > "$temporary_directory/keyring"; then
        log_error "MEK Secret $secret_name key $secret_key is invalid"
        return 1
    fi
    if [ ! -s "$temporary_directory/keyring" ]; then
        log_error "MEK Secret $secret_name key $secret_key is empty"
        return 1
    fi
    rm -rf "$temporary_directory"
    trap - EXIT INT TERM
}

create_secret() {
    temporary_directory=$(mktemp -d)
    trap 'rm -rf "$temporary_directory"' EXIT INT TERM

    mek_key=$(head -c 32 /dev/urandom \
        | base64 \
        | tr '/+' '_-' \
        | tr -d '=\n')
    mek_jwk=$(printf '{"k":"%s","kid":"key1","kty":"oct"}' "$mek_key" \
        | base64 \
        | tr -d '\n')
    printf 'currentMek: key1\nmeks:\n  key1: %s\n' "$mek_jwk" \
        > "$temporary_directory/mek.yaml"
    unset mek_key mek_jwk

    if kubectl create secret generic "$secret_name" \
            --namespace "$namespace" \
            --from-file="$secret_key=$temporary_directory/mek.yaml" \
            --dry-run=client \
            -o yaml \
        | kubectl label --local -f - \
            app.kubernetes.io/managed-by=osmo-mek-bootstrap \
            "app.kubernetes.io/instance=$release_name" \
            -o yaml \
        | kubectl annotate --local -f - \
            osmo.nvidia.com/credential-source=helm-test-bootstrap \
            -o yaml \
        | kubectl create -f - >/dev/null; then
        rm -rf "$temporary_directory"
        trap - EXIT INT TERM
        printf 'INFO Created MEK Secret %s\n' "$secret_name"
        return
    fi

    rm -rf "$temporary_directory"
    trap - EXIT INT TERM
    existing_name=$(read_secret_name) || {
        log_error "Unable to verify MEK Secret $secret_name after create failure"
        return 1
    }
    if [ -z "$existing_name" ]; then
        log_error "Unable to create MEK Secret $secret_name"
        return 1
    fi
    validate_secret
    printf 'INFO MEK Secret %s was created concurrently; preserving it\n' \
        "$secret_name"
}

ensure_secret() {
    existing_name=$(read_secret_name) || {
        log_error "Unable to read MEK Secret $secret_name"
        return 1
    }
    if [ -n "$existing_name" ]; then
        validate_secret
        printf 'INFO MEK Secret %s already exists; preserving it\n' "$secret_name"
        return
    fi
    if [ "$fail_if_missing" = true ]; then
        log_error "MEK Secret $secret_name is missing during upgrade; restore it instead of generating a new encryption key"
        return 1
    fi
    create_secret
}

while [ "$#" -gt 0 ]; do
    case "$1" in
        --fail-if-missing)
            fail_if_missing=true
            shift
            ;;
        --namespace|--release-name|--secret-name|--secret-key)
            if [ "$#" -lt 2 ]; then
                log_error "Missing value for $1"
                exit 2
            fi
            option="$1"
            value="$2"
            case "$option" in
                --namespace) namespace="$value" ;;
                --release-name) release_name="$value" ;;
                --secret-name) secret_name="$value" ;;
                --secret-key) secret_key="$value" ;;
            esac
            shift 2
            ;;
        *)
            log_error "Unknown argument $1"
            exit 2
            ;;
    esac
done

if [ -z "$namespace" ] || [ -z "$release_name" ] \
        || [ -z "$secret_name" ] || [ -z "$secret_key" ]; then
    log_error 'Namespace, release name, Secret name, and Secret key are required'
    exit 2
fi

wait_for_access
ensure_secret
