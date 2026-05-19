// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

// Package generic is a future home for the Generic CRD Reconciler — a shared base that the
// nim, ray, dynamo, and grove runtimes will build on.
//
// The pattern (described in the design doc):
//
//   1. Use k8s.io/client-go/dynamic to create/get/watch a target third-party CRD as
//      unstructured.Unstructured. No typed bindings; runtime-specific code only knows the
//      target's GVK + the field paths it cares about.
//   2. Translate OSMOTaskGroupSpec.RuntimeConfig → target CRD spec via a per-runtime
//      template function.
//   3. Set an owner reference from the OSMOTaskGroup to the target CR so cascade delete
//      works automatically.
//   4. Each runtime supplies a status mapper that reads the target's .status and produces
//      a normalized OSMOTaskGroupStatus.
//
// Sharing ~80% of code across NIM, Ray, Dynamo, Grove keeps each runtime ~200 LOC of
// templates + status mapping.
//
// Empty in Phase 1 — NIM and Ray (Phase 3) will be the first consumers.
package generic
