/*
SPDX-FileCopyrightText: Copyright (c) 2025 NVIDIA CORPORATION & AFFILIATES. All rights reserved.

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

	"go.corp.nvidia.com/osmo/service/authz_sidecar/server"
	"go.corp.nvidia.com/osmo/service/utils_go/postgres"
)

const (
	defaultGRPCPort  = 50052
	defaultCacheTTL  = 5 * time.Minute
	defaultCacheSize = 1000
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

	// Casbin flags
	casbinEnabled            = flag.Bool("casbin-enabled", false, "Enable Casbin-based authorization (default: legacy)")
	casbinPolicyReloadPeriod = flag.Duration("casbin-policy-reload-period", 5*time.Minute, "Casbin policy reload interval")
)

func main() {
	flag.Parse()

	// Setup structured logging
	logger := slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{
		Level: slog.LevelInfo,
	}))
	slog.SetDefault(logger)

	// Create PostgreSQL client
	pgConfig := postgres.PostgresConfig{
		Host:            *postgresHost,
		Port:            *postgresPort,
		Database:        *postgresDB,
		User:            *postgresUser,
		Password:        *postgresPassword,
		MaxConns:        int32(*postgresMaxConns),
		MinConns:        int32(*postgresMinConns),
		MaxConnLifetime: *postgresMaxConnLifetime,
		SSLMode:         *postgresSSLMode,
	}

	ctx := context.Background()
	pgClient, err := postgres.NewPostgresClient(ctx, pgConfig, logger)
	if err != nil {
		logger.Error("failed to create postgres client", slog.String("error", err.Error()))
		os.Exit(1)
	}
	defer pgClient.Close()

	logger.Info("postgres client initialized",
		slog.String("host", *postgresHost),
		slog.Int("port", *postgresPort),
		slog.String("database", *postgresDB),
	)

	// Create authorization server based on configuration
	var authzServer server.AuthzServerInterface

	if *casbinEnabled {
		// Use Casbin-based authorization
		// Build connection string for Casbin adapter (uses pgx/v4 format)
		connStr := fmt.Sprintf("host=%s port=%d user=%s password=%s dbname=%s sslmode=%s",
			*postgresHost, *postgresPort, *postgresUser, *postgresPassword, *postgresDB, *postgresSSLMode)

		casbinConfig := server.CasbinConfig{
			PolicyReloadInterval: *casbinPolicyReloadPeriod,
			ConnectionString:     connStr,
		}

		casbinServer, err := server.NewCasbinAuthzServer(ctx, pgClient.Pool(), casbinConfig, logger)
		if err != nil {
			logger.Error("failed to create casbin authz server", slog.String("error", err.Error()))
			os.Exit(1)
		}

		authzServer = casbinServer

		logger.Info("casbin authz server initialized",
			slog.Duration("policy_reload_period", *casbinPolicyReloadPeriod),
		)
	} else {
		// Use legacy authorization
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

		authzServer = server.NewAuthzServer(pgClient, roleCache, logger)

		logger.Info("legacy authz server initialized")
	}

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
		grpc.MaxRecvMsgSize(4 * 1024 * 1024), // 4MB
		grpc.MaxSendMsgSize(4 * 1024 * 1024), // 4MB
	}

	grpcServer := grpc.NewServer(opts...)

	// Register health service
	healthServer := health.NewServer()
	grpc_health_v1.RegisterHealthServer(grpcServer, healthServer)
	healthServer.SetServingStatus("", grpc_health_v1.HealthCheckResponse_SERVING)

	// Register authorization service
	server.RegisterAuthzServiceWithServer(grpcServer, authzServer)

	logger.Info("authz server configured",
		slog.Int("port", *grpcPort),
		slog.String("postgres_host", *postgresHost),
		slog.Bool("casbin_enabled", *casbinEnabled),
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
