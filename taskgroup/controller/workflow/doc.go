// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

// Package workflow implements the Workflow Controller — the brain that turns an
// OSMOWorkflow CR (a DAG of groups) into per-cluster OSMOTaskGroup CRs.
//
// The Workflow Controller lives in the control cluster. For each OSMOWorkflow it owns,
// it:
//
//   1. Resolves the DAG (every group's dependsOn) to determine which groups are ready
//      to run right now.
//   2. For each ready group, creates an OSMOTaskGroup CR — either in the local cluster
//      (single-cluster mode, or when spec.cluster is empty) or in a remote backend
//      cluster (via the Operator Service's stream to that cluster's controller).
//   3. Watches OSMOTaskGroup statuses (locally) and listens for status events from
//      remote clusters (via the operator service) and rolls them up into the parent
//      OSMOWorkflow.status.
//   4. Marks the workflow Succeeded when all groups Succeeded, Failed when any group
//      fails terminally.
//   5. On workflow delete: cascades the delete to all child OSMOTaskGroups, in every
//      cluster they live in.
//
// In Architecture B (no Postgres), this controller IS the workflow orchestration logic.
// What used to be Python code in the OSMO API server (DAG resolution, dependency
// tracking, status aggregation) moves here as Go controller-runtime code.
package workflow
