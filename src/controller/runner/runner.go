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

// Package runner assembles the per-cluster OSMOTaskGroup controller out of
// the dispatcher, KAI reconciler, periodic sweep, and a dynamic-client
// informer. It is the glue layer between client-go primitives and the
// runtime-pluggable Reconciler / StatusMapper interfaces in
// `src/controller/dispatcher`.
//
// Phase 1 deliberately avoids sigs.k8s.io/controller-runtime to keep the
// dependency surface tight; controller-runtime's Manager / Reconciler /
// Watch interfaces are a superset of what this package implements, so a
// future swap is a wiring change rather than a redesign.
package runner

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"time"

	workflowv1alpha1 "go.corp.nvidia.com/osmo/apis/workflow/v1alpha1"
	"go.corp.nvidia.com/osmo/controller/dispatcher"
	"go.corp.nvidia.com/osmo/controller/periodic"

	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"k8s.io/client-go/dynamic"
	"k8s.io/client-go/dynamic/dynamicinformer"
	"k8s.io/client-go/tools/cache"
	"k8s.io/client-go/util/workqueue"
)

// OSMOTaskGroupGVR is the GroupVersionResource the controller watches.
var OSMOTaskGroupGVR = schema.GroupVersionResource{
	Group:    workflowv1alpha1.GroupName,
	Version:  "v1alpha1",
	Resource: "osmotaskgroups",
}

// Options configures the Runner. All fields are required except Logger
// (which defaults to slog.Default) and PeriodicInterval (defaults to
// periodic.DefaultInterval).
type Options struct {
	// Dispatcher routes reconciles to per-runtime plugins.
	Dispatcher *dispatcher.Dispatcher

	// DynamicClient watches and resolves OSMOTaskGroup CRs. The dynamic
	// client (vs. a typed client) avoids the codegen toolchain dependency
	// in Phase 1; spec.runtimeConfig / status are decoded via JSON
	// round-trip when the dispatcher needs them.
	DynamicClient dynamic.Interface

	// Namespace scopes the informer. Empty string means cluster-wide.
	Namespace string

	// ResyncInterval drives the informer's full relist cadence. This is
	// distinct from the periodic drift-detection sweep; the informer relist
	// repopulates the cache, the periodic sweep pushes status to the
	// Operator Service.
	ResyncInterval time.Duration

	// Workers caps the number of concurrent reconciles. A small fleet at
	// reasonable QPS is fine with 4–8; defaults to 4.
	Workers int

	// Periodic, when non-nil, runs alongside the event-driven loop. The
	// Lister field is wired automatically from the informer cache so the
	// caller does not have to plumb it.
	Periodic *periodic.Loop

	// Logger receives operational events. Defaults to slog.Default() when nil.
	Logger *slog.Logger
}

// Runner drives the reconcile loop. Construct with New and call Run; Run
// blocks until ctx is canceled.
type Runner struct {
	opts     Options
	informer cache.SharedIndexInformer
	queue    workqueue.RateLimitingInterface
	logger   *slog.Logger
}

// New builds a Runner from Options. Returns an error if required fields are
// missing.
func New(opts Options) (*Runner, error) {
	if opts.Dispatcher == nil {
		return nil, errors.New("runner: Dispatcher is required")
	}
	if opts.DynamicClient == nil {
		return nil, errors.New("runner: DynamicClient is required")
	}
	if opts.Workers == 0 {
		opts.Workers = 4
	}
	if opts.ResyncInterval == 0 {
		opts.ResyncInterval = 10 * time.Minute
	}
	logger := opts.Logger
	if logger == nil {
		logger = slog.Default()
	}

	factory := dynamicinformer.NewFilteredDynamicSharedInformerFactory(
		opts.DynamicClient,
		opts.ResyncInterval,
		opts.Namespace,
		nil,
	)
	informer := factory.ForResource(OSMOTaskGroupGVR).Informer()

	r := &Runner{
		opts:     opts,
		informer: informer,
		queue:    workqueue.NewNamedRateLimitingQueue(workqueue.DefaultControllerRateLimiter(), "osmotaskgroup"),
		logger:   logger,
	}

	if _, err := informer.AddEventHandler(cache.ResourceEventHandlerFuncs{
		AddFunc:    r.enqueue,
		UpdateFunc: func(_, obj interface{}) { r.enqueue(obj) },
		DeleteFunc: r.enqueue,
	}); err != nil {
		return nil, fmt.Errorf("runner: add event handler: %w", err)
	}

	if opts.Periodic != nil {
		opts.Periodic.Lister = informerLister{store: informer.GetStore()}
	}
	return r, nil
}

