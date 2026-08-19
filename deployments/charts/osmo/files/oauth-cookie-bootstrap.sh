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
    kubectl get secret "$secret_name" --namespace "$namespace" \
        --ignore-not-found=true -o go-template='{{.metadata.name}}'
}

validate_secret() {
    managed_by=$(kubectl get secret "$secret_name" --namespace "$namespace" \
        -o go-template='{{index .metadata.labels "app.kubernetes.io/managed-by"}}') || return 1
    instance=$(kubectl get secret "$secret_name" --namespace "$namespace" \
        -o go-template='{{index .metadata.labels "app.kubernetes.io/instance"}}') || return 1
    [ "$managed_by" = osmo-oauth-cookie-bootstrap ] \
        && [ "$instance" = "$release_name" ] || {
        log_error "OAuth cookie Secret $secret_name is owned by another release"
        return 1
    }
    encoded_value=$(kubectl get secret "$secret_name" --namespace "$namespace" \
        -o "go-template={{with index .data \"$secret_key\"}}{{.}}{{end}}") || return 1
    [ -n "$encoded_value" ] || {
        log_error "OAuth cookie Secret $secret_name is missing key $secret_key"
        return 1
    }
    decoded_value=$(printf '%s' "$encoded_value" | base64 -d) || return 1
    [ "${#decoded_value}" -eq 44 ] || {
        log_error "OAuth cookie Secret $secret_name key $secret_key is invalid"
        return 1
    }
    case "$decoded_value" in
        *[!A-Za-z0-9_=-]*)
            log_error "OAuth cookie Secret $secret_name key $secret_key is invalid"
            return 1
            ;;
    esac
    raw_length=$(printf '%s' "$decoded_value" | tr '_-' '/+' \
        | base64 -d | wc -c | tr -d ' ') || return 1
    [ "$raw_length" -eq 32 ] || {
        log_error "OAuth cookie Secret $secret_name key $secret_key is invalid"
        return 1
    }
    canonical=$(printf '%s' "$decoded_value" | tr '_-' '/+' | base64 -d \
        | base64 | tr '/+' '_-' | tr -d '\n') || return 1
    [ "$canonical" = "$decoded_value" ] || {
        log_error "OAuth cookie Secret $secret_name key $secret_key is invalid"
        return 1
    }
}

initialize_secret() {
    expected_resource_version=$1
    temporary_directory=$(mktemp -d)
    trap 'rm -rf "$temporary_directory"' EXIT INT TERM
    head -c 32 /dev/urandom | base64 | tr '/+' '_-' | tr -d '\n' \
        > "$temporary_directory/cookie-secret"
    encoded_cookie=$(base64 < "$temporary_directory/cookie-secret" | tr -d '\n')
    printf '{"metadata":{"resourceVersion":"%s"},"data":{"%s":"%s"}}\n' \
        "$expected_resource_version" "$secret_key" "$encoded_cookie" \
        > "$temporary_directory/patch.json"
    if ! kubectl patch secret "$secret_name" --namespace "$namespace" \
            --type=merge --patch-file "$temporary_directory/patch.json" >/dev/null; then
        rm -rf "$temporary_directory"
        trap - EXIT INT TERM
        return 1
    fi
    rm -rf "$temporary_directory"
    trap - EXIT INT TERM
    printf 'INFO Initialized OAuth cookie Secret %s\n' "$secret_name"
}

while [ "$#" -gt 0 ]; do
    case "$1" in
        --fail-if-missing) fail_if_missing=true; shift ;;
        --namespace|--release-name|--secret-name|--secret-key)
            [ "$#" -ge 2 ] || { log_error "Missing value for $1"; exit 2; }
            option="$1"; value="$2"
            case "$option" in
                --namespace) namespace="$value" ;;
                --release-name) release_name="$value" ;;
                --secret-name) secret_name="$value" ;;
                --secret-key) secret_key="$value" ;;
            esac
            shift 2
            ;;
        *) log_error "Unknown argument $1"; exit 2 ;;
    esac
done

[ -n "$namespace" ] && [ -n "$release_name" ] \
    && [ -n "$secret_name" ] && [ -n "$secret_key" ] || {
    log_error 'Namespace, release name, Secret name, and Secret key are required'
    exit 2
}

attempt=1
while [ "$attempt" -le 30 ]; do
    if current_secret_name=$(read_secret_name) \
            && [ -n "$current_secret_name" ]; then
        break
    fi
    attempt=$((attempt + 1)); sleep 1
done

existing_name=$(read_secret_name) || {
    log_error "Unable to read OAuth cookie Secret $secret_name"
    exit 1
}
if [ -n "$existing_name" ]; then
    if validate_secret; then
        printf 'INFO OAuth cookie Secret %s already exists; preserving it\n' "$secret_name"
        exit 0
    fi
    managed_by=$(kubectl get secret "$secret_name" --namespace "$namespace" \
        -o go-template='{{index .metadata.labels "app.kubernetes.io/managed-by"}}') || exit 1
    instance=$(kubectl get secret "$secret_name" --namespace "$namespace" \
        -o go-template='{{index .metadata.labels "app.kubernetes.io/instance"}}') || exit 1
    existing_encoded_value=$(kubectl get secret "$secret_name" --namespace "$namespace" \
        -o "go-template={{with index .data \"$secret_key\"}}{{.}}{{end}}") || exit 1
    resource_version=$(kubectl get secret "$secret_name" --namespace "$namespace" \
        -o go-template='{{.metadata.resourceVersion}}') || exit 1
    if [ "$fail_if_missing" = false ] \
            && [ "$managed_by" = osmo-oauth-cookie-bootstrap ] \
            && [ "$instance" = "$release_name" ] \
            && [ -z "$existing_encoded_value" ]; then
        if initialize_secret "$resource_version" && validate_secret; then exit 0; fi
        # A concurrent initializer may have won the resourceVersion race.
        if validate_secret; then exit 0; fi
    fi
    exit 1
fi
if [ "$fail_if_missing" = true ]; then
    log_error "Generated OAuth cookie Secret $secret_name is missing during upgrade; restore it"
else
    log_error "OAuth cookie bootstrap placeholder $secret_name is missing during install"
fi
exit 1
