/*
SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.

SPDX-License-Identifier: Apache-2.0
*/

// Package periodic implements the drift-detection sweep described in
// projects/PROJ-taskgroup-crd/PROJ-taskgroup-crd.md "Periodic reconciliation
// (drift detection)".
//
// Why a periodic sweep when there's already an event-driven watch:
//
//	The gRPC status push from controller → Operator Service is best-effort.
//	If the operator is briefly unreachable, an event-driven controller will
//	miss the chance to push the corresponding status. The 60-second sweep
//	pushes a full status summary for every CR the controller owns, so
//	Postgres eventually converges with cluster state regardless of push
//	reliability. This is the multi-cluster safety net.
//
// Default interval is 60s; tunable at controller startup. Sub-10s is
// undesirable (creates needless load on the K8s API); >5min loses the
// "eventually consistent within a minute" guarantee.
package periodic

import (
	"context"
	"errors"
	"log/slog"
	"sync"
	"time"

	workflowv1alpha1 "go.corp.nvidia.com/osmo/apis/workflow/v1alpha1"
	"go.corp.nvidia.com/osmo/controller/dispatcher"
)

// DefaultInterval is the design-doc-specified 60s sweep cadence.
const DefaultInterval = 60 * time.Second

// Lister enumerates the CRs this controller owns. Backed in production by
// a controller-runtime cached client or a client-go lister; the interface
// keeps the periodic loop testable.
type Lister interface {
	List(ctx context.Context) ([]workflowv1alpha1.OSMOTaskGroup, error)
}

// StatusPusher delivers a normalized status to the Operator Service via
// gRPC. The Phase 1 implementation calls the StreamOTGStatus RPC defined in
// src/proto/operator/services.proto. Tests substitute a fake.
type StatusPusher interface {
	Push(ctx context.Context, otg *workflowv1alpha1.OSMOTaskGroup, status workflowv1alpha1.OSMOTaskGroupStatus) error
}

// Loop is the periodic reconciliation goroutine. Construct one per
// controller binary; call Run from main.
type Loop struct {
	Interval     time.Duration
	Lister       Lister
	StatusMapper *dispatcher.Dispatcher
	Pusher       StatusPusher
	Logger       *slog.Logger
}

// Run drives the periodic sweep until ctx is canceled. Each tick:
//  1. Lists all CRs the controller owns.
//  2. For each CR, recomputes status via the matching runtime's StatusMapper.
//  3. Pushes the status to the Operator Service.
//
// Push failures are logged but do not stop the loop — the next tick will
// retry. This is intentional: the periodic loop's whole job is to recover
// from transient errors in the event-driven path.
func (l *Loop) Run(ctx context.Context) error {
	if l.Lister == nil || l.StatusMapper == nil || l.Pusher == nil {
		return errors.New("periodic.Loop missing required dependencies")
	}
	interval := l.Interval
	if interval == 0 {
		interval = DefaultInterval
	}
	logger := l.Logger
	if logger == nil {
		logger = slog.Default()
	}
	ticker := time.NewTicker(interval)
	defer ticker.Stop()

	// Tick once immediately so a freshly-started controller doesn't wait a
	// full interval before its first push.
	l.tick(ctx, logger)
	for {
		select {
		case <-ctx.Done():
			return nil
		case <-ticker.C:
			l.tick(ctx, logger)
		}
	}
}

func (l *Loop) tick(ctx context.Context, logger *slog.Logger) {
	items, err := l.Lister.List(ctx)
	if err != nil {
		logger.Warn("periodic list failed", slog.String("error", err.Error()))
		return
	}

	// Bound parallelism so a large fleet doesn't slam the operator at once.
	const maxConcurrent = 8
	sem := make(chan struct{}, maxConcurrent)
	var wg sync.WaitGroup
	for i := range items {
		otg := &items[i]
		sem <- struct{}{}
		wg.Add(1)
		go func() {
			defer wg.Done()
			defer func() { <-sem }()
			l.pushOne(ctx, otg, logger)
		}()
	}
	wg.Wait()
}

func (l *Loop) pushOne(ctx context.Context, otg *workflowv1alpha1.OSMOTaskGroup, logger *slog.Logger) {
	status, err := l.StatusMapper.MapStatus(ctx, otg)
	if err != nil {
		logger.Warn("status map failed",
			slog.String("group", otg.Name),
			slog.String("error", err.Error()))
		return
	}
	if err := l.Pusher.Push(ctx, otg, status); err != nil {
		logger.Warn("status push failed",
			slog.String("group", otg.Name),
			slog.String("error", err.Error()))
	}
}
