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

package listener_service

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"os"
	"testing"
	"time"

	"github.com/redis/go-redis/v9"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/metadata"
	"google.golang.org/grpc/status"

	pb "go.corp.nvidia.com/osmo/proto/operator"
	"go.corp.nvidia.com/osmo/service/operator/utils"
)

// mockStream implements pb.ListenerService_ListenerStreamServer for testing
type mockStream struct {
	grpc.ServerStream
	recvMessages []*pb.ListenerMessage
	sentMessages []*pb.AckMessage
	recvIndex    int
	recvError    error
	sendError    error
	ctx          context.Context
}

func newMockStream() *mockStream {
	return newMockStreamWithBackend("test-backend")
}

func newMockStreamWithBackend(backendName string) *mockStream {
	ctx := context.Background()
	// Add backend-name metadata to context
	ctx = metadata.NewIncomingContext(ctx, metadata.Pairs("backend-name", backendName))
	return &mockStream{
		recvMessages: []*pb.ListenerMessage{},
		sentMessages: []*pb.AckMessage{},
		recvIndex:    0,
		ctx:          ctx,
	}
}

func (m *mockStream) Context() context.Context {
	if m.ctx == nil {
		return context.Background()
	}
	return m.ctx
}

func (m *mockStream) Send(msg *pb.AckMessage) error {
	if m.sendError != nil {
		return m.sendError
	}
	m.sentMessages = append(m.sentMessages, msg)
	return nil
}

func (m *mockStream) Recv() (*pb.ListenerMessage, error) {
	if m.recvError != nil {
		return nil, m.recvError
	}
	if m.recvIndex >= len(m.recvMessages) {
		return nil, io.EOF
	}
	msg := m.recvMessages[m.recvIndex]
	m.recvIndex++
	return msg, nil
}

func (m *mockStream) addRecvMessage(msg *pb.ListenerMessage) {
	m.recvMessages = append(m.recvMessages, msg)
}

// setupTestRedis creates a redis client for testing
// It connects to localhost:6379 or uses REDIS_TEST_ADDR env var if set
func setupTestRedis(t *testing.T) *redis.Client {
	t.Helper()

	addr := os.Getenv("REDIS_TEST_ADDR")
	if addr == "" {
		addr = "localhost:6379"
	}

	client := redis.NewClient(&redis.Options{
		Addr: addr,
	})

	// Test connection
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()

	if err := client.Ping(ctx).Err(); err != nil {
		t.Skipf("Skipping test: Redis not available at %s: %v", addr, err)
	}

	// Clean up test stream before each test
	_ = client.Del(ctx, operatorMessagesStream).Err()

	t.Cleanup(func() {
		client.Close()
	})

	return client
}

// setupTestOperatorArgs creates a test OperatorArgs configuration
func setupTestOperatorArgs() *utils.OperatorArgs {
	return &utils.OperatorArgs{
		ServiceHostname:              "test-hostname",
		OperatorProgressDir:          "/tmp/osmo/test",
		OperatorProgressFrequencySec: 15,
	}
}

func TestNewListenerService(t *testing.T) {
	t.Run("with custom logger", func(t *testing.T) {
		logger := slog.New(slog.NewTextHandler(os.Stdout, nil))
		redisClient := setupTestRedis(t)
		args := setupTestOperatorArgs()
		service := NewListenerService(logger, redisClient, nil, args)
		if service == nil {
			t.Fatal("expected non-nil service")
		}
	})

	t.Run("with nil logger", func(t *testing.T) {
		redisClient := setupTestRedis(t)
		args := setupTestOperatorArgs()
		service := NewListenerService(nil, redisClient, nil, args)
		if service == nil {
			t.Fatal("expected non-nil service with default logger")
		}
	})
}

