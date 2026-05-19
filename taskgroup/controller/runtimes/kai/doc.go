// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

// Package kai implements the OSMOTaskGroup runtime for batch workloads scheduled by
// the KAI Scheduler.
//
// A KAI task group renders into:
//   - One corev1.Pod per task in spec.runtimeConfig.tasks
//   - One scheduling.kai.run.ai/v2alpha2 PodGroup wrapping all Pods for gang scheduling
//
// The PodGroup is the owner of the Pods; the OSMOTaskGroup is the owner of the PodGroup.
// Cascade delete of the CR removes the PodGroup, which removes the Pods.
//
// Phase 1: this is the only runtime that is fully implemented and tested. Other runtimes
// (NIM, Ray, Dynamo, Grove) live in sibling packages with the same contract.
package kai
