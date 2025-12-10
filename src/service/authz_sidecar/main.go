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
	"go.corp.nvidia.com/osmo/service/utils_go"
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
	postgresMaxOpenConns    = flag.Int("postgres-max-open-conns", 10, "Max open connections")
	postgresMaxIdleConns    = flag.Int("postgres-max-idle-conns", 5, "Max idle connections")
	postgresConnMaxLifetime = flag.Duration("postgres-conn-max-lifetime", 5*time.Minute, "Connection max lifetime")
	postgresSSLMode         = flag.String("postgres-sslmode", "disable", "PostgreSQL SSL mode")

	// Cache flags
	cacheEnabled = flag.Bool("cache-enabled", true, "Enable role caching")
	cacheTTL     = flag.Duration("cache-ttl", defaultCacheTTL, "Cache TTL for roles")
	cacheMaxSize = flag.Int("cache-max-size", defaultCacheSize, "Maximum cache size")
)

func main() {
	flag.Parse()

	// Setup structured logging
	logger := slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{
		Level: slog.LevelInfo,
	}))
	slog.SetDefault(logger)

	// Create PostgreSQL client
	pgConfig := utils_go.PostgresConfig{
		Host:            *postgresHost,
		Port:            *postgresPort,
		Database:        *postgresDB,
		User:            *postgresUser,
		Password:        *postgresPassword,
		MaxOpenConns:    *postgresMaxOpenConns,
		MaxIdleConns:    *postgresMaxIdleConns,
		ConnMaxLifetime: *postgresConnMaxLifetime,
		SSLMode:         *postgresSSLMode,
	}

	pgClient, err := utils_go.NewPostgresClient(pgConfig, logger)
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

	// Create role cache
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

	// Create authorization server
	authzServer := server.NewAuthzServer(pgClient, roleCache, logger)

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
	server.RegisterAuthzService(grpcServer, authzServer)

	logger.Info("authz server configured",
		slog.Int("port", *grpcPort),
		slog.String("postgres_host", *postgresHost),
		slog.Bool("cache_enabled", *cacheEnabled),
		slog.Duration("cache_ttl", *cacheTTL),
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
