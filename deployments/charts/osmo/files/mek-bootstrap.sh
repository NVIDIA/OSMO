#!/bin/ash
# shellcheck shell=sh disable=SC2187,SC3040
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

decode_mek() {
    output_file="$1"
    encoded_mek=$(kubectl get secret "$secret_name" \
        --namespace "$namespace" \
        -o "go-template={{with index .data \"$secret_key\"}}{{.}}{{end}}") || {
        log_error "Unable to read master encryption key Secret $secret_name"
        return 1
    }
    if [ -z "$encoded_mek" ]; then
        return 2
    fi
    if ! printf '%s' "$encoded_mek" | base64 -d >"$output_file"; then
        return 1
    fi
}

validate_mek_file() {
    mek_file="$1"
    current_mek_field="current""Mek"
    if [ "$(wc -l <"$mek_file" | tr -d ' ')" -ne 3 ] || \
            ! grep -Fxq "$current_mek_field: key1" "$mek_file" || \
            ! grep -Fxq 'meks:' "$mek_file" || \
            ! grep -Eq '^  key1: [A-Za-z0-9+/]+={0,2}$' "$mek_file"; then
        return 1
    fi

    encoded_jwk=$(sed -n 's/^  key1: //p' "$mek_file")
    temporary_jwk="$mek_file.jwk"
    if ! printf '%s' "$encoded_jwk" | base64 -d >"$temporary_jwk"; then
        rm -f "$temporary_jwk"
        return 1
    fi
    if ! grep -Eq '^\{"k":"[A-Za-z0-9_-]{43}","kid":"key1","kty":"oct"\}$' \
            "$temporary_jwk"; then
        rm -f "$temporary_jwk"
        return 1
    fi
    rm -f "$temporary_jwk"
}

validate_secret() {
    temporary_directory=$(mktemp -d)
    trap 'rm -rf "$temporary_directory"' EXIT INT TERM

    if decode_mek "$temporary_directory/mek.yaml"; then
        :
    else
        status=$?
        if [ "$status" -eq 2 ]; then
            log_error "Master encryption key Secret $secret_name is missing key $secret_key"
        else
            log_error "Master encryption key Secret $secret_name has invalid format"
        fi
        return 1
    fi
    if ! validate_mek_file "$temporary_directory/mek.yaml"; then
        log_error "Master encryption key Secret $secret_name has invalid format"
        return 1
    fi

    rm -rf "$temporary_directory"
    trap - EXIT INT TERM
}

write_mek_file() {
    output_file="$1"
    key=$(head -c 32 /dev/urandom \
        | base64 \
        | tr '/+' '_-' \
        | tr -d '=\n')
    jwk=$(printf '{"k":"%s","kid":"key1","kty":"oct"}' "$key" \
        | base64 \
        | tr -d '\n')
    current_mek_field="current""Mek"
    printf '%s: key1\nmeks:\n  key1: %s\n' \
        "$current_mek_field" "$jwk" >"$output_file"
}

create_secret() {
    temporary_directory=$(mktemp -d)
    trap 'rm -rf "$temporary_directory"' EXIT INT TERM
    write_mek_file "$temporary_directory/mek.yaml"

    if kubectl create secret generic "$secret_name" \
            --namespace "$namespace" \
            "--from-file=$secret_key=$temporary_directory/mek.yaml" \
            --dry-run=client \
            -o yaml \
            | kubectl label --local -f - \
                app.kubernetes.io/managed-by=osmo-mek-bootstrap \
                "app.kubernetes.io/instance=$release_name" \
                -o yaml \
            | kubectl annotate --local -f - \
                osmo.nvidia.com/credential-source=osmo-chart-bootstrap \
                -o yaml \
            | kubectl create -f - >/dev/null; then
        rm -rf "$temporary_directory"
        trap - EXIT INT TERM
        printf 'INFO Created master encryption key Secret %s\n' "$secret_name"
        return
    fi

    rm -rf "$temporary_directory"
    trap - EXIT INT TERM
    existing_name=$(read_secret_name) || {
        log_error "Unable to verify master encryption key Secret $secret_name after create failure"
        return 1
    }
    if [ -z "$existing_name" ]; then
        log_error "Unable to create master encryption key Secret $secret_name"
        return 1
    fi
    validate_secret
    printf 'INFO Master encryption key Secret %s was created concurrently; preserving it\n' \
        "$secret_name"
}

ensure_secret() {
    existing_name=$(read_secret_name) || {
        log_error "Unable to read master encryption key Secret $secret_name"
        return 1
    }
    if [ -n "$existing_name" ]; then
        validate_secret
        printf 'INFO Master encryption key Secret %s already exists; preserving it\n' \
            "$secret_name"
        return
    fi
    if [ "$fail_if_missing" = true ]; then
        log_error "Master encryption key Secret $secret_name is missing during upgrade; restore it instead of generating a new key"
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
        --namespace)
            [ "$#" -ge 2 ] || { log_error 'Missing value for --namespace'; exit 2; }
            namespace="$2"
            shift 2
            ;;
        --release-name)
            [ "$#" -ge 2 ] || { log_error 'Missing value for --release-name'; exit 2; }
            release_name="$2"
            shift 2
            ;;
        --secret-name)
            [ "$#" -ge 2 ] || { log_error 'Missing value for --secret-name'; exit 2; }
            secret_name="$2"
            shift 2
            ;;
        --secret-key)
            [ "$#" -ge 2 ] || { log_error 'Missing value for --secret-key'; exit 2; }
            secret_key="$2"
            shift 2
            ;;
        *)
            log_error "Unknown argument $1"
            exit 2
            ;;
    esac
done

if [ -z "$namespace" ] || [ -z "$release_name" ] || \
        [ -z "$secret_name" ] || [ -z "$secret_key" ]; then
    log_error 'Namespace, release name, Secret name, and Secret key are required'
    exit 2
fi

ensure_secret
