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

package utils

import (
	"context"
	"fmt"
	"io"
	"log"
	"path/filepath"
	"sync"
	"time"

	"google.golang.org/grpc"

	pb "go.corp.nvidia.com/osmo/proto/operator"
	"go.corp.nvidia.com/osmo/utils/metrics"
	"go.corp.nvidia.com/osmo/utils/progress_check"
)

// MessageReceiver is the interface for receiving ACK messages from a stream
type MessageReceiver interface {
	Recv() (*pb.AckMessage, error)
}

// MessageSenderFunc is a function type for sending messages
type MessageSenderFunc func(ctx context.Context, cancel context.CancelCauseFunc)

// BaseListener contains common functionality for all listeners
type BaseListener struct {
	unackedMessages *UnackMessages
	progressWriter  *progress_check.ProgressWriter

	// Connection state
	conn   *grpc.ClientConn
	client pb.ListenerServiceClient
	stream pb.ListenerService_ListenerStreamClient

	// Stream coordination
	mu            sync.RWMutex // Protects stream field access
	wg            sync.WaitGroup
	closeOnce     sync.Once // Ensures stream is closed only once
	connCloseOnce sync.Once // Ensures connection is closed only once

	// Configuration
	args ListenerArgs
}

// NewBaseListener creates a new base listener instance
func NewBaseListener(args ListenerArgs, progressFileName string) *BaseListener {
	// Initialize progress writer
	progressFile := filepath.Join(args.ProgressDir, progressFileName)
	progressWriter, err := progress_check.NewProgressWriter(progressFile)
	if err != nil {
		log.Printf("Warning: failed to create progress writer: %v", err)
		progressWriter = nil
	} else {
		log.Printf("Progress writer initialized: %s", progressFile)
	}

	return &BaseListener{
		args:            args,
		unackedMessages: NewUnackMessages(args.MaxUnackedMessages),
		progressWriter:  progressWriter,
	}
}

// InitConnection establishes a gRPC connection to the service
func (bl *BaseListener) InitConnection(ctx context.Context, serviceURL string) error {
	// Parse serviceURL to extract host:port for gRPC
	serviceAddr, err := ParseServiceURL(serviceURL)
	if err != nil {
		return fmt.Errorf("failed to parse service URL: %w", err)
	}

	// Connect to the gRPC server
	bl.conn, err = grpc.NewClient(
		serviceAddr,
		grpc.WithTransportCredentials(GetTransportCredentials(serviceURL)),
	)
	if err != nil {
		return fmt.Errorf("failed to connect to service: %w", err)
	}

	// Create the listener service client
	bl.client = pb.NewListenerServiceClient(bl.conn)

	return nil
}

// ReceiveAcks handles receiving ACK messages from the server
func (bl *BaseListener) ReceiveAcks(ctx context.Context, cancel context.CancelCauseFunc, stream MessageReceiver, streamName string) {
	// Rate limit progress reporting
	lastProgressReport := time.Now()
	progressInterval := time.Duration(bl.args.ProgressFrequencySec) * time.Second

	for {
		msg, err := stream.Recv()
		if err != nil {
			// Record grpc_disconnect_count metric
			if metricCreator := metrics.GetMetricCreator(); metricCreator != nil {
				metricCreator.RecordCounter(
					ctx,
					"grpc_disconnect_count",
					1,
					"count",
					"Count of gRPC stream disconnections",
					nil,
				)
			}

			// Check if context was cancelled
			if ctx.Err() != nil {
				log.Printf("Stopping %s message receiver (context cancelled)...", streamName)
				return
			}
			if err == io.EOF {
				log.Printf("Server closed the %s stream", streamName)
				cancel(io.EOF)
				return
			}
			cancel(fmt.Errorf("failed to receive message: %w", err))
			return
		}

		// Handle ACK messages by removing from unacked queue
		bl.unackedMessages.RemoveMessage(msg.AckUuid)
		log.Printf("Received ACK for %s message: uuid=%s", streamName, msg.AckUuid)

		// Report progress after receiving ACK (rate-limited)
		now := time.Now()
		if bl.progressWriter != nil && now.Sub(lastProgressReport) >= progressInterval {
			if err := bl.progressWriter.ReportProgress(); err != nil {
				log.Printf("Warning: failed to report progress: %v", err)
			}
			lastProgressReport = now
		}
	}
}