func TestListenerStream_HappyPath(t *testing.T) {
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	redisClient := setupTestRedis(t)
	service := NewListenerService(logger, redisClient, nil, setupTestOperatorArgs())

	stream := newMockStream()

	// Add test messages
	msg1 := &pb.ListenerMessage{
		Uuid:      "test-uuid-1",
		Timestamp: time.Now().Format(time.RFC3339Nano),
		Body: &pb.ListenerMessage_UpdatePod{
			UpdatePod: &pb.UpdatePodBody{
				WorkflowUuid: "test-workflow",
				TaskUuid:     "test-task",
				RetryId:      0,
				Container:    "test-container",
				Status:       "running",
				Backend:      "test-backend",
			},
		},
	}
	msg2 := &pb.ListenerMessage{
		Uuid:      "test-uuid-2",
		Timestamp: time.Now().Format(time.RFC3339Nano),
		Body: &pb.ListenerMessage_UpdatePod{
			UpdatePod: &pb.UpdatePodBody{
				WorkflowUuid: "test-workflow",
				TaskUuid:     "test-task-2",
				RetryId:      0,
				Container:    "test-container",
				Status:       "completed",
				Backend:      "test-backend",
			},
		},
	}

	stream.addRecvMessage(msg1)
	stream.addRecvMessage(msg2)

	// Start a goroutine to handle the stream
	errChan := make(chan error, 1)
	go func() {
		errChan <- service.ListenerStream(stream)
	}()

	// Wait for completion or timeout
	select {
	case err := <-errChan:
		if err != nil {
			t.Fatalf("expected no error, got: %v", err)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("test timed out")
	}

	// Verify ACKs were sent
	if len(stream.sentMessages) != 2 {
		t.Fatalf("expected 2 ACK messages, got %d", len(stream.sentMessages))
	}

	// Verify first ACK
	ack1 := stream.sentMessages[0]
	if ack1.AckUuid != msg1.Uuid {
		t.Errorf("expected AckUuid %s, got %s", msg1.Uuid, ack1.AckUuid)
	}

	// Verify second ACK
	ack2 := stream.sentMessages[1]
	if ack2.AckUuid != msg2.Uuid {
		t.Errorf("expected AckUuid %s, got %s", msg2.Uuid, ack2.AckUuid)
	}
}

func TestListenerStream_EOFClose(t *testing.T) {
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	redisClient := setupTestRedis(t)
	service := NewListenerService(logger, redisClient, nil, setupTestOperatorArgs())

	stream := newMockStream()
	stream.recvError = io.EOF

	err := service.ListenerStream(stream)
	if err != nil {
		t.Fatalf("expected nil error for EOF, got: %v", err)
	}
}

func TestListenerStream_ContextCanceled(t *testing.T) {
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	redisClient := setupTestRedis(t)
	service := NewListenerService(logger, redisClient, nil, setupTestOperatorArgs())

	stream := newMockStream()
	stream.recvError = context.Canceled

	err := service.ListenerStream(stream)
	if err != nil {
		t.Fatalf("expected nil error for context.Canceled, got: %v", err)
	}
}

func TestListenerStream_CanceledStatusCode(t *testing.T) {
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	redisClient := setupTestRedis(t)
	service := NewListenerService(logger, redisClient, nil, setupTestOperatorArgs())

	stream := newMockStream()
	stream.recvError = status.Error(codes.Canceled, "canceled")

	err := service.ListenerStream(stream)
	if err != nil {
		t.Fatalf("expected nil error for status.Canceled, got: %v", err)
	}
}

func TestListenerStream_RecvError(t *testing.T) {
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	redisClient := setupTestRedis(t)
	service := NewListenerService(logger, redisClient, nil, setupTestOperatorArgs())

	stream := newMockStream()
	expectedErr := errors.New("recv error")
	stream.recvError = expectedErr

	err := service.ListenerStream(stream)
	if err == nil {
		t.Fatal("expected error, got nil")
	}
	if err != expectedErr {
		t.Fatalf("expected error %v, got %v", expectedErr, err)
	}
}

func TestListenerStream_SendError(t *testing.T) {
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	redisClient := setupTestRedis(t)
	service := NewListenerService(logger, redisClient, nil, setupTestOperatorArgs())

	stream := newMockStream()

	// Add a message to receive
	msg := &pb.ListenerMessage{
		Uuid:      "test-uuid",
		Timestamp: time.Now().Format(time.RFC3339Nano),
		Body: &pb.ListenerMessage_UpdatePod{
			UpdatePod: &pb.UpdatePodBody{
				WorkflowUuid: "test-workflow",
				TaskUuid:     "test-task",
				RetryId:      0,
				Container:    "test-container",
				Status:       "running",
				Backend:      "test-backend",
			},
		},
	}
	stream.addRecvMessage(msg)

	// Set send error
	expectedErr := errors.New("send error")
	stream.sendError = expectedErr

	err := service.ListenerStream(stream)
	if err == nil {
		t.Fatal("expected error, got nil")
	}
	if err != expectedErr {
		t.Fatalf("expected error %v, got %v", expectedErr, err)
	}
}

func TestListenerStream_LatencyCalculation(t *testing.T) {
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	redisClient := setupTestRedis(t)
	service := NewListenerService(logger, redisClient, nil, setupTestOperatorArgs())

	stream := newMockStream()

	// Create a message with a timestamp in the past
	pastTime := time.Now().Add(-100 * time.Millisecond)
	msg := &pb.ListenerMessage{
		Uuid:      "test-uuid",
		Timestamp: pastTime.Format(time.RFC3339Nano),
		Body: &pb.ListenerMessage_UpdatePod{
			UpdatePod: &pb.UpdatePodBody{
				WorkflowUuid: "test-workflow",
				TaskUuid:     "test-task",
				RetryId:      0,
				Container:    "test-container",
				Status:       "running",
				Backend:      "test-backend",
			},
		},
	}
	stream.addRecvMessage(msg)

	// Start stream handling in goroutine
	errChan := make(chan error, 1)
	go func() {
		errChan <- service.ListenerStream(stream)
	}()

	// Wait for completion
	select {
	case err := <-errChan:
		if err != nil {
			t.Fatalf("expected no error, got: %v", err)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("test timed out")
	}

	// Verify ACK was sent
	if len(stream.sentMessages) != 1 {
		t.Fatalf("expected 1 ACK message, got %d", len(stream.sentMessages))
	}

	ack := stream.sentMessages[0]
	if ack.AckUuid != msg.Uuid {
		t.Errorf("expected AckUuid %s, got %s", msg.Uuid, ack.AckUuid)
	}
}

func TestListenerStream_MultipleMessages(t *testing.T) {
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	redisClient := setupTestRedis(t)
	service := NewListenerService(logger, redisClient, nil, setupTestOperatorArgs())

	stream := newMockStream()

	// Add multiple messages
	numMessages := 10
	for i := 0; i < numMessages; i++ {
		msg := &pb.ListenerMessage{
			Uuid:      "test-uuid-" + string(rune(i)),
			Timestamp: time.Now().Format(time.RFC3339Nano),
			Body: &pb.ListenerMessage_UpdatePod{
				UpdatePod: &pb.UpdatePodBody{
					WorkflowUuid: "test-workflow",
					TaskUuid:     "test-task",
					RetryId:      int32(i),
					Container:    "test-container",
					Status:       "running",
					Backend:      "test-backend",
				},
			},
		}
		stream.addRecvMessage(msg)
	}

	// Start stream handling in goroutine
	errChan := make(chan error, 1)
	go func() {
		errChan <- service.ListenerStream(stream)
	}()

	// Wait for completion
	select {
	case err := <-errChan:
		if err != nil {
			t.Fatalf("expected no error, got: %v", err)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("test timed out")
	}

	// Verify all ACKs were sent
	if len(stream.sentMessages) != numMessages {
		t.Fatalf("expected %d ACK messages, got %d", numMessages, len(stream.sentMessages))
	}

	// Verify all ACKs have been sent
	if len(stream.sentMessages) != numMessages {
		t.Errorf("expected %d ACKs, got %d", numMessages, len(stream.sentMessages))
	}
}

func TestRegisterServices(t *testing.T) {
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	redisClient := setupTestRedis(t)
	service := NewListenerService(logger, redisClient, nil, setupTestOperatorArgs())

	// Create a gRPC server
	grpcServer := grpc.NewServer()
	defer grpcServer.Stop()

	// Register services (should not panic)
	RegisterServices(grpcServer, service)

	// No assertions needed - if we reach here without panicking, the test passes
}

func TestIsExpectedClose(t *testing.T) {
	tests := []struct {
		name     string
		err      error
		expected bool
	}{
		{
			name:     "nil error",
			err:      nil,
			expected: false,
		},
		{
			name:     "io.EOF",
			err:      io.EOF,
			expected: true,
		},
		{
			name:     "context.Canceled",
			err:      context.Canceled,
			expected: true,
		},
		{
			name:     "status codes.Canceled",
			err:      status.Error(codes.Canceled, "canceled"),
			expected: true,
		},
		{
			name:     "other error",
			err:      errors.New("some error"),
			expected: false,
		},
		{
			name:     "status codes.Internal",
			err:      status.Error(codes.Internal, "internal error"),
			expected: false,
		},
		{
			name:     "status codes.Unknown",
			err:      status.Error(codes.Unknown, "unknown error"),
			expected: false,
		},
	}

	// Test that ListenerStream properly handles expected close errors
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			logger := slog.New(slog.NewTextHandler(io.Discard, nil))
			redisClient := setupTestRedis(t)
			service := NewListenerService(logger, redisClient, nil, setupTestOperatorArgs())

			stream := newMockStream()
			stream.recvError = tt.err

			err := service.ListenerStream(stream)

			if tt.expected {
				// Expected close errors should return nil
				if err != nil {
					t.Errorf("expected nil error for expected close, got: %v", err)
				}
			} else {
				if tt.err != nil {
					// Non-expected errors should be returned
					if err == nil {
						t.Error("expected error to be returned, got nil")
					}
				}
			}
		})
	}
}

