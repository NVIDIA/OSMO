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

package main

import (
	"context"
	"flag"
	"fmt"
	"log/slog"
	"net"
	"os"
	"strings"
	"time"

	"google.golang.org/grpc"
	"google.golang.org/grpc/health"
	"google.golang.org/grpc/health/grpc_health_v1"
	"google.golang.org/grpc/keepalive"

	"go.corp.nvidia.com/osmo/service/authz_sidecar/server"
	"go.corp.nvidia.com/osmo/utils/postgres"
	"go.corp.nvidia.com/osmo/utils/roles"
)

const (
	defaultGRPCPort  = 50052
	defaultCacheSize = 1000
	maxGRPCMsgSize   = 4 * 1024 * 1024 // 4MB
)

var (
	grpcPort = flag.Int("grpc-port", defaultGRPCPort, "gRPC server port")

	// PostgreSQL flags - registered via postgres package
	postgresFlagPtrs = postgres.RegisterPostgresFlags()

	// Logging flags
	logLevel = flag.String("log-level", "info", "Log level (debug, info, warn, error)")
)

func parseLogLevel(level string) slog.Level {
	switch strings.ToLower(level) {
	case "debug":
		return slog.LevelDebug
	case "info":
		return slog.LevelInfo
	case "warn", "warning":
		return slog.LevelWarn
	case "error":
		return slog.LevelError
	default:
		return slog.LevelInfo
	}
}

func main() {
	flag.Parse()

	// Setup structured logging
	logger := slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{
		Level: parseLogLevel(*logLevel),
	}))
	slog.SetDefault(logger)

	// Create PostgreSQL client
	ctx := context.Background()
	postgresConfig := postgresFlagPtrs.ToPostgresConfig()
	pgClient, err := postgresConfig.CreateClient(logger)
	if err != nil {
		logger.Error("failed to create postgres client", slog.String("error", err.Error()))
		os.Exit(1)
	}
	defer pgClient.Close()

	// Create role cache
	roleCache := roles.NewRoleCache(defaultCacheSize, logger)

	// Create authorization server
	authzServer := server.NewAuthzServer(pgClient, roleCache, logger)

	// Migrate all roles to semantic format in the database
	if err := authzServer.MigrateRoles(ctx); err != nil {
		logger.Error("failed to migrate roles", slog.String("error", err.Error()))
		os.Exit(1)
	}

	logger.Info("authz server initialized")

	// Create gRPC server options
	opts := []grpc.ServerOption{
		grpc.KeepaliveParams(keepalive.ServerParameters{
			Time:    60 * time.Second,
			Timeout: 20 * time.Second,
		}),
		grpc.KeepaliveEnforcementPolicy(keepalive.EnforcementPolicy{
			MinTime:             30 * time.Second,
			PermitWithoutStream: true,
		}),
		grpc.MaxRecvMsgSize(maxGRPCMsgSize),
		grpc.MaxSendMsgSize(maxGRPCMsgSize),
	}

	grpcServer := grpc.NewServer(opts...)

	// Register health service
	healthServer := health.NewServer()
	grpc_health_v1.RegisterHealthServer(grpcServer, healthServer)
	healthServer.SetServingStatus("", grpc_health_v1.HealthCheckResponse_SERVING)

	// Register authorization service
	server.RegisterAuthzService(grpcServer, authzServer)

	logger.Info("authz server configured",
		slog.Int("port", *grpcPort),
		slog.String("postgres_host", postgresConfig.Host),
	)

	// Start gRPC server
	lis, err := net.Listen("tcp", fmt.Sprintf(":%d", *grpcPort))
	if err != nil {
		logger.Error("failed to listen", slog.String("error", err.Error()))
		os.Exit(1)
	}

	logger.Info("authz server listening", slog.Int("port", *grpcPort))
	if err := grpcServer.Serve(lis); err != nil {
		logger.Error("server failed", slog.String("error", err.Error()))
		os.Exit(1)
	}
}
