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

	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/metric"
	"google.golang.org/grpc"

	pb "go.corp.nvidia.com/osmo/proto/operator"
	"go.corp.nvidia.com/osmo/utils/progress_check"
)

// WatchFunc writes listener messages to a channel.
type WatchFunc func(
	ctx context.Context,
	cancel context.CancelCauseFunc,
	ch chan<- *pb.ListenerMessage,
)

// SendMessagesFunc reads from the channel and sends messages to the stream.
type SendMessagesFunc func(
	ctx context.Context,
	cancel context.CancelCauseFunc,
	ch <-chan *pb.ListenerMessage,
)

// StreamName identifies the listener stream type.
type StreamName string

const (
	StreamNameWorkflow  StreamName = "workflow"
	StreamNameNodeUsage StreamName = "node_usage"
	StreamNameNode      StreamName = "node"
	StreamNameEvent     StreamName = "event"
)

// BaseListener contains common functionality for all listeners
type BaseListener struct {
	unackedMessages *UnackMessages
	progressWriter  *progress_check.ProgressWriter
	streamName      StreamName

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
	inst *Instruments

	// Pre-computed attribute sets (initialized in NewBaseListener, shared across goroutines safely)
	streamAttr       metric.MeasurementOption // {stream: <streamName>}
	panicReceiverAttr metric.MeasurementOption // {stream: <streamName>, goroutine: "receiver"}
	panicWatcherAttr  metric.MeasurementOption // {stream: <streamName>, goroutine: "watcher"}
	panicSenderAttr   metric.MeasurementOption // {stream: <streamName>, goroutine: "sender"}
}

// NewBaseListener creates a new base listener instance
func NewBaseListener(
	args ListenerArgs, progressFileName string, streamName StreamName, inst *Instruments) *BaseListener {
	progressFile := filepath.Join(args.ProgressDir, progressFileName)
	progressWriter, err := progress_check.NewProgressWriter(progressFile)
	if err != nil {
		log.Printf("Warning: failed to create progress writer: %v", err)
		progressWriter = nil
	} else {
		log.Printf("Progress writer initialized: %s", progressFile)
	}

	bl := &BaseListener{
		args:            args,
		unackedMessages: NewUnackMessages(args.MaxUnackedMessages),
		progressWriter:  progressWriter,
		streamName:      streamName,
		inst:            inst,
	}
	bl.streamAttr = metric.WithAttributeSet(attribute.NewSet(attribute.String("stream", string(streamName))))
	bl.panicReceiverAttr = metric.WithAttributeSet(attribute.NewSet(
		attribute.String("stream", string(streamName)),
		attribute.String("goroutine", "receiver"),
	))
	bl.panicWatcherAttr = metric.WithAttributeSet(attribute.NewSet(
		attribute.String("stream", string(streamName)),
		attribute.String("goroutine", "watcher"),
	))
	bl.panicSenderAttr = metric.WithAttributeSet(attribute.NewSet(
		attribute.String("stream", string(streamName)),
		attribute.String("goroutine", "sender"),
	))
	return bl
}

