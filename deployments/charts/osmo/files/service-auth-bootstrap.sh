#!/bin/sh
# shellcheck shell=sh disable=SC3040
# SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: Apache-2.0

set -eu
if (set -o pipefail) 2>/dev/null; then
    set -o pipefail
fi
umask 077

namespace=""
release_name=""
secret_name=""
secret_key=""
work_directory="/tmp/service-auth-bootstrap"

kubernetes_api="${KUBERNETES_API_URL:-https://kubernetes.default.svc}"
service_account_directory="${KUBERNETES_SERVICE_ACCOUNT_DIRECTORY:-/var/run/secrets/kubernetes.io/serviceaccount}"

log_error() {
    printf 'ERROR %s\n' "$*" >&2
}

api_request() {
    method="$1"
    url="$2"
    output_file="$3"
    input_file="${4:-}"
    token=$(cat "$service_account_directory/token") || {
        log_error 'Unable to read the Kubernetes service account token'
        return 1
    }
    if [ -n "$input_file" ]; then
        curl --silent --show-error \
            --cacert "$service_account_directory/ca.crt" \
            --header "Authorization: Bearer $token" \
            --header 'Content-Type: application/json' \
            --request "$method" \
            --data-binary "@$input_file" \
            --output "$output_file" \
            --write-out '%{http_code}' \
            "$url"
    else
        curl --silent --show-error \
            --cacert "$service_account_directory/ca.crt" \
            --header "Authorization: Bearer $token" \
            --request "$method" \
            --output "$output_file" \
            --write-out '%{http_code}' \
            "$url"
    fi
}

secret_url() {
    printf '%s/api/v1/namespaces/%s/secrets/%s' \
        "$kubernetes_api" "$namespace" "$secret_name"
}

secrets_url() {
    printf '%s/api/v1/namespaces/%s/secrets' "$kubernetes_api" "$namespace"
}

read_secret() {
    api_request GET "$(secret_url)" "$work_directory/get-response.json"
}

validate_jwks() {
    auth_file="$1"
    key_id=$(jq -er '.active_key' "$auth_file") || return 1
    jq -er --arg key_id "$key_id" '
        type == "object" and
        .active_key == $key_id and
        .audience == "osmo" and
        .issuer == "osmo" and
        .max_token_duration == "365d" and
        .user_roles == ["osmo-user"] and
        .ctrl_roles == ["osmo-user", "osmo-ctrl"] and
        (.keys | type == "object" and keys == [$key_id]) and
        (.keys[$key_id].public_key | type == "string") and
        (.keys[$key_id].private_key | type == "string")
    ' "$auth_file" >/dev/null || return 1

    jq -er --arg key_id "$key_id" '.keys[$key_id].public_key' \
        "$auth_file" >"$work_directory/public.jwk" || return 1
    jq -er --arg key_id "$key_id" '.keys[$key_id].private_key' \
        "$auth_file" >"$work_directory/private.jwk" || return 1

    jq -e --arg key_id "$key_id" '
        type == "object" and .kty == "RSA" and .alg == "RS256" and
        .use == "sig" and .kid == $key_id and
        (.n | type == "string" and length > 0) and
        (.e | type == "string" and length > 0)
    ' "$work_directory/public.jwk" >/dev/null || return 1
    jq -e --arg key_id "$key_id" '
        type == "object" and .kty == "RSA" and .alg == "RS256" and
        .use == "sig" and .kid == $key_id and
        ([.n, .e, .d, .p, .q, .dp, .dq, .qi] |
            all(type == "string" and length > 0))
    ' "$work_directory/private.jwk" >/dev/null || return 1

    step crypto jwk public <"$work_directory/private.jwk" \
        >"$work_directory/derived-public.jwk" 2>/dev/null || return 1
    stored_public=$(jq -cS '{alg,e,kid,kty,n,use}' \
        "$work_directory/public.jwk") || return 1
    derived_public=$(jq -cS '{alg,e,kid,kty,n,use}' \
        "$work_directory/derived-public.jwk") || return 1
    [ "$stored_public" = "$derived_public" ]
}

validate_existing_secret() {
    secret_file="$1"
    installation="$namespace/$release_name"
    if ! jq -e --arg installation "$installation" --arg secret_key "$secret_key" '
        .type == "Opaque" and
        .metadata.labels["app.kubernetes.io/managed-by"] ==
            "osmo-service-auth-bootstrap" and
        .metadata.annotations["osmo.nvidia.com/service-auth-bootstrap-installation"] ==
            $installation and
        (.metadata.annotations["osmo.nvidia.com/service-auth-bootstrap-digest"] |
            type == "string") and
        (.data[$secret_key] | type == "string")
    ' "$secret_file" >/dev/null; then
        log_error "Existing service auth Secret $secret_name is not an exact bootstrap retry for this installation"
        return 1
    fi

    if ! jq -er --arg secret_key "$secret_key" '.data[$secret_key]' \
            "$secret_file" | base64 -d >"$work_directory/authentication-config.json"; then
        log_error "Existing service auth Secret $secret_name is invalid"
        return 1
    fi
    if ! validate_jwks "$work_directory/authentication-config.json"; then
        log_error "Existing service auth Secret $secret_name is invalid"
        return 1
    fi

    expected_digest=$(jq -er \
        '.metadata.annotations["osmo.nvidia.com/service-auth-bootstrap-digest"]' \
        "$secret_file") || return 1
    actual_digest=$(sha256sum "$work_directory/authentication-config.json" |
        awk '{print $1}') || return 1
    if [ "$expected_digest" != "$actual_digest" ]; then
        log_error "Existing service auth Secret $secret_name identity does not match its data"
        return 1
    fi
}

