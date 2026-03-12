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

const RETRY_SERVICE_CONFIG = `{
	"methodConfig": [{
		"name": [{"service": "operator.ListenerService", "method": "SendListenerMessage"}],
		"retryPolicy": {
			"maxAttempts": 5,
			"initialBackoff": "1s",
			"maxBackoff": "20s",
			"backoffMultiplier": 2,
			"retryableStatusCodes": ["UNAVAILABLE", "DEADLINE_EXCEEDED"]
		}
	}]
}`

// WatchFunc writes listener messages to a channel.
type WatchFunc func(
	ctx context.Context,
	ch chan<- *pb.ListenerMessage,
) error

// SendMessagesFunc reads from the channel and sends messages to the stream.
type SendMessagesFunc func(
	ctx context.Context,
	ch <-chan *pb.ListenerMessage,
) error

// StreamName identifies the listener stream type.
type StreamName string

const (
	StreamNameWorkflow          StreamName = "workflow"
	StreamNameNodeUsage         StreamName = "node_usage"
	StreamNameNode              StreamName = "node"
	StreamNameNodeConditionRule StreamName = "node_condition_rule"
	StreamNameEvent             StreamName = "event"
)

// BaseListener contains common functionality for all listeners
type BaseListener struct {
	unackedMessages *UnackMessages
	progressWriter  *progress_check.ProgressWriter
	streamName      StreamName

	// Connection state
	conn   *grpc.ClientConn
	client pb.ListenerServiceClient

	// Stream coordination
	connCloseOnce sync.Once // Ensures connection is closed only once

	// Configuration
	args ListenerArgs
	inst *Instruments

	// Attrs is a pre-computed metric attribute set {listener: <streamName>}, shared (read-only) across goroutines.
	MetricAttrs metric.MeasurementOption
}

// NewBaseListener creates a new base listener instance
func NewBaseListener(
	args ListenerArgs, progressFileName string, streamName StreamName, inst *Instruments) *BaseListener {
	progressFile := filepath.Join(args.ProgressDir, progressFileName)
	progressWriter, err := progress_check.NewProgressWriter(progressFile)
	if err != nil {
		log.Printf("[%s] Warning: failed to create progress writer: %v", streamName, err)
		progressWriter = nil
	} else {
		// Write initial progress so the startup probe finds the file immediately
		if err := progressWriter.ReportProgress(); err != nil {
			log.Printf("[%s] Warning: failed to write initial progress: %v", streamName, err)
		}
		log.Printf("[%s] Progress writer initialized: %s", streamName, progressFile)
	}

	bl := &BaseListener{
		args:            args,
		unackedMessages: NewUnackMessages(args.MaxUnackedMessages),
		progressWriter:  progressWriter,
		streamName:      streamName,
		inst:            inst,
		MetricAttrs: metric.WithAttributeSet(attribute.NewSet(
			attribute.String("listener", string(streamName)))),
	}
	return bl
}

// Logf logs with stream name prefix.
func (bl *BaseListener) Logf(format string, args ...interface{}) {
	log.Printf("["+string(bl.streamName)+"] "+format, args...)
}

// initConnection establishes a gRPC connection to the service
func (bl *BaseListener) initConnection() error {
	serviceAddr, err := ParseServiceURL(bl.args.ServiceURL)
	if err != nil {
		return fmt.Errorf("failed to parse service URL: %w", err)
	}

	dialOpts, err := GetDialOptions(bl.args)
	if err != nil {
		return fmt.Errorf("failed to get dial options: %w", err)
	}

	dialOpts = append(dialOpts, grpc.WithDefaultServiceConfig(RETRY_SERVICE_CONFIG))

	bl.conn, err = grpc.NewClient(serviceAddr, dialOpts...)
	if err != nil {
		return fmt.Errorf("failed to connect to service: %w", err)
	}

	bl.client = pb.NewListenerServiceClient(bl.conn)
	return nil
}

