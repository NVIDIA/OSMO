/*
SPDX-FileCopyrightText: Copyright (c) 2025 NVIDIA CORPORATION. All rights reserved.

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
	"net/url"
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
)

var (
	host          = flag.String("host", "http://0.0.0.0:8001", "Host for the operator service")
	logLevel      = flag.String("log-level", "INFO", "Logging level (DEBUG, INFO, WARN, ERROR)")
	redisHost     = flag.String("redis-host", "localhost", "Redis host")
	redisPort     = flag.Int("redis-port", 6379, "Redis port")
	redisPassword = flag.String("redis-password", "", "Redis password")
	redisDB       = flag.Int("redis-db", 0, "Redis database number")
)

// Extracts host and port from a URL string or host:port format
func ParseHost(hostStr string) (string, int, error) {
	if parsedURL, err := url.Parse(hostStr); err == nil && parsedURL.Scheme != "" {
		host := parsedURL.Hostname()
		if host == "" {
			host = "0.0.0.0"
		}

		if parsedURL.Port() == "" {
			return "", 0, fmt.Errorf("port is required in URL: %s", hostStr)
		}

		var port int
		_, err := fmt.Sscanf(parsedURL.Port(), "%d", &port)
		if err != nil {
			return "", 0, fmt.Errorf("invalid port in URL: %s", parsedURL.Port())
		}
		return host, port, nil
	}

	return "", 0, fmt.Errorf(
		"invalid host format, expected URL format (e.g., http://0.0.0.0:8000): %s", hostStr)
}

// ParseLogLevel converts a string log level to slog.Level
func ParseLogLevel(levelStr string) slog.Level {
	var level slog.Level
	if err := level.UnmarshalText([]byte(levelStr)); err != nil {
		return slog.LevelInfo // default to INFO on error
	}
	return level
}

func main() {
	flag.Parse()

	// Setup structured logging
	level := ParseLogLevel(*logLevel)
	logger := slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{
		Level: level,
	}))
	slog.SetDefault(logger)

	// Parse host and port
	host, port, err := ParseHost(*host)
	if err != nil {
		logger.Error("Failed to parse host", slog.String("error", err.Error()))
		os.Exit(1)
	}

	// Initialize Redis client
	redisClient := redis.NewClient(&redis.Options{
		Addr:     fmt.Sprintf("%s:%d", *redisHost, *redisPort),
		Password: *redisPassword,
		DB:       *redisDB,
	})
	logger.Info("Redis client configured",
		slog.String("address", fmt.Sprintf("%s:%d", *redisHost, *redisPort)),
		slog.Int("db", *redisDB))
	defer redisClient.Close()

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

	// Register operator services with Redis client
	listenerService := listener_service.NewListenerService(logger, redisClient)
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
