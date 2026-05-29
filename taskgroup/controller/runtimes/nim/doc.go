// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

// Package nim implements the NIM (NVIDIA Inference Microservice) runtime for OSMO.
//
// An OSMOTaskGroup with RuntimeType == "nim" is rendered into a single NIMService CR
// (apps.nvidia.com/v1alpha1, kind NIMService) that the NVIDIA NIM Operator on the
// backend cluster picks up and turns into a Deployment + Service + ConfigMap. OSMO's
// reconciler owns the NIMService CR via owner reference; cascade delete removes
// everything when the OTG goes away.
//
// Field exposure is intentionally narrow — NIMRuntimeConfig in api/v1alpha1/runtime_nim.go
// is the OSMO contract; this package adapts it to the upstream NIMService shape.
// When NIM Operator's CRD evolves, this is the only place that needs to change.
package nim
