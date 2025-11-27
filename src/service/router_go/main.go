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
	"google.golang.org/grpc/credentials"
	"google.golang.org/grpc/health"
	"google.golang.org/grpc/health/grpc_health_v1"
	"google.golang.org/grpc/keepalive"

	"go.corp.nvidia.com/osmo/service/router_go/server"
)

const (
	defaultRendezvousTimeout   = 60 * time.Second
	defaultStreamSendTimeout   = 30 * time.Second
	defaultMaxConcurrentStream = 1000
	defaultMaxMessageSize      = 4 * 1024 * 1024 // 4MB
	defaultMaxSessionKeyLen    = 256
	defaultMaxWorkflowIDLen    = 256
)

var (
	port                 = flag.Int("port", 50051, "gRPC server port")
	tlsCert              = flag.String("tls-cert", "/etc/router/tls/tls.crt", "TLS certificate file")
	tlsKey               = flag.String("tls-key", "/etc/router/tls/tls.key", "TLS key file")
	tlsEnabled           = flag.Bool("tls-enabled", true, "Enable TLS")
	rendezvousTimeout    = flag.Duration("rendezvous-timeout", defaultRendezvousTimeout, "Rendezvous wait timeout")
	streamSendTimeout    = flag.Duration("stream-send-timeout", defaultStreamSendTimeout, "Maximum time to block when forwarding data to the peer")
	maxConcurrentStreams = flag.Int("max-concurrent-streams", defaultMaxConcurrentStream, "Maximum concurrent gRPC streams per connection")
	maxMessageSize       = flag.Int("max-message-size", defaultMaxMessageSize, "Maximum message size in bytes (default 4MB)")
	maxSessionKeyLen     = flag.Int("max-session-key-len", defaultMaxSessionKeyLen, "Maximum session key length")
	maxWorkflowIDLen     = flag.Int("max-workflow-id-len", defaultMaxWorkflowIDLen, "Maximum workflow ID length")
)

func main() {
	flag.Parse()

	// Setup structured logging
	logger := slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{
		Level: slog.LevelInfo,
	}))
	slog.SetDefault(logger)

	// Validate flags
	if *rendezvousTimeout <= 0 {
		logger.Error("invalid flag", slog.String("flag", "rendezvous-timeout"), slog.Duration("value", *rendezvousTimeout))
		os.Exit(1)
	}
	if *streamSendTimeout <= 0 {
		logger.Error("invalid flag", slog.String("flag", "stream-send-timeout"), slog.Duration("value", *streamSendTimeout))
		os.Exit(1)
	}
	if *maxSessionKeyLen <= 0 {
		logger.Error("invalid flag", slog.String("flag", "max-session-key-len"), slog.Int("value", *maxSessionKeyLen))
		os.Exit(1)
	}
	if *maxWorkflowIDLen <= 0 {
		logger.Error("invalid flag", slog.String("flag", "max-workflow-id-len"), slog.Int("value", *maxWorkflowIDLen))
		os.Exit(1)
	}

	// Create session store
	store := server.NewSessionStore(server.SessionStoreConfig{
		RendezvousTimeout: *rendezvousTimeout,
		StreamSendTimeout: *streamSendTimeout,
		MaxSessionKeyLen:  *maxSessionKeyLen,
		MaxWorkflowIDLen:  *maxWorkflowIDLen,
	}, logger)

	// Session cleanup is handled by:
	// 1. defer ReleaseSession() when handlers return (primary, 99.9% of cases)
	// 2. gRPC keepalive for dead connection detection (80 seconds)
	// No background cleanup needed - sessions can run indefinitely

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
		grpc.MaxConcurrentStreams(uint32(*maxConcurrentStreams)),
		grpc.MaxRecvMsgSize(*maxMessageSize),
		grpc.MaxSendMsgSize(*maxMessageSize),
	}

	// Add TLS if enabled
	if *tlsEnabled {
		creds, err := credentials.NewServerTLSFromFile(*tlsCert, *tlsKey)
		if err != nil {
			logger.Error("failed to load TLS credentials", slog.String("error", err.Error()))
			os.Exit(1)
		}
		opts = append(opts, grpc.Creds(creds))
		logger.Info("TLS enabled", slog.String("cert", *tlsCert))
	} else {
		logger.Warn("running without TLS (insecure)")
	}

	// Create gRPC server
	grpcServer := grpc.NewServer(opts...)

	// Register health service for Kubernetes probes
	healthServer := health.NewServer()
	grpc_health_v1.RegisterHealthServer(grpcServer, healthServer)
	healthServer.SetServingStatus("", grpc_health_v1.HealthCheckResponse_SERVING)

	// Register router services
	routerServer := server.NewRouterServer(store, logger)
	server.RegisterRouterServices(grpcServer, routerServer)

	logger.Info("router server configured",
		slog.Int("port", *port),
		slog.Bool("tls", *tlsEnabled),
		slog.Duration("rendezvous_timeout", *rendezvousTimeout),
		slog.Duration("stream_send_timeout", *streamSendTimeout),
		slog.Uint64("max_concurrent_streams", uint64(*maxConcurrentStreams)),
		slog.Int("max_message_size", *maxMessageSize),
		slog.String("keepalive", "60s ping, 20s timeout"),
	)

	// Start gRPC server
	lis, err := net.Listen("tcp", fmt.Sprintf(":%d", *port))
	if err != nil {
		logger.Error("failed to listen", slog.String("error", err.Error()))
		os.Exit(1)
	}

	logger.Info("router server listening", slog.Int("port", *port))
	if err := grpcServer.Serve(lis); err != nil {
		logger.Error("server failed", slog.String("error", err.Error()))
		os.Exit(1)
	}
}
