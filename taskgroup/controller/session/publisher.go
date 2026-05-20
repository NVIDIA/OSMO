// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

// The previous version of this file defined a StatusPublisher EventHandler that was
// never actually wired into the controller-runtime watch. The simpler design used now
// is for the TaskGroup Reconciler to call session.Client.Report() (which implements
// controller.StatusReporter) after every reconcile — see cmd/controller/main.go.
//
// This file is intentionally minimal; keeping the package non-empty for future
// extensions (e.g. a separate watcher that pushes status without going through the
// reconciler, for runtimes that don't have a TaskGroup-style reconciler).

package session