// Run starts the informer, the periodic sweep (if configured), and the
// reconcile workers. Blocks until ctx is canceled. Returns nil on clean
// shutdown.
func (r *Runner) Run(ctx context.Context) error {
	defer r.queue.ShutDown()

	go r.informer.Run(ctx.Done())
	if !cache.WaitForCacheSync(ctx.Done(), r.informer.HasSynced) {
		return errors.New("runner: informer cache failed to sync")
	}
	r.logger.Info("informer cache synced")

	for i := 0; i < r.opts.Workers; i++ {
		go r.worker(ctx, i)
	}

	if r.opts.Periodic != nil {
		go func() {
			if err := r.opts.Periodic.Run(ctx); err != nil {
				r.logger.Error("periodic loop exited", slog.String("error", err.Error()))
			}
		}()
	}

	<-ctx.Done()
	return nil
}

func (r *Runner) enqueue(obj interface{}) {
	key, err := cache.MetaNamespaceKeyFunc(obj)
	if err != nil {
		r.logger.Warn("enqueue: extract key failed", slog.String("error", err.Error()))
		return
	}
	r.queue.Add(key)
}

func (r *Runner) worker(ctx context.Context, id int) {
	for {
		item, shutdown := r.queue.Get()
		if shutdown {
			return
		}
		key, _ := item.(string)
		err := r.reconcileKey(ctx, key)
		r.queue.Done(item)
		if err != nil {
			// Backoff via the rate limiter. Phase 1 doesn't yet distinguish
			// transient from permanent errors; that's a follow-up.
			r.queue.AddRateLimited(item)
			r.logger.Warn("reconcile failed; requeuing",
				slog.String("key", key),
				slog.Int("worker", id),
				slog.String("error", err.Error()))
			continue
		}
		r.queue.Forget(item)
	}
}

func (r *Runner) reconcileKey(ctx context.Context, key string) error {
	obj, exists, err := r.informer.GetStore().GetByKey(key)
	if err != nil {
		return fmt.Errorf("lookup %s: %w", key, err)
	}
	if !exists {
		// Object was deleted; nothing to reconcile on this side.
		return nil
	}
	u, ok := obj.(*unstructured.Unstructured)
	if !ok {
		return fmt.Errorf("unexpected store object type %T", obj)
	}
	otg, err := unstructuredToOSMOTaskGroup(u)
	if err != nil {
		return fmt.Errorf("decode %s: %w", key, err)
	}
	result, err := r.opts.Dispatcher.Reconcile(ctx, otg)
	if err != nil {
		return err
	}
	if result.RequeueAfter > 0 {
		r.queue.AddAfter(key, result.RequeueAfter)
	} else if result.Requeue {
		r.queue.AddRateLimited(key)
	}
	return nil
}

// informerLister adapts a cache.Store into the periodic.Lister interface so
// the periodic sweep enumerates from the informer cache rather than hitting
// the API server on every tick.
type informerLister struct {
	store cache.Store
}

func (l informerLister) List(_ context.Context) ([]workflowv1alpha1.OSMOTaskGroup, error) {
	objs := l.store.List()
	out := make([]workflowv1alpha1.OSMOTaskGroup, 0, len(objs))
	for _, o := range objs {
		u, ok := o.(*unstructured.Unstructured)
		if !ok {
			continue
		}
		otg, err := unstructuredToOSMOTaskGroup(u)
		if err != nil {
			continue
		}
		out = append(out, *otg)
	}
	return out, nil
}

func unstructuredToOSMOTaskGroup(u *unstructured.Unstructured) (*workflowv1alpha1.OSMOTaskGroup, error) {
	b, err := json.Marshal(u.Object)
	if err != nil {
		return nil, err
	}
	var otg workflowv1alpha1.OSMOTaskGroup
	if err := json.Unmarshal(b, &otg); err != nil {
		return nil, err
	}
	return &otg, nil
}
