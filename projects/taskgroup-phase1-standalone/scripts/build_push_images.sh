#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
cd "${PROJECT_DIR}"

REGISTRY_PREFIX="${REGISTRY_PREFIX:-nvcr.io/nvstaging/osmo/taskgroup-phase1}"
TAG="${TAG:-dev-$(date +%Y%m%d%H%M%S)}"
PLATFORM="${PLATFORM:-linux/amd64}"
PUSH="${PUSH:-true}"
BUILDER="${BUILDER:-auto}"
CONTAINER_ENGINE="${CONTAINER_ENGINE:-docker}"
CONTAINER_ENGINE_CMD="${CONTAINER_ENGINE_CMD:-${CONTAINER_ENGINE}}"
GOOS_VALUE="${GOOS_VALUE:-linux}"
GOARCH_VALUE="${GOARCH_VALUE:-amd64}"
DIST_DIR="${DIST_DIR:-${PROJECT_DIR}/dist/${GOOS_VALUE}_${GOARCH_VALUE}}"

images=(
  "workflow-controller"
  "dispatcher"
  "taskgroup-controller"
  "compute-agent"
)

read -r -a container_engine_cmd <<< "${CONTAINER_ENGINE_CMD}"

mkdir -p "${DIST_DIR}"

for image in "${images[@]}"; do
  output="${DIST_DIR}/${image}"
  echo "Compiling ${image} -> ${output}"
  GOCACHE="${GOCACHE:-${PROJECT_DIR}/.gocache}" \
    CGO_ENABLED=0 GOOS="${GOOS_VALUE}" GOARCH="${GOARCH_VALUE}" \
    go build -trimpath -ldflags="-s -w" -o "${output}" "./cmd/${image}"
done

for image in "${images[@]}"; do
  repository="${REGISTRY_PREFIX}/${image}"
  echo "Building ${repository}:${TAG} for ${PLATFORM}"
  if [[ "${CONTAINER_ENGINE}" == "docker" ]] && { [[ "${BUILDER}" == "buildx" ]] || { [[ "${BUILDER}" == "auto" ]] && docker buildx version >/dev/null 2>&1; }; }; then
    build_args=(
      "--platform=${PLATFORM}"
      "--file=${PROJECT_DIR}/Dockerfile"
      "--target=${image}"
    )
    if [[ "${PUSH}" == "true" ]]; then
      build_args+=("--push")
    else
      build_args+=("--load")
    fi
    docker buildx build \
      "${build_args[@]}" \
      "--tag=${repository}:${TAG}" \
      "--tag=${repository}:latest" \
      "${PROJECT_DIR}"
  else
    "${container_engine_cmd[@]}" build \
      "--platform=${PLATFORM}" \
      "--file=${PROJECT_DIR}/Dockerfile" \
      "--target=${image}" \
      "--tag=${repository}:${TAG}" \
      "--tag=${repository}:latest" \
      "${PROJECT_DIR}"
    if [[ "${PUSH}" == "true" ]]; then
      "${container_engine_cmd[@]}" push "${repository}:${TAG}"
      "${container_engine_cmd[@]}" push "${repository}:latest"
    fi
  fi
done

if [[ "${PUSH}" == "true" ]]; then
  action="Pushed"
else
  action="Built"
fi

cat <<EOF

${action} images:
  ${REGISTRY_PREFIX}/workflow-controller:${TAG}
  ${REGISTRY_PREFIX}/dispatcher:${TAG}
  ${REGISTRY_PREFIX}/taskgroup-controller:${TAG}
  ${REGISTRY_PREFIX}/compute-agent:${TAG}

Helm values:
  image.repository=${REGISTRY_PREFIX}/workflow-controller
  dispatcherImage.repository=${REGISTRY_PREFIX}/dispatcher
  image.repository=${REGISTRY_PREFIX}/taskgroup-controller
  computeAgentImage.repository=${REGISTRY_PREFIX}/compute-agent
  tag=${TAG}
EOF
