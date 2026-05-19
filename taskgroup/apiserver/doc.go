// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

// Package apiserver hosts the stateless HTTP API server.
//
// In Architecture B (no Postgres) the API server is a thin façade over the control
// cluster's Kubernetes API. Workflows are OSMOWorkflow CRs; the API server just
// translates HTTP requests into K8s API operations on those CRs.
//
// Endpoints (Phase 1):
//
//   POST   /v1/workflows                     Submit a new workflow. Body is a workflow
//                                            YAML; the server validates, translates to
//                                            an OSMOWorkflow CR, and applies it.
//   GET    /v1/workflows                     List workflows in the calling user's namespace.
//   GET    /v1/workflows/{name}              Read one workflow (spec + status).
//   DELETE /v1/workflows/{name}              Cancel + delete a workflow (cascades to
//                                            child OSMOTaskGroups).
//   GET    /v1/workflows/{name}/logs         Streaming log endpoint. Proxies through the
//                                            Operator Service to the target controller.
//                                            (Phase 1 single-cluster: reads pod logs
//                                            directly via the local K8s API.)
//
// Auth: JWT in Authorization: Bearer header. The token's sub claim becomes the K8s
// impersonation user; the workflow's metadata.labels[owner] is populated from the same
// claim. No session state on the server side.
//
// In Phase 2 multi-cluster, the logs endpoint switches to using the Operator Service
// session stream to fetch logs from remote clusters via the GetLogs command.
package apiserver
