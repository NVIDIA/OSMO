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
)

const (
	defaultGRPCPort  = 50052
	defaultCacheTTL  = 5 * time.Minute
	defaultCacheSize = 1000
	maxGRPCMsgSize   = 4 * 1024 * 1024 // 4MB
)

var (
	grpcPort = flag.Int("grpc-port", defaultGRPCPort, "gRPC server port")

	// PostgreSQL flags
	postgresHost            = flag.String("postgres-host", "postgres", "PostgreSQL host")
	postgresPort            = flag.Int("postgres-port", 5432, "PostgreSQL port")
	postgresDB              = flag.String("postgres-db", "osmo", "PostgreSQL database name")
	postgresUser            = flag.String("postgres-user", "postgres", "PostgreSQL user")
	postgresPassword        = flag.String("postgres-password", "", "PostgreSQL password")
	postgresMaxConns        = flag.Int("postgres-max-conns", 10, "Max connections in pool")
	postgresMinConns        = flag.Int("postgres-min-conns", 5, "Min connections in pool")
	postgresMaxConnLifetime = flag.Duration("postgres-max-conn-lifetime", 5*time.Minute, "Connection max lifetime")
	postgresSSLMode         = flag.String("postgres-sslmode", "disable", "PostgreSQL SSL mode")

	// Cache flags
	cacheEnabled = flag.Bool("cache-enabled", true, "Enable role caching")
	cacheTTL     = flag.Duration("cache-ttl", defaultCacheTTL, "Cache TTL for roles")
	cacheMaxSize = flag.Int("cache-max-size", defaultCacheSize, "Maximum cache size")

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
	pgClient, err := postgres.CreatePostgresClient(
		ctx,
		logger,
		*postgresHost,
		*postgresPort,
		*postgresDB,
		*postgresUser,
		*postgresPassword,
		int32(*postgresMaxConns),
		int32(*postgresMinConns),
		*postgresMaxConnLifetime,
		*postgresSSLMode,
	)
	if err != nil {
		logger.Error("failed to create postgres client", slog.String("error", err.Error()))
		os.Exit(1)
	}
	defer pgClient.Close()

	// Create authorization server
	cacheConfig := server.RoleCacheConfig{
		Enabled: *cacheEnabled,
		TTL:     *cacheTTL,
		MaxSize: *cacheMaxSize,
	}
	roleCache := server.NewRoleCache(cacheConfig, logger)

	logger.Info("role cache initialized",
		slog.Bool("enabled", *cacheEnabled),
		slog.Duration("ttl", *cacheTTL),
		slog.Int("max_size", *cacheMaxSize),
	)

	// Create role fetcher using the postgres client
	roleFetcher := func(ctx context.Context, roleNames []string) ([]*postgres.Role, error) {
		return postgres.GetRoles(ctx, pgClient, roleNames)
	}

	authzServer := server.NewAuthzServer(pgClient, roleFetcher, roleCache, logger)

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
		slog.String("postgres_host", *postgresHost),
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
