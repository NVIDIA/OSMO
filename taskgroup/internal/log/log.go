// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

// Package log centralizes logger setup so the controller and Operator Service binaries
// emit consistent structured JSON. controller-runtime expects a logr.Logger, which this
// package returns.
package log

import (
	"github.com/go-logr/logr"
	"k8s.io/klog/v2"
)

// New returns a logr.Logger backed by klog. The controller binaries call this once at
// startup and pass the returned logger to ctrl.SetLogger.
func New() logr.Logger {
	return klog.Background()
}