func TestListenerStream_WithCanceledContext(t *testing.T) {
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	redisClient := setupTestRedis(t)
	service := NewListenerService(logger, redisClient, nil, setupTestOperatorArgs())

	ctx, cancel := context.WithCancel(context.Background())
	// Add backend-name metadata to context before canceling
	ctx = metadata.NewIncomingContext(ctx, metadata.Pairs("backend-name", "test-backend"))
	stream := &mockStream{
		recvMessages: []*pb.ListenerMessage{},
		sentMessages: []*pb.AckMessage{},
		recvIndex:    0,
		ctx:          ctx,
	}

	// Add a message
	msg := &pb.ListenerMessage{
		Uuid:      "test-uuid",
		Timestamp: time.Now().Format(time.RFC3339Nano),
		Body: &pb.ListenerMessage_UpdatePod{
			UpdatePod: &pb.UpdatePodBody{
				WorkflowUuid: "test-workflow",
				TaskUuid:     "test-task",
				RetryId:      0,
				Container:    "test-container",
				Status:       "running",
				Backend:      "test-backend",
			},
		},
	}
	stream.addRecvMessage(msg)

	// Cancel the context before processing
	cancel()
	stream.recvError = context.Canceled

	err := service.ListenerStream(stream)
	if err != nil {
		t.Fatalf("expected nil error for canceled context, got: %v", err)
	}
}

