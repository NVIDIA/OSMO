#!/bin/sh
# SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: Apache-2.0

set -eu

namespace=""
release_name=""
source_secret_name=""
secret_name=""

log_error() {
    printf 'ERROR %s\n' "$*" >&2
}

read_secret_name() {
    kubectl get secret "$1" \
        --namespace "$namespace" \
        --ignore-not-found=true \
        -o go-template='{{.metadata.name}}'
}

read_secret_key() {
    target_secret=$1
    key=$2
    output_file=$3
    encoded_value=$(kubectl get secret "$target_secret" \
        --namespace "$namespace" \
        -o "go-template={{with index .data \"$key\"}}{{.}}{{end}}") || {
        log_error "Unable to read source SeaweedFS Secret $target_secret"
        return 1
    }
    if [ -z "$encoded_value" ]; then
        log_error "Source SeaweedFS Secret $target_secret is missing key $key"
        return 1
    fi
    if ! printf '%s' "$encoded_value" | base64 -d >"$output_file"; then
        log_error "Source SeaweedFS Secret $target_secret key $key is not valid base64"
        return 1
    fi
}

validate_credential() {
    credential_file=$1
    key=$2
    minimum_length=$3
    if ! grep -Eq "^[[:alnum:]]{$minimum_length,}$" "$credential_file"; then
        log_error "Source SeaweedFS Secret $source_secret_name key $key has invalid format"
        return 1
    fi
}

synchronize_secret() (
    source_name=$(read_secret_name "$source_secret_name") || {
        log_error "Unable to read source SeaweedFS Secret $source_secret_name"
        return 1
    }
    if [ -z "$source_name" ]; then
        log_error "Source SeaweedFS Secret $source_secret_name is missing"
        return 1
    fi

    working_directory=$(mktemp -d)
    trap 'rm -rf "$working_directory"' EXIT INT TERM
    access_key_id_file="$working_directory/admin_access_key_id"
    secret_access_key_file="$working_directory/admin_secret_access_key"
    credentials_file="$working_directory/object-storage.yaml"

    read_secret_key "$source_secret_name" admin_access_key_id \
        "$access_key_id_file"
    read_secret_key "$source_secret_name" admin_secret_access_key \
        "$secret_access_key_file"
    validate_credential "$access_key_id_file" admin_access_key_id 20
    validate_credential "$secret_access_key_file" admin_secret_access_key 32

    access_key_id=$(cat "$access_key_id_file")
    secret_access_key=$(cat "$secret_access_key_file")
    printf 'access_key_id: %s\naccess_key: %s\naddressing_style: path\n' \
        "$access_key_id" "$secret_access_key" >"$credentials_file"

    kubectl create secret generic "$secret_name" \
        --namespace "$namespace" \
        --from-file=object-storage.yaml="$credentials_file" \
        --dry-run=client \
        -o yaml >"$working_directory/secret.yaml"
    kubectl label --local -f "$working_directory/secret.yaml" \
        app.kubernetes.io/managed-by=osmo-object-storage-bootstrap \
        "app.kubernetes.io/instance=$release_name" \
        -o yaml >"$working_directory/labeled-secret.yaml"
    kubectl annotate --local -f "$working_directory/labeled-secret.yaml" \
        "osmo.nvidia.com/credential-source=$source_secret_name" \
        -o yaml >"$working_directory/annotated-secret.yaml"
    kubectl apply -f "$working_directory/annotated-secret.yaml" >/dev/null

    printf 'INFO Synchronized object-storage Secret %s from %s\n' \
        "$secret_name" "$source_secret_name"
)

while [ "$#" -gt 0 ]; do
    case "$1" in
        --namespace|--release-name|--source-secret-name|--secret-name)
            if [ "$#" -lt 2 ]; then
                log_error "Missing value for $1"
                exit 2
            fi
            case "$1" in
                --namespace) namespace=$2 ;;
                --release-name) release_name=$2 ;;
                --source-secret-name) source_secret_name=$2 ;;
                --secret-name) secret_name=$2 ;;
            esac
            shift 2
            ;;
        *)
            log_error "Unknown argument $1"
            exit 2
            ;;
    esac
done

if [ -z "$namespace" ] || [ -z "$release_name" ] || \
        [ -z "$source_secret_name" ] || [ -z "$secret_name" ]; then
    log_error 'Namespace, release name, source Secret name, and target Secret name are required'
    exit 2
fi

synchronize_secret
