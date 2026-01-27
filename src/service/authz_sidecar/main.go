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
	"sync"
	"time"

	"google.golang.org/grpc"
	"google.golang.org/grpc/health"
	"google.golang.org/grpc/health/grpc_health_v1"
	"google.golang.org/grpc/keepalive"

	"go.corp.nvidia.com/osmo/service/authz_sidecar/server"
	"go.corp.nvidia.com/osmo/utils/postgres"
	"go.corp.nvidia.com/osmo/utils/roles"
)

// RoleStore holds all roles converted to semantic format at startup
type RoleStore struct {
	mu    sync.RWMutex
	roles map[string]*roles.Role
}

// NewRoleStore creates a new role store
func NewRoleStore() *RoleStore {
	return &RoleStore{
		roles: make(map[string]*roles.Role),
	}
}

// LoadAndConvertRoles loads all roles from the database and converts them to semantic format
func (rs *RoleStore) LoadAndConvertRoles(ctx context.Context, pgClient *postgres.PostgresClient, logger *slog.Logger) error {
	// Get all role names from the database
	allRoleNames, err := roles.GetAllRoleNames(ctx, pgClient)
	if err != nil {
		return fmt.Errorf("failed to get all role names: %w", err)
	}

	if len(allRoleNames) == 0 {
		logger.Warn("no roles found in database")
		return nil
	}

	// Fetch all roles
	allRoles, err := roles.GetRoles(ctx, pgClient, allRoleNames, logger)
	if err != nil {
		return fmt.Errorf("failed to get roles: %w", err)
	}

	// Convert all roles to semantic format
	convertedRoles := roles.ConvertRolesToSemantic(allRoles)

	// Store converted roles
	rs.mu.Lock()
	defer rs.mu.Unlock()
	for _, role := range convertedRoles {
		rs.roles[role.Name] = role
	}

	logger.Info("loaded and converted roles",
		slog.Int("total_roles", len(convertedRoles)),
	)

	return nil
}

// Get retrieves roles by name from the store
func (rs *RoleStore) Get(roleNames []string) []*roles.Role {
	rs.mu.RLock()
	defer rs.mu.RUnlock()

	var result []*roles.Role
	for _, name := range roleNames {
		if role, exists := rs.roles[name]; exists {
			result = append(result, role)
		}
	}
	return result
}

const (
	defaultGRPCPort  = 50052
	defaultCacheTTL  = 5 * time.Minute
	defaultCacheSize = 1000
	maxGRPCMsgSize   = 4 * 1024 * 1024 // 4MB
)

var (
	grpcPort = flag.Int("grpc-port", defaultGRPCPort, "gRPC server port")

	// PostgreSQL flags - registered via postgres package
	postgresFlagPtrs = postgres.RegisterPostgresFlags()

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
	postgresConfig := postgresFlagPtrs.ToPostgresConfig()
	pgClient, err := postgresConfig.CreateClient(logger)
	if err != nil {
		logger.Error("failed to create postgres client", slog.String("error", err.Error()))
		os.Exit(1)
	}
	defer pgClient.Close()

	// Create authorization server
	cacheConfig := roles.RoleCacheConfig{
		Enabled: *cacheEnabled,
		TTL:     *cacheTTL,
		MaxSize: *cacheMaxSize,
	}
	roleCache := roles.NewRoleCache(cacheConfig, logger)

	logger.Info("role cache initialized",
		slog.Bool("enabled", *cacheEnabled),
		slog.Duration("ttl", *cacheTTL),
		slog.Int("max_size", *cacheMaxSize),
	)

	// Load and convert all roles at startup
	roleStore := NewRoleStore()
	if err := roleStore.LoadAndConvertRoles(ctx, pgClient, logger); err != nil {
		logger.Error("failed to load and convert roles", slog.String("error", err.Error()))
		os.Exit(1)
	}

	// Create role fetcher that uses the pre-converted role store
	// Roles are already converted to semantic format at startup
	roleFetcher := func(ctx context.Context, roleNames []string) ([]*roles.Role, error) {
		return roleStore.Get(roleNames), nil
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
