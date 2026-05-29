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
	"sigs.k8s.io/controller-runtime/pkg/cache"
	"sigs.k8s.io/controller-runtime/pkg/client"

	v1alpha1 "github.com/nvidia/osmo/taskgroup/api/v1alpha1"
	"github.com/nvidia/osmo/taskgroup/apiserver"
	"github.com/nvidia/osmo/taskgroup/internal/k8s"
	osmolog "github.com/nvidia/osmo/taskgroup/internal/log"
)

func main() {
	var (
		bind      string
		namespace string
		qps       float64
		burst     int
	)
	// --kubeconfig is registered by controller-runtime's pkg/client/config; we just
	// consume it via ctrl.GetConfigOrDie() below. In-cluster auth is the default.
	flag.StringVar(&bind, "bind", ":8088", "HTTP bind address.")
	flag.StringVar(&namespace, "workflow-namespace", "osmo-workflows", "K8s namespace where OSMOWorkflow CRs live.")
	flag.Float64Var(&qps, "k8s-qps", 50, "Sustained QPS limit for outbound K8s API calls. client-go default is 5, which is far too low for an apiserver.")
	flag.IntVar(&burst, "k8s-burst", 100, "Burst limit for outbound K8s API calls. client-go default is 10.")
	flag.Parse()

	ctrl.SetLogger(osmolog.New())
	logger := ctrl.Log.WithName("taskgroup-apiserver")

	cfg := ctrl.GetConfigOrDie()
	cfg.QPS = float32(qps)
	cfg.Burst = burst

	ctx, cancel := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer cancel()

	// Read path: an informer-backed cache. GET /v1/workflows{,/name} reads from
	// memory; the cache is kept current by a watch on OSMOWorkflow.
	readCache, err := cache.New(cfg, cache.Options{
		Scheme: k8s.Scheme(),
		DefaultNamespaces: map[string]cache.Config{
			namespace: {},
		},
	})
	if err != nil {
		logger.Error(err, "constructing read cache")
		os.Exit(1)
	}
	go func() {
		if err := readCache.Start(ctx); err != nil {
			logger.Error(err, "cache exited")
		}
	}()
	// Pre-warm the OSMOWorkflow informer. cache.New is lazy: WaitForCacheSync below
	// returns immediately when no informer exists, so without this call the first
	// GET would block on the initial list right when traffic arrives.
	if _, err := readCache.GetInformer(ctx, &v1alpha1.OSMOWorkflow{}); err != nil {
		logger.Error(err, "registering OSMOWorkflow informer")
		os.Exit(1)
	}
	if !readCache.WaitForCacheSync(ctx) {
		logger.Error(fmt.Errorf("cache did not sync"), "aborting startup")
		os.Exit(1)
	}

	// Delegating client: reads from cache, writes go straight to the K8s API. Status
	// subresource writes also go direct.
	c, err := client.New(cfg, client.Options{
		Scheme: k8s.Scheme(),
		Cache: &client.CacheOptions{
			Reader: readCache,
		},
	})
	if err != nil {
		logger.Error(err, "constructing delegating client")
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

	go func() {
		<-ctx.Done()
		shutdownCtx, scancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer scancel()
		_ = httpServer.Shutdown(shutdownCtx)
	}()

	logger.Info("api server listening",
		"bind", bind,
		"namespace", namespace,
		"k8s_qps", qps,
		"k8s_burst", burst,
	)
	if err := httpServer.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
