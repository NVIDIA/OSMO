// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION. All rights reserved.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
// http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.
//
// SPDX-License-Identifier: Apache-2.0

/**
 * Health Check Endpoint
 *
 * Used by Kubernetes for liveness and readiness probes.
 *
 * Endpoints:
 * - GET /health - Returns health status
 *
 * Note: This endpoint is at /health (not /api/health) to avoid being
 * intercepted by the API rewrite proxy in next.config.ts
 *
 * Kubernetes Configuration Example:
 * ```yaml
 * livenessProbe:
 *   httpGet:
 *     path: /v2/health
 *     port: 8000
 *   initialDelaySeconds: 15
 *   periodSeconds: 20
 * readinessProbe:
 *   httpGet:
 *     path: /v2/health
 *     port: 8000
 *   initialDelaySeconds: 5
 *   periodSeconds: 10
 * ```
 */

export async function GET() {
  return Response.json(
    {
      status: "ok",
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
    },
    {
      headers: {
        "Cache-Control": "no-store, no-cache, must-revalidate",
      },
    },
  );
}
