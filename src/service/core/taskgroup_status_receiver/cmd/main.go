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
	"flag"
	"fmt"
	"log/slog"
	"net"
	"net/url"
	"os"
	"os/signal"
	"strconv"
	"strings"
	"syscall"
	"time"

	"google.golang.org/grpc"
	"google.golang.org/grpc/health"
	"google.golang.org/grpc/health/grpc_health_v1"
	"google.golang.org/grpc/keepalive"
	"google.golang.org/grpc/reflection"

	pb "go.corp.nvidia.com/osmo/proto/operator"
	taskgroupstatusreceiver "go.corp.nvidia.com/osmo/service/core/taskgroup_status_receiver"
)

var (
	host             = flag.String("host", "http://0.0.0.0:8003", "gRPC listen host")
	apiEndpoint      = flag.String("api-endpoint", "http://osmo-service/api/internal/taskgroup/status", "API server taskgroup status endpoint")
	logLevel         = flag.String("log-level", "INFO", "log level")
	enableReflection = flag.Bool("enable-reflection", false, "enable gRPC reflection")
)

func main() {
	flag.Parse()
	logger := slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{
		Level: parseLogLevel(*logLevel),
	}))
	slog.SetDefault(logger)

	listenHost, listenPort, err := parseHost(*host)
	if err != nil {
		logger.Error("failed to parse host", slog.String("error", err.Error()))
		os.Exit(1)
	}
	address := fmt.Sprintf("%s:%d", listenHost, listenPort)
	listener, err := net.Listen("tcp", address)
	if err != nil {
		logger.Error("failed to listen", slog.String("error", err.Error()))
		os.Exit(1)
	}

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
	statusServer := taskgroupstatusreceiver.NewServer(*apiEndpoint, nil)
	pb.RegisterTaskGroupStatusServiceServer(grpcServer, statusServer)
	healthServer := health.NewServer()
	grpc_health_v1.RegisterHealthServer(grpcServer, healthServer)
	healthServer.SetServingStatus("", grpc_health_v1.HealthCheckResponse_SERVING)
	if *enableReflection {
		reflection.Register(grpcServer)
	}

	logger.Info("taskgroup status receiver listening",
		slog.String("address", address),
		slog.String("api_endpoint", *apiEndpoint))

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

func parseHost(rawHost string) (string, int, error) {
	hostURL := rawHost
	if !strings.Contains(hostURL, "://") {
		hostURL = "http://" + hostURL
	}
	parsed, err := url.Parse(hostURL)
	if err != nil {
		return "", 0, err
	}
	port, err := strconv.Atoi(parsed.Port())
	if err != nil {
		return "", 0, fmt.Errorf("host must include numeric port: %w", err)
	}
	return parsed.Hostname(), port, nil
}

func parseLogLevel(level string) slog.Level {
	switch strings.ToUpper(level) {
	case "DEBUG":
		return slog.LevelDebug
	case "WARN", "WARNING":
		return slog.LevelWarn
	case "ERROR":
		return slog.LevelError
	default:
		return slog.LevelInfo
	}
}
