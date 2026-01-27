/*
SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION. All rights reserved.

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
	"crypto/tls"
	"fmt"
	"log/slog"
	"net"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/redis/go-redis/v9"
	"google.golang.org/grpc"
	"google.golang.org/grpc/health"
	"google.golang.org/grpc/health/grpc_health_v1"
	"google.golang.org/grpc/keepalive"

	"go.corp.nvidia.com/osmo/service/operator/listener_service"
	"go.corp.nvidia.com/osmo/service/operator/utils"
)

// ParseLogLevel converts a string log level to slog.Level
func ParseLogLevel(levelStr string) slog.Level {
	var level slog.Level
	if err := level.UnmarshalText([]byte(levelStr)); err != nil {
		return slog.LevelInfo // default to INFO on error
	}
	return level
}

func main() {
	// Parse command line arguments and environment variables
	args := utils.OperatorParse()

	// Setup structured logging
	level := ParseLogLevel(args.LogLevel)
	logger := slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{
		Level: level,
	}))
	slog.SetDefault(logger)

	// Parse host and port
	host, port, err := utils.ParseHost(args.Host)
	if err != nil {
		logger.Error("Failed to parse host", slog.String("error", err.Error()))
		os.Exit(1)
	}

	// Initialize Redis client
	redisOptions := &redis.Options{
		Addr:     fmt.Sprintf("%s:%d", args.RedisHost, args.RedisPort),
		Password: args.RedisPassword,
		DB:       args.RedisDB,
	}

	// Enable TLS if configured
	if args.RedisTLSEnabled {
		redisOptions.TLSConfig = &tls.Config{
			MinVersion: tls.VersionTLS12,
		}
	}

	redisClient := redis.NewClient(redisOptions)
	logger.Info("Redis client configured",
		slog.String("address", fmt.Sprintf("%s:%d", args.RedisHost, args.RedisPort)),
		slog.Int("db", args.RedisDB),
		slog.Bool("tls", args.RedisTLSEnabled))
	defer redisClient.Close()

	// Initialize PostgreSQL client
	pgClient, err := args.Postgres.CreateClient(logger)
	if err != nil {
		logger.Error("Failed to create PostgreSQL client",
			slog.String("error", err.Error()))
		os.Exit(1)
	}
	defer pgClient.Close()

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
	}

	grpcServer := grpc.NewServer(opts...)

	// Register health service
	healthServer := health.NewServer()
	grpc_health_v1.RegisterHealthServer(grpcServer, healthServer)
	healthServer.SetServingStatus("", grpc_health_v1.HealthCheckResponse_SERVING)

	// Register operator services with Redis client and PostgreSQL pool
	listenerService := listener_service.NewListenerService(logger, redisClient, pgClient.Pool(), &args)
	listener_service.RegisterServices(grpcServer, listenerService)

	// Start gRPC server
	addr := fmt.Sprintf("%s:%d", host, port)
	lis, err := net.Listen("tcp", addr)
	if err != nil {
		logger.Error("failed to listen", slog.String("error", err.Error()))
		os.Exit(1)
	}

	logger.Info("operator server listening", slog.String("address", addr))

	// Setup graceful shutdown
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	// Channel to listen for interrupt or terminate signals
	sigChan := make(chan os.Signal, 1)
	signal.Notify(sigChan, os.Interrupt, syscall.SIGTERM)

	// Channel to signal server error
	errChan := make(chan error, 1)

	// Start server in goroutine
	go func() {
		if err := grpcServer.Serve(lis); err != nil {
			errChan <- err
		}
	}()

	// Wait for shutdown signal or error
	select {
	case <-sigChan:
		logger.Info("received shutdown signal")
	case err := <-errChan:
		logger.Error("server error", slog.String("error", err.Error()))
	case <-ctx.Done():
		logger.Info("context cancelled")
	}

	// Graceful shutdown with timeout
	logger.Info("initiating graceful shutdown...")

	// Use a goroutine with timeout to prevent indefinite blocking
	done := make(chan struct{})
	go func() {
		grpcServer.GracefulStop()
		close(done)
	}()

	// Wait for graceful shutdown with timeout
	select {
	case <-done:
		logger.Info("server stopped gracefully")
	case <-time.After(10 * time.Second):
		logger.Warn("graceful shutdown timed out, forcing stop")
		grpcServer.Stop()
	}
}
