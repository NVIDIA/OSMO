// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
// http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.
//
// SPDX-License-Identifier: Apache-2.0

package main

import (
	"context"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"google.golang.org/grpc"
	"google.golang.org/grpc/health"
	"google.golang.org/grpc/health/grpc_health_v1"
	"google.golang.org/grpc/keepalive"
	"google.golang.org/grpc/reflection"
	"k8s.io/apimachinery/pkg/runtime"
	utilruntime "k8s.io/apimachinery/pkg/util/runtime"
	clientgoscheme "k8s.io/client-go/kubernetes/scheme"

	taskgroupv1alpha1 "go.corp.nvidia.com/osmo/apis/taskgroup/v1alpha1"
	pb "go.corp.nvidia.com/osmo/proto/operator"
	operatorservice "go.corp.nvidia.com/osmo/service/operator"
	operatorutils "go.corp.nvidia.com/osmo/service/operator/utils"
)

func main() {
	args := operatorutils.OperatorParse()
	logger := slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{
		Level: operatorutils.ParseLogLevel(args.LogLevel),
	}))
	slog.SetDefault(logger)

	host, port, err := operatorutils.ParseHost(args.Host)
	if err != nil {
		logger.Error("failed to parse host", slog.String("error", err.Error()))
		os.Exit(1)
	}

	scheme := runtime.NewScheme()
	utilruntime.Must(clientgoscheme.AddToScheme(scheme))
	utilruntime.Must(taskgroupv1alpha1.AddToScheme(scheme))

	kubernetesClient, err := operatorservice.NewKubernetesClient(args.Kubeconfig, scheme)
	if err != nil {
		logger.Error("failed to create kubernetes client", slog.String("error", err.Error()))
		os.Exit(1)
	}

	operatorServer := operatorservice.NewServer(kubernetesClient)

	grpcServer := grpc.NewServer(
		grpc.KeepaliveParams(keepalive.ServerParameters{
			Time:    60 * time.Second,
			Timeout: 20 * time.Second,
		}),
		grpc.KeepaliveEnforcementPolicy(keepalive.EnforcementPolicy{
			MinTime:             20 * time.Second,
			PermitWithoutStream: true,
		}),
	)
	healthServer := health.NewServer()
	grpc_health_v1.RegisterHealthServer(grpcServer, healthServer)
	healthServer.SetServingStatus("", grpc_health_v1.HealthCheckResponse_SERVING)
	pb.RegisterOperatorServiceServer(
		grpcServer,
		operatorServer,
	)
	if args.EnableReflection {
		reflection.Register(grpcServer)
	}

	address := fmt.Sprintf("%s:%d", host, port)
	listener, err := net.Listen("tcp", address)
	if err != nil {
		logger.Error("failed to listen", slog.String("error", err.Error()))
		os.Exit(1)
	}
	logger.Info("operator service listening", slog.String("address", address))

	httpHost, httpPort, err := operatorutils.ParseHost(args.HTTPHost)
	if err != nil {
		logger.Error("failed to parse http host", slog.String("error", err.Error()))
		os.Exit(1)
	}
	httpAddress := fmt.Sprintf("%s:%d", httpHost, httpPort)
	httpServer := &http.Server{
		Addr:              httpAddress,
		Handler:           operatorservice.NewHTTPHandler(operatorServer),
		ReadHeaderTimeout: 10 * time.Second,
	}
	go func() {
		logger.Info("operator http service listening", slog.String("address", httpAddress))
		if err := httpServer.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			logger.Error("http server error", slog.String("error", err.Error()))
		}
	}()

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	signalChannel := make(chan os.Signal, 1)
	signal.Notify(signalChannel, os.Interrupt, syscall.SIGTERM)
	errorChannel := make(chan error, 1)
	go func() {
		if err := grpcServer.Serve(listener); err != nil {
			errorChannel <- err
		}
	}()

	select {
	case <-signalChannel:
		logger.Info("received shutdown signal")
	case err := <-errorChannel:
		logger.Error("server error", slog.String("error", err.Error()))
	case <-ctx.Done():
		logger.Info("context cancelled")
	}

	done := make(chan struct{})
	go func() {
		grpcServer.GracefulStop()
		shutdownContext, shutdownCancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer shutdownCancel()
		_ = httpServer.Shutdown(shutdownContext)
		close(done)
	}()
	select {
	case <-done:
		logger.Info("server stopped gracefully")
	case <-time.After(10 * time.Second):
		logger.Warn("graceful shutdown timed out, forcing stop")
		grpcServer.Stop()
	}
}