// close cleans up the connection.
// It is safe to call multiple times due to sync.Once protection.
func (bl *BaseListener) close() error {
	var connErr error

	// Close connection (idempotent via sync.Once)
	bl.connCloseOnce.Do(func() {
		if bl.conn != nil {
			connErr = bl.conn.Close()
			if connErr != nil {
				bl.Logf("Error closing connection: %v", connErr)
			}
		}
	})

	return connErr
}

// GetUnackedMessages returns the unacked messages queue
func (bl *BaseListener) GetUnackedMessages() *UnackMessages {
	return bl.unackedMessages
}

// DrainMessageChannel reads remaining messages from ch and adds them to the unacked
// queue using drop-oldest eviction. This prevents message loss during connection breaks
// while respecting the queue capacity bound.
func (bl *BaseListener) DrainMessageChannel(ch <-chan *pb.ListenerMessage) {
	drained := 0
	unackedMessages := bl.GetUnackedMessages()
	for {
		select {
		case msg, ok := <-ch:
			if !ok {
				return
			}
			unackedMessages.AddMessageDropOldest(msg)
			drained++
		default:
			if drained > 0 {
				bl.Logf("Drained %d messages from channel to unacked queue", drained)
			}
			return
		}
	}
}

// GetProgressWriter returns the progress writer
func (bl *BaseListener) GetProgressWriter() *progress_check.ProgressWriter {
	return bl.progressWriter
}

// GetStreamName returns the stream name for log prefixes.
func (bl *BaseListener) GetStreamName() StreamName {
	return bl.streamName
}

// Run manages the unary RPC lifecycle with two goroutines: watch and sendMessages.
func (bl *BaseListener) Run(
	ctx context.Context,
	logMessage string,
	msgChan chan *pb.ListenerMessage,
	watch WatchFunc,
	sendMessages SendMessagesFunc,
) error {
	// Reset cleanup guard so close() works on retry (sync.Once is single-fire)
	bl.connCloseOnce = sync.Once{}
	defer bl.close()

	if err := bl.initConnection(); err != nil {
		return err
	}

	runCtx, runCancel := context.WithCancelCause(ctx)
	defer runCancel(nil)

	bl.Logf("%s", logMessage)

	// Use local WaitGroup to avoid cross-run interference on retry
	var wg sync.WaitGroup
	wg.Add(2)
	go func() {
		defer wg.Done()
		defer close(msgChan)
		if err := watch(runCtx, msgChan); err != nil {
			bl.Logf("Error in watch goroutine: %v", err)
			runCancel(err)
		}
	}()
	go func() {
		defer wg.Done()
		if err := sendMessages(runCtx, msgChan); err != nil {
			bl.Logf("Error in sendMessages goroutine: %v", err)
			runCancel(err)
		}
	}()

	// Wait for context cancellation then drain goroutines
	<-runCtx.Done()

	var finalErr error
	if cause := context.Cause(runCtx); cause != nil && cause != context.Canceled && cause != io.EOF {
		bl.Logf("Error from goroutine: %v", cause)
		finalErr = fmt.Errorf("listener error: %w", cause)
	} else if ctx.Err() != nil {
		bl.Logf("Context cancelled, initiating graceful shutdown...")
		finalErr = ctx.Err()
	}

	shutdownComplete := make(chan struct{})
	go func() { wg.Wait(); close(shutdownComplete) }()
	select {
	case <-shutdownComplete:
		bl.Logf("All listener goroutines stopped gracefully")
	case <-time.After(5 * time.Second):
		bl.Logf("Warning: listener goroutines did not stop within timeout")
	}

	return finalErr
}

// SendMessage sends a single listener message via the unary RPC.
// gRPC built-in retry handles transient failures transparently.
func (bl *BaseListener) SendMessage(ctx context.Context, msg *pb.ListenerMessage) error {
	start := time.Now()
	_, err := bl.client.SendListenerMessage(ctx, msg)
	if err != nil {
		bl.inst.GRPCStreamSendErrorTotal.Add(ctx, 1, bl.MetricAttrs)
		return err
	}
	bl.inst.GRPCMessageSendDuration.Record(ctx, time.Since(start).Seconds(), bl.MetricAttrs)
	bl.inst.MessageSentTotal.Add(ctx, 1, bl.MetricAttrs)
	return nil
}
