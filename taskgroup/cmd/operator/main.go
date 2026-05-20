// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

// Command operator runs the gRPC Operator Service.
//
// Phase 2 MVP: insecure (plain HTTP/2 gRPC) transport. Backend clusters connect outbound
// to this endpoint, authenticate with a per-cluster bearer token (whose SHA-256 hash is
// stored in an OSMOCluster.spec.tokenSecretRef Secret), and hold a long-lived bidi
// stream. The Operator Service forwards commands from the Workflow Controller onto the
// right stream and fans status events back out via an in-process status bus.
//
// Production hardening (out of scope for the MVP): TLS / mTLS, per-cluster rate limits,
// audit log of every command issued, structured token rotation.
package main

import (
	"flag"
	"fmt"
	"net"
	"os"
	"os/signal"
	"syscall"

	"google.golang.org/grpc"
	ctrl "sigs.k8s.io/controller-runtime"
	"sigs.k8s.io/controller-runtime/pkg/client"

	"github.com/nvidia/osmo/taskgroup/internal/k8s"
	osmolog "github.com/nvidia/osmo/taskgroup/internal/log"
	"github.com/nvidia/osmo/taskgroup/operator"
	operatorpb "github.com/nvidia/osmo/taskgroup/operator/proto"
)

// ControllerVersion is the operator binary version reported back to controllers in
// HelloAck. Overridden at build time with -ldflags='-X main.ControllerVersion=...'.
var ControllerVersion = "dev"

func main() {
	var (
		kubeconfig string
		bind       string
	)
	flag.StringVar(&kubeconfig, "kubeconfig", "", "Path to kubeconfig. Empty = in-cluster.")
	flag.StringVar(&bind, "bind", ":9000", "Address the gRPC server binds to.")
	flag.Parse()

	ctrl.SetLogger(osmolog.New())
	logger := ctrl.Log.WithName("taskgroup-operator")

	cfg, err := k8s.Config(kubeconfig)
	if err != nil {
		fmt.Fprintf(os.Stderr, "loading kubeconfig: %v\n", err)
		os.Exit(1)
	}
	c, err := client.New(cfg, client.Options{Scheme: k8s.Scheme()})
	if err != nil {
		fmt.Fprintf(os.Stderr, "constructing K8s client: %v\n", err)
		os.Exit(1)
	}

	registry := operator.NewSessionRegistry()
	bus := operator.NewStatusBus()
	server := &operator.ClusterSessionServer{
		Client:            c,
		Auth:              &operator.ClusterAuthenticator{Client: c},
		Sessions:          registry,
		Status:            bus,
		ControllerVersion: ControllerVersion,
	}

	listener, err := net.Listen("tcp", bind)
	if err != nil {
		fmt.Fprintf(os.Stderr, "listen %s: %v\n", bind, err)
		os.Exit(1)
	}

	grpcServer := grpc.NewServer()
	operatorpb.RegisterClusterSessionServer(grpcServer, server)

	stopCh := make(chan os.Signal, 1)
	signal.Notify(stopCh, syscall.SIGINT, syscall.SIGTERM)
	go func() {
		<-stopCh
		logger.Info("shutting down")
		grpcServer.GracefulStop()
	}()

	logger.Info("operator service listening", "bind", bind, "version", ControllerVersion)
	if err := grpcServer.Serve(listener); err != nil {
		fmt.Fprintf(os.Stderr, "gRPC server: %v\n", err)
		os.Exit(1)
	}
}
