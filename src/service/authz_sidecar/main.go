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
	defaultGRPCPort       = 50052
	maxGRPCMsgSize        = 4 * 1024 * 1024 // 4MB
	filePollInterval      = 30 * time.Second
)

var (
	grpcPort         = flag.Int("grpc-port", defaultGRPCPort, "gRPC server port")
	enableReflection = flag.Bool("enable-reflection", false,
		"Enable gRPC reflection (for local testing only)")
	rolesFile = flag.String("roles-file", "",
		"Path to ConfigMap-mounted YAML file for roles. "+
			"When set, reads roles from file instead of PostgreSQL (ConfigMap mode).")

	// PostgreSQL flags - registered via postgres package
	postgresFlagPtrs = postgres.RegisterPostgresFlags()

	// Cache flags - registered via roles package
	cacheFlagPtrs = roles.RegisterCacheFlags()

	// Logging flags - registered via logging package
	loggingFlagPtrs = logging.RegisterFlags()
)

func main() {
	flag.Parse()

	loggingConfig := loggingFlagPtrs.ToConfig()
	logger := logging.InitLogger("authz-sidecar", loggingConfig)

	cacheConfig := cacheFlagPtrs.ToCacheConfig()
	roleCache := roles.NewRoleCache(cacheConfig.MaxSize, cacheConfig.TTL, logger)

	var authzServer *server.AuthzServer

	if *rolesFile != "" {
		// ConfigMap mode: read roles from file, no DB needed
		authzServer = initFileBackedServer(*rolesFile, roleCache, cacheConfig, logger)
	} else {
		// DB mode: read roles from PostgreSQL
		authzServer = initDBBackedServer(roleCache, cacheConfig, logger)
	}

	// Migrate roles (no-op in file-backed mode)
	ctx := context.Background()
	if err := authzServer.MigrateRoles(ctx); err != nil {
		logger.Error("failed to migrate roles", slog.String("error", err.Error()))
		os.Exit(1)
	}

	logger.Info("authz server initialized")

	grpcServer := createGRPCServer()
	healthServer := health.NewServer()
	grpc_health_v1.RegisterHealthServer(grpcServer, healthServer)
	healthServer.SetServingStatus("", grpc_health_v1.HealthCheckResponse_SERVING)
	server.RegisterAuthzService(grpcServer, authzServer)

	if *enableReflection {
		reflection.Register(grpcServer)
		logger.Warn("gRPC reflection enabled (not recommended for production)")
	}

	logger.Info("authz server configured", slog.Int("port", *grpcPort))

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

func initFileBackedServer(
	filePath string,
	roleCache *roles.RoleCache,
	cacheConfig roles.CacheConfig,
	logger *slog.Logger,
) *server.AuthzServer {
	fileStore := roles.NewFileRoleStore(filePath, logger)
	if err := fileStore.Load(); err != nil {
		logger.Error("failed to load roles from file",
			slog.String("file", filePath),
			slog.String("error", err.Error()))
		os.Exit(1)
	}
	fileStore.Start(filePollInterval)
	poolNameCache := roles.NewPoolNameCache(cacheConfig.TTL, logger)
	logger.Info("authz sidecar running in ConfigMap mode",
		slog.String("roles_file", filePath))
	return server.NewFileBackedAuthzServer(fileStore, roleCache, poolNameCache, logger)
}

func initDBBackedServer(
	roleCache *roles.RoleCache,
	cacheConfig roles.CacheConfig,
	logger *slog.Logger,
) *server.AuthzServer {
	postgresConfig := postgresFlagPtrs.ToPostgresConfig()
	pgClient, err := postgresConfig.CreateClient(logger)
	if err != nil {
		logger.Error("failed to create postgres client",
			slog.String("error", err.Error()))
		os.Exit(1)
	}
	// Note: pgClient.Close() is not deferred here because the server
	// runs until process exit. The OS reclaims resources.
	poolNameCache := roles.NewPoolNameCache(cacheConfig.TTL, logger)
	logger.Info("authz sidecar running in DB mode",
		slog.String("postgres_host", postgresConfig.Host))
	return server.NewAuthzServer(pgClient, roleCache, poolNameCache, logger)
}

func createGRPCServer() *grpc.Server {
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
	return grpc.NewServer(opts...)
}
