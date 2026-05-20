// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

// Package session implements the controller-side of the OSMOTaskGroup cluster session
// protocol. The TaskGroup Controller in a backend cluster runs a session client that:
//
//   1. Opens an outbound gRPC stream to the central Operator Service at startup.
//   2. Sends Hello with the cluster's ID, version, supported runtimes, and bearer token.
//   3. Receives OperatorEnvelopes (CreateOTG, DeleteOTG, GetLogs, Drain) and applies them
//      to the controller's *own* local K8s API using its in-cluster service account.
//   4. Watches OSMOTaskGroup status changes locally and pushes OTGStatusEvents back over
//      the same stream.
//   5. Reconnects with exponential backoff if the stream fails — the controller never
//      gives up, it just keeps trying. Meanwhile any locally-reconciling task groups
//      continue running; only the cross-cluster status flow degrades.
//
// The session client never holds K8s credentials for any other cluster. All command
// application happens through the local client.Client.
package session