func TestListenerStream_EmptyData(t *testing.T) {
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	redisClient := setupTestRedis(t)
	service := NewListenerService(logger, redisClient, nil, setupTestOperatorArgs())

	stream := newMockStream()

	// Add message with empty data
	msg := &pb.ListenerMessage{
		Uuid:      "test-uuid",
		Timestamp: time.Now().Format(time.RFC3339Nano),
		Body: &pb.ListenerMessage_UpdatePod{
			UpdatePod: &pb.UpdatePodBody{
				WorkflowUuid: "",
				TaskUuid:     "",
				RetryId:      0,
				Container:    "",
				Status:       "",
				Backend:      "",
			},
		},
	}
	stream.addRecvMessage(msg)

	// Start stream handling in goroutine
	errChan := make(chan error, 1)
	go func() {
		errChan <- service.ListenerStream(stream)
	}()

	// Wait for completion
	select {
	case err := <-errChan:
		if err != nil {
			t.Fatalf("expected no error, got: %v", err)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("test timed out")
	}

	// Verify ACK was still sent
	if len(stream.sentMessages) != 1 {
		t.Fatalf("expected 1 ACK message, got %d", len(stream.sentMessages))
	}

	ack := stream.sentMessages[0]
	if ack.AckUuid != msg.Uuid {
		t.Errorf("expected AckUuid %s, got %s", msg.Uuid, ack.AckUuid)
	}
}

func TestListenerStream_WithBackendNameMetadata(t *testing.T) {
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	redisClient := setupTestRedis(t)
	service := NewListenerService(logger, redisClient, nil, setupTestOperatorArgs())

	// Create stream with specific backend name
	stream := newMockStreamWithBackend("production-backend")

	// Add a message
	msg := &pb.ListenerMessage{
		Uuid:      "test-uuid",
		Timestamp: time.Now().Format(time.RFC3339Nano),
		Body: &pb.ListenerMessage_UpdatePod{
			UpdatePod: &pb.UpdatePodBody{
				WorkflowUuid: "test-workflow",
				TaskUuid:     "test-task",
				RetryId:      0,
				Container:    "test-container",
				Status:       "running",
				Backend:      "test-backend",
			},
		},
	}
	stream.addRecvMessage(msg)

	// Don't set recvError - let it naturally EOF after processing the message

	// Start stream handling in goroutine
	errChan := make(chan error, 1)
	go func() {
		errChan <- service.ListenerStream(stream)
	}()

	// Wait for completion
	select {
	case err := <-errChan:
		if err != nil {
			t.Fatalf("expected no error, got: %v", err)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("test timed out")
	}

	// Verify ACK was sent
	if len(stream.sentMessages) != 1 {
		t.Fatalf("expected 1 ACK message, got %d", len(stream.sentMessages))
	}
}

func TestListenerStream_WithoutBackendNameMetadata(t *testing.T) {
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	redisClient := setupTestRedis(t)
	service := NewListenerService(logger, redisClient, nil, setupTestOperatorArgs())

	// Create stream without metadata (should be rejected)
	stream := &mockStream{
		recvMessages: []*pb.ListenerMessage{},
		sentMessages: []*pb.AckMessage{},
		recvIndex:    0,
		ctx:          context.Background(), // No metadata
	}

	// Try to establish stream - should fail immediately
	err := service.ListenerStream(stream)
	if err == nil {
		t.Fatal("expected error for missing backend-name metadata, got nil")
	}

	// Verify no messages were processed
	if len(stream.sentMessages) != 0 {
		t.Fatalf("expected 0 messages sent when connection is rejected, got %d", len(stream.sentMessages))
	}
}

func TestListenerStream_WithEmptyBackendName(t *testing.T) {
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	redisClient := setupTestRedis(t)
	service := NewListenerService(logger, redisClient, nil, setupTestOperatorArgs())

	// Create stream with empty backend name (should be rejected)
	ctx := context.Background()
	ctx = metadata.NewIncomingContext(ctx, metadata.Pairs("backend-name", ""))
	stream := &mockStream{
		recvMessages: []*pb.ListenerMessage{},
		sentMessages: []*pb.AckMessage{},
		recvIndex:    0,
		ctx:          ctx,
	}

	// Try to establish stream - should fail immediately
	err := service.ListenerStream(stream)
	if err == nil {
		t.Fatal("expected error for empty backend-name metadata, got nil")
	}

	// Verify no messages were processed
	if len(stream.sentMessages) != 0 {
		t.Fatalf("expected 0 messages sent when connection is rejected, got %d", len(stream.sentMessages))
	}
}

// ============================================================================
// ListenerStream Tests
// ============================================================================

func TestListenerStream_HappyPath_UpdateNodeBody(t *testing.T) {
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	redisClient := setupTestRedis(t)
	service := NewListenerService(logger, redisClient, nil, setupTestOperatorArgs())

	stream := newMockStream()

	// Add test messages with UpdateNodeBody
	msg1 := &pb.ListenerMessage{
		Uuid:      "resource-uuid-1",
		Timestamp: time.Now().Format(time.RFC3339Nano),
		Body: &pb.ListenerMessage_Resource{
			Resource: &pb.UpdateNodeBody{
				Hostname:   "node-1",
				Available:  true,
				Conditions: []string{"Ready"},
				AllocatableFields: map[string]string{
					"cpu":    "4000m",
					"memory": "16Gi",
				},
				LabelFields: map[string]string{
					"kubernetes.io/hostname": "node-1",
				},
			},
		},
	}
	msg2 := &pb.ListenerMessage{
		Uuid:      "resource-uuid-2",
		Timestamp: time.Now().Format(time.RFC3339Nano),
		Body: &pb.ListenerMessage_Resource{
			Resource: &pb.UpdateNodeBody{
				Hostname:   "node-2",
				Available:  false,
				Conditions: []string{"Ready", "DiskPressure"},
			},
		},
	}

	stream.addRecvMessage(msg1)
	stream.addRecvMessage(msg2)

	// Start a goroutine to handle the stream
	errChan := make(chan error, 1)
	go func() {
		errChan <- service.ListenerStream(stream)
	}()

	// Wait for completion or timeout
	select {
	case err := <-errChan:
		if err != nil {
			t.Fatalf("expected no error, got: %v", err)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("test timed out")
	}

	// Verify ACKs were sent
	if len(stream.sentMessages) != 2 {
		t.Fatalf("expected 2 ACK messages, got %d", len(stream.sentMessages))
	}

	// Verify first ACK
	ack1 := stream.sentMessages[0]
	if ack1.AckUuid != msg1.Uuid {
		t.Errorf("expected AckUuid %s, got %s", msg1.Uuid, ack1.AckUuid)
	}

	// Verify second ACK
	ack2 := stream.sentMessages[1]
	if ack2.AckUuid != msg2.Uuid {
		t.Errorf("expected AckUuid %s, got %s", msg2.Uuid, ack2.AckUuid)
	}
}

func TestListenerStream_HappyPath_UpdateNodeUsageBody(t *testing.T) {
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	redisClient := setupTestRedis(t)
	service := NewListenerService(logger, redisClient, nil, setupTestOperatorArgs())

	stream := newMockStream()

	// Add test message with UpdateNodeUsageBody
	msg := &pb.ListenerMessage{
		Uuid:      "usage-uuid-1",
		Timestamp: time.Now().Format(time.RFC3339Nano),
		Body: &pb.ListenerMessage_ResourceUsage{
			ResourceUsage: &pb.UpdateNodeUsageBody{
				Hostname: "node-1",
				UsageFields: map[string]string{
					"cpu":    "2000m",
					"memory": "8Gi",
				},
				NonWorkflowUsageFields: map[string]string{
					"cpu":    "500m",
					"memory": "2Gi",
				},
			},
		},
	}

	stream.addRecvMessage(msg)

	// Start a goroutine to handle the stream
	errChan := make(chan error, 1)
	go func() {
		errChan <- service.ListenerStream(stream)
	}()

	// Wait for completion or timeout
	select {
	case err := <-errChan:
		if err != nil {
			t.Fatalf("expected no error, got: %v", err)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("test timed out")
	}

	// Verify ACK was sent
	if len(stream.sentMessages) != 1 {
		t.Fatalf("expected 1 ACK message, got %d", len(stream.sentMessages))
	}

	ack := stream.sentMessages[0]
	if ack.AckUuid != msg.Uuid {
		t.Errorf("expected AckUuid %s, got %s", msg.Uuid, ack.AckUuid)
	}
}

func TestListenerStream_HappyPath_DeleteResource(t *testing.T) {
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	redisClient := setupTestRedis(t)
	service := NewListenerService(logger, redisClient, nil, setupTestOperatorArgs())

	stream := newMockStream()

	// Add test message with UpdateNodeBody and delete=true
	msg := &pb.ListenerMessage{
		Uuid:      "delete-uuid-1",
		Timestamp: time.Now().Format(time.RFC3339Nano),
		Body: &pb.ListenerMessage_Resource{
			Resource: &pb.UpdateNodeBody{
				Hostname: "node-to-delete",
				Delete:   true,
			},
		},
	}

	stream.addRecvMessage(msg)

	// Start a goroutine to handle the stream
	errChan := make(chan error, 1)
	go func() {
		errChan <- service.ListenerStream(stream)
	}()

	// Wait for completion or timeout
	select {
	case err := <-errChan:
		if err != nil {
			t.Fatalf("expected no error, got: %v", err)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("test timed out")
	}

	// Verify ACK was sent
	if len(stream.sentMessages) != 1 {
		t.Fatalf("expected 1 ACK message, got %d", len(stream.sentMessages))
	}

	ack := stream.sentMessages[0]
	if ack.AckUuid != msg.Uuid {
		t.Errorf("expected AckUuid %s, got %s", msg.Uuid, ack.AckUuid)
	}
}

func TestListenerStream_MixedMessageTypes(t *testing.T) {
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	redisClient := setupTestRedis(t)
	service := NewListenerService(logger, redisClient, nil, setupTestOperatorArgs())

	stream := newMockStream()

	// Add mixed message types
	msg1 := &pb.ListenerMessage{
		Uuid:      "resource-uuid-1",
		Timestamp: time.Now().Format(time.RFC3339Nano),
		Body: &pb.ListenerMessage_Resource{
			Resource: &pb.UpdateNodeBody{
				Hostname:  "node-1",
				Available: true,
			},
		},
	}
	msg2 := &pb.ListenerMessage{
		Uuid:      "usage-uuid-1",
		Timestamp: time.Now().Format(time.RFC3339Nano),
		Body: &pb.ListenerMessage_ResourceUsage{
			ResourceUsage: &pb.UpdateNodeUsageBody{
				Hostname: "node-1",
				UsageFields: map[string]string{
					"cpu": "2000m",
				},
			},
		},
	}
	msg3 := &pb.ListenerMessage{
		Uuid:      "delete-uuid-1",
		Timestamp: time.Now().Format(time.RFC3339Nano),
		Body: &pb.ListenerMessage_Resource{
			Resource: &pb.UpdateNodeBody{
				Hostname: "node-2",
				Delete:   true,
			},
		},
	}

	stream.addRecvMessage(msg1)
	stream.addRecvMessage(msg2)
	stream.addRecvMessage(msg3)

	// Start a goroutine to handle the stream
	errChan := make(chan error, 1)
	go func() {
		errChan <- service.ListenerStream(stream)
	}()

	// Wait for completion or timeout
	select {
	case err := <-errChan:
		if err != nil {
			t.Fatalf("expected no error, got: %v", err)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("test timed out")
	}

	// Verify all ACKs were sent
	if len(stream.sentMessages) != 3 {
		t.Fatalf("expected 3 ACK messages, got %d", len(stream.sentMessages))
	}

	// Verify ACKs match messages
	expectedUuids := []string{msg1.Uuid, msg2.Uuid, msg3.Uuid}
	for i, ack := range stream.sentMessages {
		if ack.AckUuid != expectedUuids[i] {
			t.Errorf("ACK %d: expected AckUuid %s, got %s", i, expectedUuids[i], ack.AckUuid)
		}
	}
}
