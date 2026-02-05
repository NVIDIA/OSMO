// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION. All rights reserved.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
// http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.
//
// SPDX-License-Identifier: Apache-2.0

package main

import (
	"context"
	"fmt"
	"log"
	"os"
	"os/signal"
	"sync"
	"syscall"
	"time"

	"google.golang.org/grpc"
	"google.golang.org/grpc/metadata"

	libutils "go.corp.nvidia.com/osmo/lib/utils"
	"go.corp.nvidia.com/osmo/operator/utils"
	pb "go.corp.nvidia.com/osmo/proto/operator"
)

// Listener interface defines the common contract for all listener types
type Listener interface {
	Run(ctx context.Context) error
}

func main() {
	cmdArgs := utils.ListenerParse()

	log.Printf(
		"Starting Operator Listeners: backend=%s, namespace=%s",
		cmdArgs.Backend, cmdArgs.Namespace,
	)

	// Set up context with signal handling for graceful shutdown
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	// Add backend-name to metadata
	md := metadata.Pairs("backend-name", cmdArgs.Backend)
	ctx = metadata.NewOutgoingContext(ctx, md)

	if err := initializeBackend(ctx, cmdArgs); err != nil {
		log.Fatalf("Failed to initialize backend: %v", err)
	}

	// Create all listeners
	workflowListener := NewWorkflowListener(cmdArgs)
	resourceListener := NewResourceListener(cmdArgs)
	eventListener := NewEventListener(cmdArgs)

	var wg sync.WaitGroup

	// Launch all listeners in parallel
	wg.Add(3)
	go runListenerWithRetry(ctx, workflowListener, "WorkflowListener", &wg)
	go runListenerWithRetry(ctx, resourceListener, "ResourceListener", &wg)
	go runListenerWithRetry(ctx, eventListener, "EventListener", &wg)

	// Wait for all listeners to complete
	wg.Wait()

	log.Println("Operator Listeners stopped gracefully")
}

// runListenerWithRetry runs a listener with automatic reconnection on failure.
// It retries indefinitely on connection errors until context is cancelled.
func runListenerWithRetry(
	ctx context.Context,
	listener Listener,
	name string,
	wg *sync.WaitGroup,
) {
	defer wg.Done()

	log.Printf("[%s] Starting listener", name)

	retryCount := 0
	for {
		err := listener.Run(ctx)
		if err != nil {
			if err == context.Canceled || err == context.DeadlineExceeded {
				log.Printf("[%s] Context cancelled, shutting down: %v", name, err)
				return
			}
			retryCount++
			backoff := utils.CalculateBackoff(retryCount, 30*time.Second)
			log.Printf("[%s] Connection lost: %v. Reconnecting in %v...", name, err, backoff)

			// Wait for backoff or context cancellation
			select {
			case <-ctx.Done():
				log.Printf("[%s] Context cancelled during backoff, shutting down", name)
				return
			case <-time.After(backoff):
				continue
			}
		}
		// Clean exit
		log.Printf("[%s] Listener exited cleanly", name)
		return
	}
}

// initializeBackend sends the initial backend registration to the operator service
// with automatic retry until successful or context cancelled
func initializeBackend(ctx context.Context, args utils.ListenerArgs) error {
	version, err := libutils.LoadVersion()
	if err != nil {
		return fmt.Errorf("failed to load version from file: %w", err)
	}

	// Parse serviceURL to extract host:port for gRPC
	serviceAddr, err := utils.ParseServiceURL(args.ServiceURL)
	if err != nil {
		return fmt.Errorf("failed to parse service URL: %w", err)
	}

	kubeSystemUID, err := utils.GetKubeSystemUID()
	if err != nil {
		return fmt.Errorf("failed to get kube-system UID: %w", err)
	}
	initReq := &pb.InitBackendRequest{
		InitBody: &pb.InitBody{
			K8SUid:              kubeSystemUID,
			K8SNamespace:        args.Namespace,
			Name:                args.Backend,
			Version:             version,
			NodeConditionPrefix: args.NodeConditionPrefix,
		},
	}

	// Create connection (lazy - actual connection happens on first RPC)
	conn, err := grpc.NewClient(
		serviceAddr,
		grpc.WithTransportCredentials(utils.GetTransportCredentials(args.ServiceURL)),
	)
	if err != nil {
		return fmt.Errorf("failed to create gRPC client: %w", err)
	}
	defer conn.Close()

	client := pb.NewListenerServiceClient(conn)

	// Retry loop for InitBackend RPC call
	retryCount := 0
	for {
		initResp, err := client.InitBackend(ctx, initReq)
		if err == nil {
			if !initResp.Success {
				return fmt.Errorf("backend initialization failed: %s", initResp.Message)
			}
			return nil
		}

		retryCount++
		if retryCount == 1 {
			log.Printf("Failed to initialize backend: %v. Retrying...", err)
		}

		backoff := utils.CalculateBackoff(retryCount, 30*time.Second)
		time.Sleep(backoff)
	}
}
