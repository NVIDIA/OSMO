#!/bin/bash
# SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: Apache-2.0

set -euo pipefail

if [[ "$#" -ne 3 ]]; then
    echo "Usage: $0 IMAGE_REGISTRY IMAGE_TAG CRIO_ENDPOINT" >&2
    exit 2
fi

image_registry="${1%/}"
image_tag="$2"
crio_endpoint="$3"
crictl_command="${CRICTL:-crictl}"
backend_images=(
    backend-listener
    backend-worker
    backend-test-runner
)

if [[ ! "$image_registry" =~ ^[a-zA-Z0-9._:/-]+$ ]]; then
    echo "Invalid image registry: $image_registry" >&2
    exit 2
fi
if [[ ! "$image_tag" =~ ^[a-zA-Z0-9._-]+$ ]]; then
    echo "Invalid image tag: $image_tag" >&2
    exit 2
fi
if [[ "$crio_endpoint" != unix://* ]]; then
    echo "CRI-O endpoint must use unix://: $crio_endpoint" >&2
    exit 2
fi

for required_command in docker jq "$crictl_command"; do
    if ! command -v "$required_command" >/dev/null 2>&1; then
        echo "Required command not found: $required_command" >&2
        exit 1
    fi
done

temporary_directory="$(mktemp -d)"
docker_container_ids=()
crio_container_ids=()
crio_pod_ids=()

run_crictl() {
    "$crictl_command" \
        --runtime-endpoint="$crio_endpoint" \
        --image-endpoint="$crio_endpoint" \
        "$@"
}

cleanup() {
    local container_id pod_id
    for container_id in "${docker_container_ids[@]}"; do
        docker rm --force "$container_id" >/dev/null 2>&1 || true
    done
    for container_id in "${crio_container_ids[@]}"; do
        run_crictl rm --force "$container_id" >/dev/null 2>&1 || true
    done
    for pod_id in "${crio_pod_ids[@]}"; do
        run_crictl stopp "$pod_id" >/dev/null 2>&1 || true
        run_crictl rmp --force "$pod_id" >/dev/null 2>&1 || true
    done
    rm -rf "$temporary_directory"
}
trap cleanup EXIT

docker_info="$(docker info 2>/dev/null)"
if [[ "$docker_info" != *"containerd version:"* ]]; then
    echo "Docker engine does not report its containerd runtime version" >&2
    exit 1
fi

crio_version="$(run_crictl version)"
if [[ "$crio_version" != *"RuntimeName:  cri-o"* || \
      ! "$crio_version" =~ RuntimeVersion:[[:space:]]+1\.34\. ]]; then
    echo "Expected a CRI-O 1.34 runtime at $crio_endpoint" >&2
    echo "$crio_version" >&2
    exit 1
fi

validate_with_containerd() {
    local image_reference="$1" container_id exit_code
    echo "Validating $image_reference with containerd-backed Docker"
    docker pull "$image_reference"
    container_id="$(docker create \
        --entrypoint /usr/bin/python "$image_reference" --version)"
    docker_container_ids+=("$container_id")
    docker start "$container_id" >/dev/null
    exit_code="$(docker wait "$container_id")"
    docker logs "$container_id"
    if [[ "$exit_code" != 0 ]]; then
        echo "$image_reference exited with status $exit_code under containerd" >&2
        return 1
    fi
    docker rm "$container_id" >/dev/null
    docker_container_ids=()
}

write_crio_configs() {
    local component="$1" image_reference="$2"
    local pod_config="$3" container_config="$4"
    printf '%s\n' \
        '{' \
        '  "metadata": {' \
        "    \"name\": \"osmo-image-check-$component\"," \
        '    "namespace": "osmo-image-check",' \
        "    \"uid\": \"osmo-image-check-$component\"," \
        '    "attempt": 1' \
        '  },' \
        "  \"log_directory\": \"$temporary_directory\"," \
        '  "linux": {' \
        '    "security_context": {' \
        '      "namespace_options": {"network": 2}' \
        '    }' \
        '  }' \
        '}' >"$pod_config"

    printf '%s\n' \
        '{' \
        '  "metadata": {' \
        "    \"name\": \"$component\"," \
        '    "attempt": 1' \
        '  },' \
        "  \"image\": {\"image\": \"$image_reference\"}," \
        '  "command": ["/usr/bin/python", "--version"],' \
        "  \"log_path\": \"$component.log\"" \
        '}' >"$container_config"
}

validate_with_crio() {
    local component="$1" image_reference="$2"
    local pod_config container_config pod_id container_id
    local inspect_output state exit_code attempt

    pod_config="$temporary_directory/$component-pod.json"
    container_config="$temporary_directory/$component-container.json"
    write_crio_configs "$component" "$image_reference" \
        "$pod_config" "$container_config"

    echo "Validating $image_reference with CRI-O 1.34"
    run_crictl pull "$image_reference"
    pod_id="$(run_crictl runp "$pod_config")"
    crio_pod_ids+=("$pod_id")
    container_id="$(run_crictl create \
        "$pod_id" "$container_config" "$pod_config")"
    crio_container_ids+=("$container_id")
    run_crictl start "$container_id" >/dev/null

    state=""
    for ((attempt = 0; attempt < 60; attempt++)); do
        inspect_output="$(run_crictl inspect --output json "$container_id")"
        state="$(jq -r '.status.state' <<<"$inspect_output")"
        if [[ "$state" == "CONTAINER_EXITED" ]]; then
            break
        fi
        sleep 1
    done
    if [[ "$state" != "CONTAINER_EXITED" ]]; then
        echo "$image_reference did not exit under CRI-O within 60 seconds" >&2
        run_crictl logs "$container_id" >&2 || true
        return 1
    fi

    exit_code="$(jq -r '.status.exitCode' <<<"$inspect_output")"
    if [[ "$exit_code" != 0 ]]; then
        run_crictl logs "$container_id" >&2 || true
        echo "$image_reference exited with status $exit_code under CRI-O" >&2
        return 1
    fi

    run_crictl rm "$container_id" >/dev/null
    run_crictl stopp "$pod_id" >/dev/null
    run_crictl rmp "$pod_id" >/dev/null
    crio_container_ids=()
    crio_pod_ids=()
}

for component in "${backend_images[@]}"; do
    image_reference="$image_registry/$component:$image_tag"
    validate_with_containerd "$image_reference"
    validate_with_crio "$component" "$image_reference"
done

echo "PASS: backend images start with containerd and CRI-O 1.34"
