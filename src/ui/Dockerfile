# SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION. All rights reserved.
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
# http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.
#
# SPDX-License-Identifier: Apache-2.0

# syntax=docker/dockerfile:1.12

# =============================================================================
# BUILD COMMANDS
# =============================================================================
#
# Standard build for Kubernetes (from Apple Silicon Mac):
#   cd external/src/ui
#   docker login $REGISTRY
#   docker buildx build --platform linux/amd64 \
#     -t $REGISTRY/osmo/web-ui:YOUR_TAG .
#   docker push $REGISTRY/osmo/web-ui:YOUR_TAG
#
# Build for Kubernetes (from Linux/Intel Mac):
#   docker build -t $REGISTRY/osmo/web-ui:YOUR_TAG .
#   docker push $REGISTRY/osmo/web-ui:YOUR_TAG
#
# Multi-arch build (supports both amd64 and arm64 clusters):
#   docker buildx build --platform linux/amd64,linux/arm64 \
#     -t $REGISTRY/osmo/web-ui:YOUR_TAG --push .
#
# Build with custom basePath (e.g., for subpath deployment at /v2):
#   docker build --build-arg NEXT_PUBLIC_BASE_PATH="/v2" \
#     -t $REGISTRY/osmo/web-ui:YOUR_TAG .
#
# Build with source maps enabled (for debugging):
#   docker build --build-arg ENABLE_SOURCE_MAPS=true \
#     -t $REGISTRY/osmo/web-ui:YOUR_TAG .
#
# Note: Backend API hostname is configured at RUNTIME via Kubernetes environment
# variables (NEXT_PUBLIC_OSMO_API_HOSTNAME), not at build time. This makes the
# Docker image portable across environments - critical for open source deployment.
#
# Debug build (no cache, verbose output):
#   docker build --no-cache --progress=plain -t web-ui:debug .
#
# =============================================================================

# =============================================================================
# Stage 1: Dependencies (cached unless package.json/pnpm-lock.yaml change)
# =============================================================================
ARG NODE_BUILD_IMAGE=node:24-slim
ARG NODE_DISTROLESS_IMAGE=nvcr.io/nvidia/distroless/node:24-v4.0.2

FROM ${NODE_BUILD_IMAGE} AS deps

# Pin corepack home so we can copy the cached pnpm binary to later stages
ENV COREPACK_HOME=/opt/corepack
# Disable Next.js telemetry so postinstall does not phone home during pnpm install
ENV NEXT_TELEMETRY_DISABLED=1

# Enable corepack for pnpm (reads version from package.json packageManager field)
RUN corepack enable

WORKDIR /app

# Copy ONLY dependency files first (maximizes cache hits)
# .npmrc is included so pnpm inherits fetch-retries=5 (critical on ARM64 CI)
COPY package.json pnpm-lock.yaml .npmrc ./

# Download pnpm via corepack with retries (corepack has no built-in retry;
# ARM64 CI nodes experience intermittent registry.npmjs.org timeouts)
RUN for attempt in 1 2 3; do \
      corepack install && break || \
      if [ "$attempt" = "3" ]; then \
        echo "corepack install failed after 3 attempts" >&2; exit 1; \
      else \
        echo "corepack install attempt $attempt/3 failed, retrying in 15s..."; sleep 15; \
      fi; \
    done

# Create public directory for postinstall script
RUN mkdir -p public

# Install dependencies with BuildKit cache mount (persists pnpm store between builds)
# TARGETPLATFORM isolates AMD64/ARM64 caches (prevents native binary cross-contamination)
# sharing=locked prevents concurrent-build cache corruption
ARG TARGETPLATFORM
RUN --mount=type=cache,id=pnpm-${TARGETPLATFORM},target=/root/.local/share/pnpm/store,sharing=locked \
    for attempt in 1 2 3; do \
      pnpm install --frozen-lockfile && break || \
      if [ "$attempt" = "3" ]; then \
        echo "pnpm install failed after 3 attempts" >&2; exit 1; \
      else \
        echo "pnpm install attempt $attempt/3 failed, retrying in 20s..."; sleep 20; \
      fi; \
    done

# =============================================================================
# Stage 2: Build (rebuilds when source changes, but deps are cached)
# =============================================================================
FROM ${NODE_BUILD_IMAGE} AS builder

ENV COREPACK_HOME=/opt/corepack
ENV COREPACK_ENABLE_NETWORK=0

RUN corepack enable

