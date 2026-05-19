// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

// Command controller runs both the TaskGroup Controller (reconciles OSMOTaskGroup CRs
// into runtime-native K8s objects) and the Workflow Controller (orchestrates DAGs of
// OSMOTaskGroups via OSMOWorkflow CRs).
//
// In Phase 1 single-cluster these run in the same binary and the same cluster. In
// Phase 2+ they can be deployed separately if needed (e.g. Workflow Controller only in
// the control cluster, TaskGroup Controller in every backend cluster).
package main

import (
	"flag"
	"fmt"
	"os"

	ctrl "sigs.k8s.io/controller-runtime"
	"sigs.k8s.io/controller-runtime/pkg/manager"

	v1alpha1 "github.com/nvidia/osmo/taskgroup/api/v1alpha1"
	"github.com/nvidia/osmo/taskgroup/controller"
	"github.com/nvidia/osmo/taskgroup/controller/runtimes"
	"github.com/nvidia/osmo/taskgroup/controller/runtimes/kai"
	"github.com/nvidia/osmo/taskgroup/controller/workflow"
	"github.com/nvidia/osmo/taskgroup/internal/k8s"
	osmolog "github.com/nvidia/osmo/taskgroup/internal/log"
)

func main() {
	var (
		kubeconfig         string
		taskGroupNamespace string
		metricsAddr        string
		probeAddr          string
		leaderElect        bool
		enableWorkflow     bool
		enableTaskGroup    bool
	)
	flag.StringVar(&kubeconfig, "kubeconfig", "", "Path to kubeconfig. Empty = in-cluster or default.")
	flag.StringVar(&taskGroupNamespace, "taskgroup-namespace", "osmo-workflows", "Namespace where dispatched OSMOTaskGroup CRs are created (used by Workflow Controller).")
	flag.StringVar(&metricsAddr, "metrics-bind-address", ":8080", "Bind address for Prometheus metrics.")
	flag.StringVar(&probeAddr, "health-probe-bind-address", ":8081", "Bind address for /healthz and /readyz.")
	flag.BoolVar(&leaderElect, "leader-elect", false, "Run with leader election for HA controller replicas.")
	flag.BoolVar(&enableWorkflow, "enable-workflow-controller", true, "Run the Workflow Controller (DAG orchestration).")
	flag.BoolVar(&enableTaskGroup, "enable-taskgroup-controller", true, "Run the TaskGroup Controller (per-CR runtime dispatch).")
	flag.Parse()

	ctrl.SetLogger(osmolog.New())
	logger := ctrl.Log.WithName("taskgroup-controller")

	cfg, err := k8s.Config(kubeconfig)
	if err != nil {
		logger.Error(err, "loading kubeconfig")
		os.Exit(1)
	}

	mgr, err := ctrl.NewManager(cfg, manager.Options{
		Scheme:                 k8s.Scheme(),
		LeaderElection:         leaderElect,
		LeaderElectionID:       "taskgroup.controller.workflow.osmo.nvidia.com",
		HealthProbeBindAddress: probeAddr,
	})
	if err != nil {
		logger.Error(err, "creating manager")
		os.Exit(1)
	}

	// TaskGroup Controller (per-CR runtime dispatch).
	if enableTaskGroup {
		dispatcher := controller.NewDispatcher()
		if err := registerRuntimes(dispatcher, mgr); err != nil {
			logger.Error(err, "registering runtimes")
			os.Exit(1)
		}
		tgr := &controller.Reconciler{
			Client:     mgr.GetClient(),
			Scheme:     mgr.GetScheme(),
			Dispatcher: dispatcher,
		}
		if err := tgr.SetupWithManager(mgr); err != nil {
			logger.Error(err, "setting up TaskGroup reconciler")
			os.Exit(1)
		}
		logger.Info("TaskGroup controller enabled", "registered_runtimes", dispatcher.Registered())
	}

	// Workflow Controller (DAG orchestration). Phase 1 has only a local dispatcher;
	// Phase 2 wires in RemoteResolver to dispatch to other clusters via the session
	// registry on the Operator Service.
	if enableWorkflow {
		wfr := &workflow.Reconciler{
			Client: mgr.GetClient(),
			Scheme: mgr.GetScheme(),
			LocalDispatcher: &workflow.LocalDispatcher{
				Client:    mgr.GetClient(),
				Namespace: taskGroupNamespace,
			},
			// RemoteResolver intentionally nil in Phase 1.
		}
		if err := wfr.SetupWithManager(mgr); err != nil {
			logger.Error(err, "setting up Workflow reconciler")
			os.Exit(1)
		}
		logger.Info("Workflow controller enabled", "taskgroup_namespace", taskGroupNamespace)
	}

	if err := mgr.Start(ctrl.SetupSignalHandler()); err != nil {
		logger.Error(err, "manager exited with error")
		os.Exit(1)
	}
}

func registerRuntimes(d *controller.Dispatcher, mgr ctrl.Manager) error {
	deps := runtimes.Dependencies{Client: mgr.GetClient()}

	factories := map[v1alpha1.RuntimeType]runtimes.Factory{
		v1alpha1.RuntimeKAI: kai.New,
		// v1alpha1.RuntimeNIM:    nim.New,    // Phase 3
		// v1alpha1.RuntimeRay:    ray.New,    // Phase 3
		// v1alpha1.RuntimeDynamo: dynamo.New, // Phase 5
		// v1alpha1.RuntimeGrove:  grove.New,  // Phase 5
	}
	for t, f := range factories {
		rt, err := f(deps)
		if err != nil {
			return fmt.Errorf("constructing %s runtime: %w", t, err)
		}
		d.Register(t, rt)
	}
	return nil
}
