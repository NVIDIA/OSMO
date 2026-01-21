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

# syntax=docker/dockerfile:1.4

# =============================================================================
# BUILD COMMANDS
# =============================================================================
#
# Build for Kubernetes (from Apple Silicon Mac):
#   cd external/ui-next
#   docker login nvcr.io
#   docker build --platform linux/amd64 -t nvcr.io/nvstaging/osmo/web-ui-next:YOUR_TAG .
#   docker push nvcr.io/nvstaging/osmo/web-ui-next:YOUR_TAG
#
# Build for Kubernetes (from Linux/Intel Mac):
#   docker build -t nvcr.io/nvstaging/osmo/web-ui-next:YOUR_TAG .
#   docker push nvcr.io/nvstaging/osmo/web-ui-next:YOUR_TAG
#
# Multi-arch build (supports both amd64 and arm64 clusters):
#   docker buildx build --platform linux/amd64,linux/arm64 \
#     -t nvcr.io/nvstaging/osmo/web-ui-next:YOUR_TAG --push .
#
# Debug build (no cache):
#   docker build --no-cache --progress=plain -t web-ui-next:debug .
#
# =============================================================================

# =============================================================================
# Stage 1: Dependencies (cached unless package.json/pnpm-lock.yaml change)
# =============================================================================
FROM node:22-slim AS deps

# Enable corepack for pnpm (reads version from package.json packageManager field)
RUN corepack enable

WORKDIR /app

# Copy ONLY dependency files first (maximizes cache hits)
COPY package.json pnpm-lock.yaml ./

# Install dependencies with BuildKit cache mount (persists pnpm store between builds)
RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile

# =============================================================================
# Stage 2: Build (rebuilds when source changes, but deps are cached)
# =============================================================================
FROM node:22-slim AS builder

RUN corepack enable

WORKDIR /app

# Copy dependencies from deps stage
COPY --from=deps /app/node_modules ./node_modules

# Copy source files
COPY package.json pnpm-lock.yaml next.config.ts tsconfig.json postcss.config.mjs ./
COPY public ./public
COPY src ./src
COPY scripts ./scripts

# Build with BuildKit cache for Next.js build cache
RUN --mount=type=cache,target=/app/.next/cache \
    pnpm build

# =============================================================================
# Stage 3: Production image (same base as legacy UI)
# =============================================================================
# Uses same NVIDIA distroless image as legacy UI (see external/MODULE.bazel:295-303)
FROM nvcr.io/nvidia/distroless/node:22-v3.1.1 AS runner

WORKDIR /app

# Copy standalone output (matches legacy UI structure)
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public

# Create cache directory for cacheComponents (Partial Prerendering)
# Must be done before switching to nonroot user to ensure proper permissions
# Using UID 1000 to match Kubernetes deployment's runAsUser setting
RUN mkdir -p /app/.next/cache && chown -R 1000:1000 /app/.next/cache

ENV HOSTNAME=0.0.0.0
ENV NODE_ENV=production
ENV NEXT_PUBLIC_APP_NAME=OSMO

USER nonroot

# Match legacy UI pattern: entrypoint=node, cmd=server.js
ENTRYPOINT ["node"]
CMD ["server.js"]