# Reuse the pnpm binary already downloaded in the deps stage (avoids a
# network round-trip to registry.npmjs.org that intermittently times out
# on ARM64 CI nodes).  COREPACK_ENABLE_NETWORK=0 ensures a fast, clear
# failure if the cache is missing instead of a 10s connect timeout.
COPY --from=deps /opt/corepack /opt/corepack

WORKDIR /app

# Copy dependencies from deps stage
COPY --from=deps /app/node_modules ./node_modules

# Copy source files
COPY package.json pnpm-lock.yaml next.config.ts tsconfig.json postcss.config.mjs ./
COPY src ./src
COPY scripts ./scripts

# Copy public files from source (committed files like favicon.ico)
# Note: mockServiceWorker.js is excluded via .dockerignore (dev-only, aliased out in prod)
COPY public ./public

# Overlay public/ from deps stage to capture any postinstall-generated files
COPY --from=deps /app/public/ ./public/

# =============================================================================
# Build Arguments - Can be overridden at build time
# =============================================================================
# Example: docker build --build-arg NEXT_PUBLIC_BASE_PATH="" .
#
# BasePath for UI deployment (e.g., /v2 for dual deployment, "" for canonical)
ARG NEXT_PUBLIC_BASE_PATH=

# Enable source maps in production (disabled by default for faster builds)
ARG ENABLE_SOURCE_MAPS=false

# Disable Next.js telemetry in CI/CD builds
ARG NEXT_TELEMETRY_DISABLED=1

# =============================================================================
# Set build environment variables
# =============================================================================
# Convert ARGs to ENVs so Next.js build process can access them via process.env
#
# Note: NEXT_PUBLIC_OSMO_API_HOSTNAME and NEXT_PUBLIC_OSMO_SSL_ENABLED are
# intentionally NOT set at build time. They are read at RUNTIME from the
# container environment, making the Docker image portable across environments.
# This is critical for open source deployment where backend hostname varies.

ENV NEXT_PUBLIC_BASE_PATH=${NEXT_PUBLIC_BASE_PATH}
ENV ENABLE_SOURCE_MAPS=${ENABLE_SOURCE_MAPS}
ENV NEXT_TELEMETRY_DISABLED=${NEXT_TELEMETRY_DISABLED}
ENV NODE_ENV=production

# =============================================================================
# Build Next.js application
# =============================================================================
# BuildKit cache mount persists .next/cache between builds for faster rebuilds
# TARGETPLATFORM isolates caches per arch; sharing=locked prevents concurrent writes
ARG TARGETPLATFORM
RUN --mount=type=cache,id=nextjs-${TARGETPLATFORM},target=/app/.next/cache,sharing=locked \
    pnpm build

# =============================================================================
# Stage 2.5: Prepare cache directory (has shell for mkdir/chown)
# =============================================================================
FROM ${NODE_BUILD_IMAGE} AS cache-prep

# Create cache directory with correct ownership
# Using UID 1000 to match Kubernetes deployment's runAsUser setting
RUN mkdir -p /cache && \
    chown -R 1000:1000 /cache

# =============================================================================
# Stage 3: Production image (same base as legacy UI)
# =============================================================================
FROM ${NODE_DISTROLESS_IMAGE} AS runner

WORKDIR /app

# Copy standalone output (matches legacy UI structure)
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public

# Copy cache directory from cache-prep stage (with correct permissions)
# Must be done before switching to nonroot user to ensure proper permissions
COPY --from=cache-prep --chown=1000:1000 /cache ./.next/cache

# =============================================================================
# Runtime Environment Variables
# =============================================================================
# These can be overridden at runtime via Helm chart values (extraEnvs)
# Note: NEXT_PUBLIC_* vars set at build time are baked into the bundle
#       Runtime overrides only work for server-side code, not client-side

ENV HOSTNAME=0.0.0.0
ENV NODE_ENV=production
ENV NEXT_PUBLIC_APP_NAME=OSMO

# Optional: Set default runtime values (can be overridden by Kubernetes)
# ENV NEXT_PUBLIC_BASE_PATH=/v2
# ENV NEXT_PUBLIC_OSMO_API_HOSTNAME=osmo-service.osmo.svc.cluster.local:80
# ENV NEXT_PUBLIC_OSMO_SSL_ENABLED=false

USER nonroot

# Match legacy UI pattern: entrypoint=node, cmd=server.js
ENTRYPOINT ["node"]
CMD ["server.js"]