// WaitForCompletion waits for goroutines to finish
func (bl *BaseListener) WaitForCompletion(ctx context.Context, streamCtx context.Context) error {
	// Wait for context cancellation (from parent or goroutines)
	<-streamCtx.Done()

	// Check if error came from a goroutine or parent context
	var finalErr error
	if cause := context.Cause(streamCtx); cause != nil && cause != context.Canceled && cause != io.EOF {
		log.Printf("Error from goroutine: %v", cause)
		finalErr = fmt.Errorf("stream error: %w", cause)
	} else if ctx.Err() != nil {
		log.Println("Context cancelled, initiating graceful shutdown...")
		finalErr = ctx.Err()
	}

	// Wait for goroutines with timeout
	shutdownComplete := make(chan struct{})
	go func() {
		bl.wg.Wait()
		close(shutdownComplete)
	}()

	select {
	case <-shutdownComplete:
		log.Println("All listener goroutines stopped gracefully")
	case <-time.After(5 * time.Second):
		log.Println("Warning: listener goroutines did not stop within timeout")
	}

	return finalErr
}

// Close cleans up all resources including stream and connection.
// It is safe to call multiple times due to sync.Once protection.
func (bl *BaseListener) Close() error {
	var streamErr, connErr error

	// Close stream (idempotent via sync.Once)
	bl.closeOnce.Do(func() {
		bl.mu.RLock()
		stream := bl.stream
		bl.mu.RUnlock()
		if stream != nil {
			streamErr = stream.CloseSend()
			if streamErr != nil {
				log.Printf("Error closing stream: %v", streamErr)
			}
		}
	})

	// Close connection (idempotent via sync.Once)
	bl.connCloseOnce.Do(func() {
		if bl.conn != nil {
			connErr = bl.conn.Close()
			if connErr != nil {
				log.Printf("Error closing connection: %v", connErr)
			}
		}
	})

	// Return combined errors if any occurred
	if streamErr != nil || connErr != nil {
		return fmt.Errorf("close errors: stream=%v, conn=%v", streamErr, connErr)
	}
	return nil
}

// GetUnackedMessages returns the unacked messages queue
func (bl *BaseListener) GetUnackedMessages() *UnackMessages {
	return bl.unackedMessages
}

// GetProgressWriter returns the progress writer
func (bl *BaseListener) GetProgressWriter() *progress_check.ProgressWriter {
	return bl.progressWriter
}

// GetClient returns the gRPC client
func (bl *BaseListener) GetClient() pb.ListenerServiceClient {
	return bl.client
}

// AddToWaitGroup adds delta to the wait group
func (bl *BaseListener) AddToWaitGroup(delta int) {
	bl.wg.Add(delta)
}

// WaitGroupDone marks a wait group item as done
func (bl *BaseListener) WaitGroupDone() {
	bl.wg.Done()
}

// Run manages the bidirectional streaming lifecycle
func (bl *BaseListener) Run(
	ctx context.Context,
	logMessage string,
	sendMessages MessageSenderFunc,
	streamName string,
) error {
	// Ensure cleanup on exit
	defer bl.Close()
	// Initialize the base connection
	if err := bl.InitConnection(ctx, bl.args.ServiceURL); err != nil {
		return err
	}

	// Create stream context FIRST (before stream creation)
	streamCtx, streamCancel := context.WithCancelCause(ctx)
	defer streamCancel(nil) // Ensure cleanup

	// Establish the bidirectional stream using the derived context
	var err error
	stream, err := bl.client.ListenerStream(streamCtx)
	if err != nil {
		return fmt.Errorf("failed to create stream: %w", err)
	}

	// Set stream with mutex protection
	bl.mu.Lock()
	bl.stream = stream
	bl.mu.Unlock()

	log.Printf("%s", logMessage)

	// Resend all unacked messages from previous connection (if any)
	if err := bl.unackedMessages.ResendAll(bl.stream); err != nil {
		return err
	}

	// Launch goroutines for send and receive
	bl.AddToWaitGroup(2)
	go func() {
		defer bl.WaitGroupDone()
		defer func() {
			if r := recover(); r != nil {
				log.Printf("Panic in ReceiveAcks goroutine: %v", r)
				streamCancel(fmt.Errorf("panic in receiver: %v", r))
			}
		}()
		bl.ReceiveAcks(streamCtx, streamCancel, bl.stream, streamName)
	}()

	go func() {
		defer bl.WaitGroupDone()
		defer func() {
			if r := recover(); r != nil {
				log.Printf("Panic in sendMessages goroutine: %v", r)
				streamCancel(fmt.Errorf("panic in sender: %v", r))
			}
		}()
		sendMessages(streamCtx, streamCancel)
	}()

	// Wait for completion
	return bl.WaitForCompletion(ctx, streamCtx)
}

// GetStream returns the gRPC stream
func (bl *BaseListener) GetStream() pb.ListenerService_ListenerStreamClient {
	bl.mu.RLock()
	defer bl.mu.RUnlock()
	return bl.stream
}
