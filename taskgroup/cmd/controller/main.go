// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

// Command controller runs the OSMOTaskGroup controllers.
//
// In a single-cluster all-in-one deployment, both the Workflow Controller and the
// TaskGroup Controller run here, plus optionally the Operator Service (in a separate
// binary, cmd/operator). The Workflow Controller dispatches CRs locally; no session
// stream is involved.
//
// In a split deployment:
//
//   - Control cluster runs: --enable-workflow-controller=true
//     --enable-taskgroup-controller=true (optional)
//     --operator-bus-enabled=true (in-process bus to send commands to remote clusters)
//
//   - Backend cluster runs: --enable-taskgroup-controller=true
//     --enable-workflow-controller=false
//     --operator-endpoint=<control-cluster-operator:9000>
//     --cluster-id=<this-cluster's-OSMOCluster-name>
//     --cluster-token-file=/var/run/secrets/osmo/token
//
// When --operator-endpoint is set, the binary also runs a session client that opens a
// long-lived bidi stream to the Operator Service in the control cluster.
package main

import (
	"context"
	"flag"
	"fmt"
	"net"
	"os"

	"google.golang.org/grpc"
	ctrl "sigs.k8s.io/controller-runtime"
	"sigs.k8s.io/controller-runtime/pkg/manager"
	metricsserver "sigs.k8s.io/controller-runtime/pkg/metrics/server"

	v1alpha1 "github.com/nvidia/osmo/taskgroup/api/v1alpha1"
	"github.com/nvidia/osmo/taskgroup/controller"
	"github.com/nvidia/osmo/taskgroup/controller/runtimes"
	"github.com/nvidia/osmo/taskgroup/controller/runtimes/kai"
	"github.com/nvidia/osmo/taskgroup/controller/session"
	"github.com/nvidia/osmo/taskgroup/controller/workflow"
	"github.com/nvidia/osmo/taskgroup/internal/k8s"
	osmolog "github.com/nvidia/osmo/taskgroup/internal/log"
	"github.com/nvidia/osmo/taskgroup/operator"
	operatorpb "github.com/nvidia/osmo/taskgroup/operator/proto"
)

// ControllerVersion is the binary's build version. Overridden at build time with
// -ldflags='-X main.ControllerVersion=...'.
var ControllerVersion = "dev"

