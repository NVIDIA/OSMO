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
	"google.golang.org/grpc/credentials/insecure"

	pb "go.corp.nvidia.com/osmo/proto/compute_connector"
	"go.corp.nvidia.com/osmo/utils/progress_check"
)

// MessageReceiver is the interface for receiving ACK messages from a stream
type MessageReceiver interface {
	Recv() (*pb.AckMessage, error)
}

// BaseListener contains common functionality for all listeners
type BaseListener struct {
	unackedMessages *UnackMessages
	progressWriter  *progress_check.ProgressWriter

	// Connection state
	conn   *grpc.ClientConn
	client pb.ListenerServiceClient

	// Stream coordination
	streamCtx    context.Context
	streamCancel context.CancelCauseFunc
	wg           sync.WaitGroup
	closeOnce    sync.Once

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
		grpc.WithTransportCredentials(insecure.NewCredentials()),
	)
	if err != nil {
		return fmt.Errorf("failed to connect to service: %w", err)
	}

	// Create the listener service client
	bl.client = pb.NewListenerServiceClient(bl.conn)

	return nil
}

// InitStreamContext sets up the stream context for coordinated shutdown
func (bl *BaseListener) InitStreamContext(ctx context.Context) {
	bl.streamCtx, bl.streamCancel = context.WithCancelCause(ctx)
}

// ReceiveAcks handles receiving ACK messages from the server
func (bl *BaseListener) ReceiveAcks(stream MessageReceiver, streamName string) {
	// Rate limit progress reporting
	lastProgressReport := time.Now()
	progressInterval := time.Duration(bl.args.ProgressFrequencySec) * time.Second

	for {
		msg, err := stream.Recv()
		if err != nil {
			// Check if context was cancelled
			if bl.streamCtx.Err() != nil {
				log.Printf("Stopping %s message receiver (context cancelled)...", streamName)
				return
			}
			if err == io.EOF {
				log.Printf("Server closed the %s stream", streamName)
				bl.streamCancel(io.EOF)
				return
			}
			bl.streamCancel(fmt.Errorf("failed to receive message: %w", err))
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
func (bl *BaseListener) WaitForCompletion(ctx context.Context, closeStreamFunc func()) error {
	// Wait for context cancellation (from parent or goroutines)
	<-bl.streamCtx.Done()

	// Check if error came from a goroutine or parent context
	var finalErr error
	if cause := context.Cause(bl.streamCtx); cause != nil && cause != context.Canceled && cause != io.EOF {
		log.Printf("Error from goroutine: %v", cause)
		finalErr = fmt.Errorf("stream error: %w", cause)
	} else if ctx.Err() != nil {
		log.Println("Context cancelled, initiating graceful shutdown...")
		finalErr = ctx.Err()
	}

	// Close stream and wait for goroutines with timeout
	closeStreamFunc()

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

// CloseConnection cleans up resources
func (bl *BaseListener) CloseConnection() {
	if bl.streamCancel != nil {
		bl.streamCancel(nil)
	}
	if bl.conn != nil {
		bl.conn.Close()
	}
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

// GetStreamContext returns the stream context
func (bl *BaseListener) GetStreamContext() context.Context {
	return bl.streamCtx
}

// GetStreamCancel returns the stream cancel function
func (bl *BaseListener) GetStreamCancel() context.CancelCauseFunc {
	return bl.streamCancel
}

// AddToWaitGroup adds delta to the wait group
func (bl *BaseListener) AddToWaitGroup(delta int) {
	bl.wg.Add(delta)
}

// WaitGroupDone marks a wait group item as done
func (bl *BaseListener) WaitGroupDone() {
	bl.wg.Done()
}
