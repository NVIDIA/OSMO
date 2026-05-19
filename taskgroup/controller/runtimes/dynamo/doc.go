// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

// Package dynamo is the Phase 5 placeholder for the NVIDIA Dynamo runtime
// (disaggregated prefill / decode serving).
//
// When implemented, this package will:
//
//   - Decode DynamoRuntimeConfig from OSMOTaskGroupSpec.RuntimeConfig
//   - Render a DynamoGraphDeployment CR
//   - Roll up per-component Dynamo statuses to the normalized phase
package dynamo
