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
	"time"

	"google.golang.org/grpc"
	"google.golang.org/grpc/health"
	"google.golang.org/grpc/health/grpc_health_v1"
	"google.golang.org/grpc/keepalive"
	"google.golang.org/grpc/reflection"

	"go.corp.nvidia.com/osmo/service/authz_sidecar/server"
	"go.corp.nvidia.com/osmo/utils/logging"
	"go.corp.nvidia.com/osmo/utils/postgres"
	"go.corp.nvidia.com/osmo/utils/roles"
)

const (
	defaultGRPCPort = 50052
	maxGRPCMsgSize  = 4 * 1024 * 1024 // 4MB
)

var (
	grpcPort         = flag.Int("grpc-port", defaultGRPCPort, "gRPC server port")
	enableReflection = flag.Bool("enable-reflection", false,
		"Enable gRPC reflection (for local testing only)")

	// PostgreSQL flags - registered via postgres package
	postgresFlagPtrs = postgres.RegisterPostgresFlags()

	// Cache flags - registered via roles package
	cacheFlagPtrs = roles.RegisterCacheFlags()

	// Logging flags - registered via logging package
	loggingFlagPtrs = logging.RegisterFlags()
)

func main() {
	flag.Parse()

	// Setup structured logging using the OSMO service log format
	loggingConfig := loggingFlagPtrs.ToConfig()
	logger := logging.InitLogger("authz-sidecar", loggingConfig)

	// Create PostgreSQL client
	ctx := context.Background()
	postgresConfig := postgresFlagPtrs.ToPostgresConfig()
	pgClient, err := postgresConfig.CreateClient(logger)
	if err != nil {
		logger.Error("failed to create postgres client", slog.String("error", err.Error()))
		os.Exit(1)
	}
	defer pgClient.Close()

	// Create caches
	cacheConfig := cacheFlagPtrs.ToCacheConfig()
	roleCache := roles.NewRoleCache(cacheConfig.MaxSize, cacheConfig.TTL, logger)
	poolNameCache := roles.NewPoolNameCache(cacheConfig.TTL, logger)

	// Create authorization server
	authzServer := server.NewAuthzServer(pgClient, roleCache, poolNameCache, logger)

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

	if *enableReflection {
		reflection.Register(grpcServer)
		logger.Warn("gRPC reflection enabled (not recommended for production)")
	}

	logger.Info("authz server configured",
		slog.Int("port", *grpcPort),
		slog.String("postgres_host", postgresConfig.Host),
	)

	// Start gRPC server
	lis, err := net.Listen("tcp", fmt.Sprintf("0.0.0.0:%d", *grpcPort))
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
