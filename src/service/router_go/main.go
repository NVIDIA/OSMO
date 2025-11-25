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
	"log"
	"log/slog"
	"net"
	"os"
	"os/signal"
	"syscall"
	"time"

	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials"
	"google.golang.org/grpc/keepalive"

	"go.corp.nvidia.com/osmo/src/service/router_go/server"
)

var (
	port              = flag.Int("port", 50051, "gRPC server port")
	tlsCert           = flag.String("tls-cert", "/etc/router/tls/tls.crt", "TLS certificate file")
	tlsKey            = flag.String("tls-key", "/etc/router/tls/tls.key", "TLS key file")
	tlsEnabled        = flag.Bool("tls-enabled", true, "Enable TLS")
	rendezvousTimeout = flag.Duration("rendezvous-timeout", 60*time.Second, "Rendezvous wait timeout")
	shutdownTimeout   = flag.Duration("shutdown-timeout", 60*time.Second, "Graceful shutdown timeout")
)

func main() {
	flag.Parse()

	// Setup structured logging
	logger := slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{
		Level: slog.LevelInfo,
	}))
	slog.SetDefault(logger)

	// Create session store
	store := server.NewSessionStore(server.SessionStoreConfig{
		RendezvousTimeout: *rendezvousTimeout,
	}, logger)

	// Session cleanup is handled by:
	// 1. defer DeleteSession() when handlers return (primary, 99.9% of cases)
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
		grpc.MaxConcurrentStreams(1000),
	}

	// Add TLS if enabled
	if *tlsEnabled {
		creds, err := credentials.NewServerTLSFromFile(*tlsCert, *tlsKey)
		if err != nil {
			log.Fatalf("Failed to load TLS credentials: %v", err)
		}
		opts = append(opts, grpc.Creds(creds))
		log.Printf("TLS enabled with cert: %s", *tlsCert)
	} else {
		log.Println("WARNING: Running without TLS (insecure)")
	}

	// Create gRPC server
	grpcServer := grpc.NewServer(opts...)

	// Register router services
	routerServer := server.NewRouterServer(store, logger)
	server.RegisterRouterServices(grpcServer, routerServer)

	log.Printf("Router gRPC server configuration:")
	log.Printf("  Port: %d", *port)
	log.Printf("  TLS: %v", *tlsEnabled)
	log.Printf("  Rendezvous Timeout: %v", *rendezvousTimeout)
	log.Printf("  gRPC Keepalive: 60s ping, 20s timeout")
	log.Printf("  Session Cleanup: defer + keepalive (no TTL, sessions can run forever)")

	// Start gRPC server
	lis, err := net.Listen("tcp", fmt.Sprintf(":%d", *port))
	if err != nil {
		log.Fatalf("Failed to listen: %v", err)
	}

	// Handle graceful shutdown
	go func() {
		sigChan := make(chan os.Signal, 1)
		signal.Notify(sigChan, syscall.SIGTERM, syscall.SIGINT)
		<-sigChan

		log.Println("Received shutdown signal, starting graceful shutdown...")

		// Stop accepting new connections
		grpcServer.GracefulStop()

		// Wait for sessions to drain with timeout
		ctx, cancel := context.WithTimeout(context.Background(), *shutdownTimeout)
		defer cancel()

		ticker := time.NewTicker(1 * time.Second)
		defer ticker.Stop()

		for {
			select {
			case <-ctx.Done():
				log.Println("Shutdown timeout reached, forcing close")
				grpcServer.Stop()
				return
			case <-ticker.C:
				active := store.ActiveCount()
				if active == 0 {
					log.Println("All sessions drained, exiting gracefully")
					return
				}
				log.Printf("Waiting for %d active sessions to drain...", active)
			}
		}
	}()

	log.Printf("Router gRPC server listening on port %d", *port)
	if err := grpcServer.Serve(lis); err != nil {
		log.Fatalf("Failed to serve: %v", err)
	}
}
