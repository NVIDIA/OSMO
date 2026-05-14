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

// Phase 1 binary: per-cluster OSMOTaskGroup controller.
//
// Startup wiring (PROJ-taskgroup-crd.md "Controller design"):
//  1. Build a runtime dispatcher with KAI registered.
//  2. Connect to the cluster's K8s API (in-cluster config falls back to kubeconfig).
//  3. Create a dynamic informer that watches OSMOTaskGroup CRs.
//  4. Workers pull from a rate-limited workqueue and dispatch reconciles by runtime.
//  5. A periodic sweep (60s) pushes a normalized status summary to the
//     Operator Service, backstopping any missed event-driven push.
package main

import (
	"context"
	"flag"
	"log/slog"
	"os"
	"os/signal"
	"syscall"

	"go.corp.nvidia.com/osmo/apis/workflow/v1alpha1"
	"go.corp.nvidia.com/osmo/controller/dispatcher"
	"go.corp.nvidia.com/osmo/controller/kai"
	"go.corp.nvidia.com/osmo/controller/periodic"
	"go.corp.nvidia.com/osmo/controller/runner"

	"k8s.io/client-go/dynamic"
	"k8s.io/client-go/kubernetes"
	"k8s.io/client-go/rest"
	"k8s.io/client-go/tools/clientcmd"
)

type flags struct {
	logLevel      string
	schedulerName string
	namespace     string
	workers       int
}

func parseFlags() flags {
	f := flags{}
	flag.StringVar(&f.logLevel, "log-level", "info", "log level (debug, info, warn, error)")
	flag.StringVar(&f.schedulerName, "kai-scheduler-name", "kai-scheduler", "KAI scheduler name to assign to rendered Pods")
	flag.StringVar(&f.namespace, "namespace", "osmo-workflows", "namespace OSMOTaskGroup CRs live in")
	flag.IntVar(&f.workers, "workers", 4, "number of reconcile workers")
	flag.Parse()
	return f
}

func parseLogLevel(s string) slog.Level {
	var lvl slog.Level
	if err := lvl.UnmarshalText([]byte(s)); err != nil {
		return slog.LevelInfo
	}
	return lvl
}

// k8sConfig loads either an in-cluster config (production) or a kubeconfig
// (development). Mirrors src/operator/utils/k8s_helpers.go's
// CreateKubernetesClient logic.
func k8sConfig() (*rest.Config, error) {
	if cfg, err := rest.InClusterConfig(); err == nil {
		return cfg, nil
	}
	loader := clientcmd.NewDefaultClientConfigLoadingRules()
	overrides := &clientcmd.ConfigOverrides{}
	return clientcmd.NewNonInteractiveDeferredLoadingClientConfig(loader, overrides).ClientConfig()
}

func main() {
	f := parseFlags()
	logger := slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{Level: parseLogLevel(f.logLevel)}))
	slog.SetDefault(logger)

	logger.Info("osmo-taskgroup-controller starting",
		slog.String("scheduler", f.schedulerName),
		slog.String("namespace", f.namespace),
		slog.Int("workers", f.workers),
	)

	cfg, err := k8sConfig()
	if err != nil {
		logger.Error("failed to load k8s config", slog.String("error", err.Error()))
		os.Exit(1)
	}

	kubeClient, err := kubernetes.NewForConfig(cfg)
	if err != nil {
		logger.Error("kubernetes client", slog.String("error", err.Error()))
		os.Exit(1)
	}
	dynClient, err := dynamic.NewForConfig(cfg)
	if err != nil {
		logger.Error("dynamic client", slog.String("error", err.Error()))
		os.Exit(1)
	}

	// Build the dispatcher and register the KAI runtime. Future phases
	// (NIM, Ray, Dynamo, Grove) add entries here — no other changes.
	d := dispatcher.New()
	kaiCfg := kai.Config{
		SchedulerName: f.schedulerName,
		Namespace:     f.namespace,
	}
	d.Register(v1alpha1.RuntimeKAI, dispatcher.Runtime{
		Reconciler: &kai.Reconciler{
			Config:        kaiCfg,
			KubeClient:    kubeClient,
			DynamicClient: dynClient,
		},
		StatusMapper: &kai.StatusMapper{KubeClient: kubeClient},
	})
	logger.Info("registered runtimes", slog.Any("runtimes", []string{"kai"}))

	periodicLoop := &periodic.Loop{
		StatusMapper: d,
		Pusher:       loggingPusher{logger: logger},
		Logger:       logger,
	}

	r, err := runner.New(runner.Options{
		Dispatcher:    d,
		DynamicClient: dynClient,
		Namespace:     f.namespace,
		Workers:       f.workers,
		Periodic:      periodicLoop,
		Logger:        logger,
	})
	if err != nil {
		logger.Error("runner init", slog.String("error", err.Error()))
		os.Exit(1)
	}

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	sigChan := make(chan os.Signal, 1)
	signal.Notify(sigChan, os.Interrupt, syscall.SIGTERM)
	go func() {
		sig := <-sigChan
		logger.Info("received shutdown signal", slog.String("signal", sig.String()))
		cancel()
	}()

	logger.Info("controller running")
	if err := r.Run(ctx); err != nil {
		logger.Error("runner exited with error", slog.String("error", err.Error()))
		os.Exit(1)
	}
	logger.Info("osmo-taskgroup-controller exiting")
}

// loggingPusher is the Phase 1 placeholder for the gRPC status push to the
// Operator Service. Wiring the real TaskGroupService.StreamOTGStatus client
// is the next increment; until then status normalization is exercised end
// to end and the chosen Phase results are visible in the controller log.
type loggingPusher struct {
	logger *slog.Logger
}

func (p loggingPusher) Push(_ context.Context, otg *v1alpha1.OSMOTaskGroup, status v1alpha1.OSMOTaskGroupStatus) error {
	p.logger.Info("status push",
		slog.String("namespace", otg.Namespace),
		slog.String("name", otg.Name),
		slog.String("phase", string(status.Phase)),
		slog.Int64("observedGeneration", status.ObservedGeneration),
	)
	return nil
}