func main() {
	cfg := parseFlags()

	ctrl.SetLogger(osmolog.New())
	logger := ctrl.Log.WithName("taskgroup-controller")

	restCfg, err := k8s.Config(cfg.kubeconfig)
	if err != nil {
		logger.Error(err, "loading kubeconfig")
		os.Exit(1)
	}

	mgr, err := ctrl.NewManager(restCfg, manager.Options{
		Scheme:                 k8s.Scheme(),
		LeaderElection:         cfg.leaderElect,
		LeaderElectionID:       "taskgroup.controller.workflow.osmo.nvidia.com",
		HealthProbeBindAddress: cfg.probeAddr,
		Metrics:                metricsserver.Options{BindAddress: cfg.metricsAddr},
	})
	if err != nil {
		logger.Error(err, "creating manager")
		os.Exit(1)
	}

	// Optional session client to the central Operator Service.
	var sessionClient *session.Client
	if cfg.operatorEndpoint != "" {
		if cfg.clusterID == "" || cfg.clusterTokenFile == "" {
			logger.Error(fmt.Errorf("missing flags"), "--operator-endpoint requires --cluster-id and --cluster-token-file")
			os.Exit(1)
		}
		token, err := os.ReadFile(cfg.clusterTokenFile)
		if err != nil {
			logger.Error(err, "reading cluster token file")
			os.Exit(1)
		}
		sessionClient, err = session.NewClient(session.Config{
			OperatorEndpoint:  cfg.operatorEndpoint,
			ClusterID:         cfg.clusterID,
			Token:             string(token),
			SupportedRuntimes: []string{string(v1alpha1.RuntimeKAI)},
			ControllerVersion: ControllerVersion,
		}, mgr.GetClient())
		if err != nil {
			logger.Error(err, "constructing session client")
			os.Exit(1)
		}
	}

	if cfg.enableTaskGroup {
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

	// Optionally embed the Operator Service in this same process. When enabled, the
	// Workflow Controller's RemoteResolver routes through the in-process CommandBus
	// instead of needing a separate gRPC hop. This is the "control cluster" deployment
	// shape: one binary owns the workflow controller + operator service.
	var commandBus *operator.CommandBus
	if cfg.operatorServeBind != "" {
		sessions := operator.NewSessionRegistry()
		bus := operator.NewStatusBus()
		commandBus = &operator.CommandBus{Sessions: sessions}

		svc := &operator.ClusterSessionServer{
			Client:            mgr.GetClient(),
			Auth:              &operator.ClusterAuthenticator{Client: mgr.GetClient()},
			Sessions:          sessions,
			Status:            bus,
			ControllerVersion: ControllerVersion,
		}
		listener, err := net.Listen("tcp", cfg.operatorServeBind)
		if err != nil {
			logger.Error(err, "operator service listen failed", "bind", cfg.operatorServeBind)
			os.Exit(1)
		}
		grpcServer := grpc.NewServer()
		operatorpb.RegisterClusterSessionServer(grpcServer, svc)
		go func() {
			logger.Info("operator service listening", "bind", cfg.operatorServeBind)
			if err := grpcServer.Serve(listener); err != nil {
				logger.Error(err, "operator service exited")
			}
		}()
	}

	if cfg.enableWorkflow {
		wfr := &workflow.Reconciler{
			Client: mgr.GetClient(),
			Scheme: mgr.GetScheme(),
			LocalDispatcher: &workflow.LocalDispatcher{
				Client:    mgr.GetClient(),
				Namespace: cfg.taskGroupNamespace,
			},
		}
		if commandBus != nil {
			wfr.RemoteResolver = workflow.NewRemoteResolver(mgr.GetClient(), commandBus, cfg.taskGroupNamespace)
		}
		if err := wfr.SetupWithManager(mgr); err != nil {
			logger.Error(err, "setting up Workflow reconciler")
			os.Exit(1)
		}
		logger.Info("Workflow controller enabled", "taskgroup_namespace", cfg.taskGroupNamespace, "remote_dispatch", commandBus != nil)
	}

	// Run the session client alongside the manager. It uses the same lifecycle: ctx
	// cancel on signal handlers fires both shutdowns.
	mgrCtx := ctrl.SetupSignalHandler()
	if sessionClient != nil {
		go func() {
			if err := sessionClient.Run(mgrCtx); err != nil {
				logger.Error(err, "session client exited with error")
			}
		}()
		logger.Info("session client to Operator Service started",
			"endpoint", cfg.operatorEndpoint,
			"cluster_id", cfg.clusterID,
		)
	}

	if err := mgr.Start(mgrCtx); err != nil {
		logger.Error(err, "manager exited with error")
		os.Exit(1)
	}
}

type flags struct {
	kubeconfig         string
	taskGroupNamespace string
	metricsAddr        string
	probeAddr          string
	leaderElect        bool
	enableWorkflow     bool
	enableTaskGroup    bool
	operatorEndpoint   string
	operatorServeBind  string
	clusterID          string
	clusterTokenFile   string
}

func parseFlags() flags {
	var f flags
	flag.StringVar(&f.kubeconfig, "kubeconfig", "", "Path to kubeconfig. Empty = in-cluster or default.")
	flag.StringVar(&f.taskGroupNamespace, "taskgroup-namespace", "osmo-workflows", "Namespace where dispatched OSMOTaskGroup CRs are created (used by Workflow Controller).")
	flag.StringVar(&f.metricsAddr, "metrics-bind-address", ":8080", "Bind address for Prometheus metrics.")
	flag.StringVar(&f.probeAddr, "health-probe-bind-address", ":8081", "Bind address for /healthz and /readyz.")
	flag.BoolVar(&f.leaderElect, "leader-elect", false, "Run with leader election for HA controller replicas.")
	flag.BoolVar(&f.enableWorkflow, "enable-workflow-controller", true, "Run the Workflow Controller (DAG orchestration).")
	flag.BoolVar(&f.enableTaskGroup, "enable-taskgroup-controller", true, "Run the TaskGroup Controller (per-CR runtime dispatch).")
	flag.StringVar(&f.operatorEndpoint, "operator-endpoint", "", "gRPC endpoint of the central Operator Service. When set, the binary runs a session client.")
	flag.StringVar(&f.operatorServeBind, "operator-serve-bind", "", "If non-empty, also run the Operator Service gRPC server in-process on this address. Used by the control cluster binary so the Workflow Controller can share its CommandBus.")
	flag.StringVar(&f.clusterID, "cluster-id", "", "This cluster's identifier. Must match an OSMOCluster.metadata.name in the control cluster. Required if --operator-endpoint is set.")
	flag.StringVar(&f.clusterTokenFile, "cluster-token-file", "", "Path to a file containing the cluster's plaintext bearer token. Required if --operator-endpoint is set.")
	flag.Parse()
	return f
}

func registerRuntimes(d *controller.Dispatcher, mgr ctrl.Manager) error {
	deps := runtimes.Dependencies{Client: mgr.GetClient()}

	factories := map[v1alpha1.RuntimeType]runtimes.Factory{
		v1alpha1.RuntimeKAI: kai.New,
		// Phase 3+:
		// v1alpha1.RuntimeNIM:    nim.New,
		// v1alpha1.RuntimeRay:    ray.New,
		// v1alpha1.RuntimeDynamo: dynamo.New,
		// v1alpha1.RuntimeGrove:  grove.New,
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

// ctxBackground is a small helper to silence the unused import warning when nothing else
// references context. Kept in case future wiring needs it.
var _ = context.Background
