// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

// Command apiserver runs the stateless HTTP API server. It holds no database connection.
// All persistent state is in the control cluster's K8s API as OSMOWorkflow CRs.
package main

import (
	"context"
	"flag"
	"fmt"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	ctrl "sigs.k8s.io/controller-runtime"
	"sigs.k8s.io/controller-runtime/pkg/client"

	"github.com/nvidia/osmo/taskgroup/apiserver"
	"github.com/nvidia/osmo/taskgroup/internal/k8s"
	osmolog "github.com/nvidia/osmo/taskgroup/internal/log"
)

func main() {
	var (
		kubeconfig string
		bind       string
		namespace  string
	)
	flag.StringVar(&kubeconfig, "kubeconfig", "", "Path to kubeconfig. Empty = in-cluster.")
	flag.StringVar(&bind, "bind", ":8088", "HTTP bind address.")
	flag.StringVar(&namespace, "workflow-namespace", "osmo-workflows", "K8s namespace where OSMOWorkflow CRs live.")
	flag.Parse()

	ctrl.SetLogger(osmolog.New())
	logger := ctrl.Log.WithName("taskgroup-apiserver")

	cfg, err := k8s.Config(kubeconfig)
	if err != nil {
		logger.Error(err, "loading kubeconfig")
		os.Exit(1)
	}
	c, err := client.New(cfg, client.Options{Scheme: k8s.Scheme()})
	if err != nil {
		logger.Error(err, "constructing K8s client")
		os.Exit(1)
	}

	srv := &apiserver.Server{
		Client:    c,
		Namespace: namespace,
		// Phase 1 uses a development-only static-token authenticator. Swap with a real
		// IDP integration before going past dev/CI.
		Auth: apiserver.StaticTokenAuth{},
	}

	mux := http.NewServeMux()
	srv.Register(mux)

	httpServer := &http.Server{
		Addr:              bind,
		Handler:           mux,
		ReadHeaderTimeout: 5 * time.Second,
	}

	// Graceful shutdown wiring.
	ctx, cancel := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer cancel()
	go func() {
		<-ctx.Done()
		shutdownCtx, scancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer scancel()
		_ = httpServer.Shutdown(shutdownCtx)
	}()

	logger.Info("api server listening", "bind", bind, "namespace", namespace)
	if err := httpServer.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
