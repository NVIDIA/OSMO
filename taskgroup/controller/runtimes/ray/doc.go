// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

// Package ray implements the Ray runtime for OSMO.
//
// An OSMOTaskGroup with RuntimeType == "ray" is rendered into a single RayJob CR
// (ray.io/v1, kind RayJob) that KubeRay on the backend cluster materializes into
// a RayCluster + driver Pod and runs the configured entrypoint. OSMO's reconciler
// owns the RayJob CR via owner reference; cascade delete removes everything when
// the OTG goes away. We rely on KubeRay's ShutdownAfterJobFinishes (default true)
// to tear down the embedded RayCluster as the job terminates.
//
// Field exposure is intentionally narrow — RayRuntimeConfig in
// api/v1alpha1/runtime_ray.go is the OSMO contract; this package adapts it to
// the upstream RayJob shape. When KubeRay's CRD evolves, this is the only place
// that needs to change.
package ray