generate_service_auth() {
    step crypto jwk create \
        "$work_directory/generated-public.jwk" \
        "$work_directory/generated-private.jwk" \
        --kty RSA \
        --size 4096 \
        --alg RS256 \
        --use sig \
        --no-password \
        --insecure >/dev/null
    jq -cS . "$work_directory/generated-public.jwk" \
        >"$work_directory/public.jwk"
    jq -cS . "$work_directory/generated-private.jwk" \
        >"$work_directory/private.jwk"
    key_id=$(jq -er '.kid' "$work_directory/public.jwk")
    jq -cnS \
        --arg key_id "$key_id" \
        --slurpfile public_key "$work_directory/public.jwk" \
        --slurpfile private_key "$work_directory/private.jwk" '
        {
            active_key: $key_id,
            audience: "osmo",
            ctrl_roles: ["osmo-user", "osmo-ctrl"],
            issuer: "osmo",
            keys: {
                ($key_id): {
                    private_key: ($private_key[0] | tojson),
                    public_key: ($public_key[0] | tojson)
                }
            },
            max_token_duration: "365d",
            user_roles: ["osmo-user"]
        }
    ' | tr -d '\n' >"$work_directory/authentication-config.json"
    validate_jwks "$work_directory/authentication-config.json"
}

create_secret() {
    digest=$(sha256sum "$work_directory/authentication-config.json" |
        awk '{print $1}')
    installation="$namespace/$release_name"
    jq -n \
        --arg namespace "$namespace" \
        --arg release_name "$release_name" \
        --arg secret_name "$secret_name" \
        --arg secret_key "$secret_key" \
        --arg installation "$installation" \
        --arg digest "$digest" \
        --rawfile auth "$work_directory/authentication-config.json" '
        {
            apiVersion: "v1",
            kind: "Secret",
            metadata: {
                name: $secret_name,
                namespace: $namespace,
                labels: {
                    "app.kubernetes.io/name": "osmo",
                    "app.kubernetes.io/instance": $release_name,
                    "app.kubernetes.io/component": "service-auth",
                    "app.kubernetes.io/managed-by": "osmo-service-auth-bootstrap"
                },
                annotations: {
                    "osmo.nvidia.com/service-auth-bootstrap-installation": $installation,
                    "osmo.nvidia.com/service-auth-bootstrap-digest": $digest,
                    "osmo.nvidia.com/credential-source": "osmo-chart-bootstrap"
                }
            },
            stringData: {($secret_key): $auth},
            type: "Opaque"
        }
    ' >"$work_directory/create-request.json"

    status=$(api_request POST "$(secrets_url)" \
        "$work_directory/create-response.json" "$work_directory/create-request.json") || {
        log_error "Unable to create service auth Secret $secret_name"
        return 1
    }
    if [ "$status" = 201 ]; then
        printf 'INFO Initialized Kubernetes service auth Secret %s\n' "$secret_name"
        return
    fi
    if [ "$status" != 409 ]; then
        log_error "Unable to create service auth Secret $secret_name (Kubernetes API status $status)"
        return 1
    fi

    status=$(read_secret) || {
        log_error "Unable to verify service auth Secret $secret_name after create conflict"
        return 1
    }
    if [ "$status" != 200 ]; then
        log_error "Unable to verify service auth Secret $secret_name after create conflict"
        return 1
    fi
    validate_existing_secret "$work_directory/get-response.json"
    printf 'INFO Service auth Secret %s was created concurrently; preserving it\n' \
        "$secret_name"
}

while [ "$#" -gt 0 ]; do
    case "$1" in
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
        --target-secret)
            [ "$#" -ge 2 ] || { log_error 'Missing value for --target-secret'; exit 2; }
            secret_name="$2"
            shift 2
            ;;
        --target-key)
            [ "$#" -ge 2 ] || { log_error 'Missing value for --target-key'; exit 2; }
            secret_key="$2"
            shift 2
            ;;
        --work-directory)
            [ "$#" -ge 2 ] || { log_error 'Missing value for --work-directory'; exit 2; }
            work_directory="$2"
            shift 2
            ;;
        *)
            log_error "Unknown argument $1"
            exit 2
            ;;
    esac
done

if [ -z "$namespace" ] || [ -z "$release_name" ] || [ -z "$secret_name" ] ||
        [ -z "$secret_key" ]; then
    log_error 'The namespace, release name, target Secret, and target key are required'
    exit 2
fi

mkdir -p "$work_directory"
status=$(read_secret) || {
    log_error "Unable to read service auth Secret $secret_name"
    exit 1
}
if [ "$status" = 200 ]; then
    validate_existing_secret "$work_directory/get-response.json"
    printf 'INFO Validated existing bootstrap service auth Secret %s\n' "$secret_name"
elif [ "$status" = 404 ]; then
    generate_service_auth
    create_secret
else
    log_error "Unable to read service auth Secret $secret_name (Kubernetes API status $status)"
    exit 1
fi