// initConnection establishes a gRPC connection to the service
func (bl *BaseListener) initConnection(serviceURL string) error {
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

// receiveAcks handles receiving ACK messages from the server
func (bl *BaseListener) receiveAcks(
	ctx context.Context,
	cancel context.CancelCauseFunc,
) {
	// Rate limit progress reporting
	lastProgressReport := time.Now()
	progressInterval := time.Duration(bl.args.ProgressFrequencySec) * time.Second

	for {
		msg, err := bl.stream.Recv()
		if err != nil {
			bl.inst.GRPCDisconnectCount.Add(ctx, 1)

			// Check if context was cancelled
			if ctx.Err() != nil {
				log.Printf("Stopping %s message receiver (context cancelled)...", bl.streamName)
				return
			}
			if err == io.EOF {
				log.Printf("Server closed the %s stream", bl.streamName)
				cancel(io.EOF)
				return
			}
			cancel(fmt.Errorf("failed to receive message: %w", err))
			return
		}

		// Handle ACK messages by removing from unacked queue
		bl.unackedMessages.RemoveMessage(msg.AckUuid)

		bl.inst.MessageAckReceivedTotal.Add(ctx, 1, bl.streamAttr)
		bl.inst.UnackedMessageQueueDepth.Record(ctx, float64(bl.unackedMessages.Qsize()), bl.streamAttr)

		log.Printf("Received ACK for %s message: uuid=%s", bl.streamName, msg.AckUuid)

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

// waitForCompletion waits for goroutines to finish
func (bl *BaseListener) waitForCompletion(ctx context.Context, streamCtx context.Context) error {
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

// close cleans up all resources including stream and connection.
// It is safe to call multiple times due to sync.Once protection.
func (bl *BaseListener) close() error {
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

// Run manages the bidirectional streaming lifecycle with three goroutines:
// receiveAcks, watch, and sendMessages.
func (bl *BaseListener) Run(
	ctx context.Context,
	logMessage string,
	msgChan chan *pb.ListenerMessage,
	watch WatchFunc,
	sendMessages SendMessagesFunc,
) error {
	// Ensure cleanup on exit
	defer bl.close()
	// Initialize the base connection
	if err := bl.initConnection(bl.args.ServiceURL); err != nil {
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

	// Launch three goroutines: receiveAcks, watch, sendMessages
	bl.wg.Add(3)
	go func() {
		defer bl.wg.Done()
		defer func() {
			if r := recover(); r != nil {
				log.Printf("Panic in receiveAcks goroutine: %v", r)
				bl.inst.GoroutinePanicTotal.Add(context.Background(), 1, bl.panicReceiverAttr)
				streamCancel(fmt.Errorf("panic in receiver: %v", r))
			}
		}()
		bl.receiveAcks(streamCtx, streamCancel)
	}()

	go func() {
		defer bl.wg.Done()
		defer close(msgChan)
		defer func() {
			if r := recover(); r != nil {
				log.Printf("Panic in watch goroutine: %v", r)
				bl.inst.GoroutinePanicTotal.Add(context.Background(), 1, bl.panicWatcherAttr)
				streamCancel(fmt.Errorf("panic in watcher: %v", r))
			}
		}()
		watch(streamCtx, streamCancel, msgChan)
	}()

	go func() {
		defer bl.wg.Done()
		defer func() {
			if r := recover(); r != nil {
				log.Printf("Panic in sendMessages goroutine: %v", r)
				bl.inst.GoroutinePanicTotal.Add(context.Background(), 1, bl.panicSenderAttr)
				streamCancel(fmt.Errorf("panic in sender: %v", r))
			}
		}()
		sendMessages(streamCtx, streamCancel, msgChan)
	}()

	// Wait for completion
	return bl.waitForCompletion(ctx, streamCtx)
}

// GetStream returns the gRPC stream
func (bl *BaseListener) GetStream() pb.ListenerService_ListenerStreamClient {
	bl.mu.RLock()
	defer bl.mu.RUnlock()
	return bl.stream
}

// SendMessage sends a single listener message
func (bl *BaseListener) SendMessage(ctx context.Context, msg *pb.ListenerMessage) error {
	if err := bl.GetUnackedMessages().AddMessage(ctx, msg); err != nil {
		log.Printf("Failed to add message to unacked queue: %v", err)
		return nil
	}

	bl.inst.UnackedMessageQueueDepth.Record(ctx, float64(bl.unackedMessages.Qsize()), bl.streamAttr)

	// Record gRPC send duration
	start := time.Now()
	if err := bl.GetStream().Send(msg); err != nil {
		bl.inst.GRPCStreamSendErrorTotal.Add(ctx, 1, bl.streamAttr)
		return err
	}

	bl.inst.GRPCMessageSendDuration.Record(ctx, time.Since(start).Seconds(), bl.streamAttr)
	bl.inst.MessageSentTotal.Add(ctx, 1, bl.streamAttr)

	return nil
}
