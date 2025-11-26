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

package server

import (
	"context"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net"
	"sync"
	"testing"
	"time"

	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/credentials/insecure"
	"google.golang.org/grpc/status"
	"google.golang.org/grpc/test/bufconn"

	pb "go.corp.nvidia.com/osmo/proto/router"
)

// Test environment setup

type testEnv struct {
	server *grpc.Server
	lis    *bufconn.Listener
}

func setupTestEnv(t *testing.T, rendezvousTimeout time.Duration) *testEnv {
	t.Helper()
	if rendezvousTimeout == 0 {
		rendezvousTimeout = 60 * time.Second
	}

	lis := bufconn.Listen(1024 * 1024)
	server := grpc.NewServer()

	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	store := NewSessionStore(SessionStoreConfig{
		RendezvousTimeout: rendezvousTimeout,
		StreamSendTimeout: 30 * time.Second,
	}, logger)
	rs := NewRouterServer(store, logger)
	RegisterRouterServices(server, rs)

	go func() {
		if err := server.Serve(lis); err != nil && !errors.Is(err, grpc.ErrServerStopped) {
			t.Logf("server error: %v", err)
		}
	}()

	t.Cleanup(server.Stop)
	return &testEnv{server: server, lis: lis}
}

func (e *testEnv) dial(t *testing.T) *grpc.ClientConn {
	t.Helper()
	conn, err := grpc.NewClient("passthrough:///bufnet",
		grpc.WithContextDialer(func(ctx context.Context, _ string) (net.Conn, error) {
			return e.lis.Dial()
		}),
		grpc.WithTransportCredentials(insecure.NewCredentials()),
	)
	if err != nil {
		t.Fatalf("dial failed: %v", err)
	}
	t.Cleanup(func() { conn.Close() })
	return conn
}

func (e *testEnv) clientService(t *testing.T) pb.RouterClientServiceClient {
	return pb.NewRouterClientServiceClient(e.dial(t))
}

func (e *testEnv) agentService(t *testing.T) pb.RouterAgentServiceClient {
	return pb.NewRouterAgentServiceClient(e.dial(t))
}

func (e *testEnv) controlService(t *testing.T) pb.RouterControlServiceClient {
	return pb.NewRouterControlServiceClient(e.dial(t))
}

// Helper functions for sending TunnelMessages

// sendInit sends a TunnelInit message. If initTemplate is nil, creates a default exec operation.
// Creates a copy to avoid race conditions when called from multiple goroutines.
func sendInit(stream interface {
	Send(*pb.TunnelMessage) error
}, sessionKey, cookie, workflowID string, initTemplate *pb.TunnelInit) error {
	init := &pb.TunnelInit{
		SessionKey: sessionKey,
		Cookie:     cookie,
		WorkflowId: workflowID,
	}
	if initTemplate == nil {
		init.Operation = &pb.TunnelInit_Exec{Exec: &pb.ExecOperation{}}
	} else {
		init.Operation = initTemplate.Operation
	}
	return stream.Send(&pb.TunnelMessage{
		Message: &pb.TunnelMessage_Init{Init: init},
	})
}

func sendData(stream interface {
	Send(*pb.TunnelMessage) error
}, data []byte) error {
	return stream.Send(&pb.TunnelMessage{
		Message: &pb.TunnelMessage_Data{
			Data: &pb.TunnelData{Payload: data},
		},
	})
}

func sendClose(stream interface {
	Send(*pb.TunnelMessage) error
}) error {
	return stream.Send(&pb.TunnelMessage{
		Message: &pb.TunnelMessage_Close{Close: &pb.TunnelClose{}},
	})
}

// Tests

func TestBasicExecRoundTrip(t *testing.T) {
	t.Parallel()
	env := setupTestEnv(t, 0)

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	clientDone := make(chan error, 1)
	agentDone := make(chan error, 1)

	sessionKey := "test-session"

	// Client
	go func() {
		client := env.clientService(t)
		stream, err := client.Tunnel(ctx)
		if err != nil {
			clientDone <- err
			return
		}

		if err := sendInit(stream, sessionKey, "cookie", "workflow", nil); err != nil {
			clientDone <- err
			return
		}

		if err := sendData(stream, []byte("hello")); err != nil {
			clientDone <- err
			return
		}

		resp, err := stream.Recv()
		if err != nil {
			clientDone <- err
			return
		}

		if string(resp.GetData().Payload) != "world" {
			clientDone <- fmt.Errorf("expected 'world', got '%s'", string(resp.GetData().Payload))
			return
		}

		sendClose(stream)
		stream.CloseSend()
		clientDone <- nil
	}()

	// Agent
	go func() {
		time.Sleep(50 * time.Millisecond) // Let client connect first
		agent := env.agentService(t)
		stream, err := agent.Tunnel(ctx)
		if err != nil {
			agentDone <- err
			return
		}

		if err := sendInit(stream, sessionKey, "cookie", "workflow", nil); err != nil {
			agentDone <- err
			return
		}

		req, err := stream.Recv()
		if err != nil {
			agentDone <- err
			return
		}

		if string(req.GetData().Payload) != "hello" {
			agentDone <- fmt.Errorf("expected 'hello', got '%s'", string(req.GetData().Payload))
			return
		}

		if err := sendData(stream, []byte("world")); err != nil {
			agentDone <- err
			return
		}

		// Wait for close or EOF
		stream.Recv()
		stream.CloseSend()
		agentDone <- nil
	}()

	// Wait for both
	select {
	case err := <-clientDone:
		if err != nil {
			t.Fatalf("client error: %v", err)
		}
	case <-ctx.Done():
		t.Fatal("client timeout")
	}

	select {
	case err := <-agentDone:
		if err != nil {
			t.Fatalf("agent error: %v", err)
		}
	case <-ctx.Done():
		t.Fatal("agent timeout")
	}
}

func TestRendezvousTimeout(t *testing.T) {
	t.Parallel()
	env := setupTestEnv(t, 100*time.Millisecond)

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	client := env.clientService(t)
	stream, err := client.Tunnel(ctx)
	if err != nil {
		t.Fatalf("failed to create stream: %v", err)
	}

	if err := sendInit(stream, "timeout-session", "cookie", "workflow", nil); err != nil {
		t.Fatalf("failed to send init: %v", err)
	}

	// Should timeout waiting for agent
	_, err = stream.Recv()
	if err == nil {
		t.Fatal("expected timeout error")
	}
	if status.Code(err) != codes.DeadlineExceeded {
		t.Logf("got error code: %v", status.Code(err))
	}
}

func TestAgentConnectsFirst(t *testing.T) {
	t.Parallel()
	env := setupTestEnv(t, 0)

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	clientDone := make(chan error, 1)
	agentDone := make(chan error, 1)

	sessionKey := "agent-first-session"

	// Agent connects first
	go func() {
		agent := env.agentService(t)
		stream, err := agent.Tunnel(ctx)
		if err != nil {
			agentDone <- err
			return
		}

		if err := sendInit(stream, sessionKey, "cookie", "workflow", nil); err != nil {
			agentDone <- err
			return
		}

		req, err := stream.Recv()
		if err != nil {
			agentDone <- err
			return
		}

		if string(req.GetData().Payload) != "ping" {
			agentDone <- fmt.Errorf("expected 'ping', got '%s'", string(req.GetData().Payload))
			return
		}

		if err := sendData(stream, []byte("pong")); err != nil {
			agentDone <- err
			return
		}

		stream.Recv()
		stream.CloseSend()
		agentDone <- nil
	}()

	// Client connects after
	go func() {
		time.Sleep(100 * time.Millisecond) // Agent connects first
		client := env.clientService(t)
		stream, err := client.Tunnel(ctx)
		if err != nil {
			clientDone <- err
			return
		}

		if err := sendInit(stream, sessionKey, "cookie", "workflow", nil); err != nil {
			clientDone <- err
			return
		}

		if err := sendData(stream, []byte("ping")); err != nil {
			clientDone <- err
			return
		}

		resp, err := stream.Recv()
		if err != nil {
			clientDone <- err
			return
		}

		if string(resp.GetData().Payload) != "pong" {
			clientDone <- fmt.Errorf("expected 'pong', got '%s'", string(resp.GetData().Payload))
			return
		}

		sendClose(stream)
		stream.CloseSend()
		clientDone <- nil
	}()

	// Wait for both
	for range 2 {
		select {
		case err := <-clientDone:
			if err != nil {
				t.Fatalf("client error: %v", err)
			}
		case err := <-agentDone:
			if err != nil {
				t.Fatalf("agent error: %v", err)
			}
		case <-ctx.Done():
			t.Fatal("timeout")
		}
	}
}

func TestDuplicateClientConnection(t *testing.T) {
	t.Parallel()
	env := setupTestEnv(t, 2*time.Second)

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	sessionKey := "dup-client-session"

	// First client
	client1 := env.clientService(t)
	stream1, err := client1.Tunnel(ctx)
	if err != nil {
		t.Fatalf("client1 failed: %v", err)
	}
	if err := sendInit(stream1, sessionKey, "cookie", "workflow", nil); err != nil {
		t.Fatalf("client1 init failed: %v", err)
	}

	// Wait for first client to register
	time.Sleep(50 * time.Millisecond)

	// Second client with same session key
	client2 := env.clientService(t)
	stream2, err := client2.Tunnel(ctx)
	if err != nil {
		t.Fatalf("client2 failed: %v", err)
	}
	if err := sendInit(stream2, sessionKey, "cookie", "workflow", nil); err != nil {
		t.Fatalf("client2 init failed: %v", err)
	}

	// Second client should get AlreadyExists error
	_, err = stream2.Recv()
	if err == nil {
		t.Fatal("expected error for duplicate client")
	}
	if status.Code(err) != codes.AlreadyExists {
		t.Logf("got code: %v (expected AlreadyExists or similar)", status.Code(err))
	}
}

func TestConcurrentSessions(t *testing.T) {
	t.Parallel()
	env := setupTestEnv(t, 0)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	numSessions := 10
	var wg sync.WaitGroup
	errs := make(chan error, numSessions*2)

	for i := range numSessions {
		wg.Add(2)
		sessionKey := fmt.Sprintf("concurrent-session-%d", i)
		testData := fmt.Sprintf("data-%d", i)

		// Client
		go func(key, data string) {
			defer wg.Done()
			client := env.clientService(t)
			stream, err := client.Tunnel(ctx)
			if err != nil {
				errs <- err
				return
			}

			if err := sendInit(stream, key, "cookie", "workflow", nil); err != nil {
				errs <- err
				return
			}

			if err := sendData(stream, []byte(data)); err != nil {
				errs <- err
				return
			}

			_, err = stream.Recv()
			if err != nil && err != io.EOF {
				errs <- err
				return
			}

			sendClose(stream)
			stream.CloseSend()
		}(sessionKey, testData)

		// Agent
		go func(key string) {
			defer wg.Done()
			time.Sleep(50 * time.Millisecond)
			agent := env.agentService(t)
			stream, err := agent.Tunnel(ctx)
			if err != nil {
				errs <- err
				return
			}

			if err := sendInit(stream, key, "cookie", "workflow", nil); err != nil {
				errs <- err
				return
			}

			req, err := stream.Recv()
			if err != nil {
				errs <- err
				return
			}
			if req.GetData() == nil {
				errs <- fmt.Errorf("expected data")
				return
			}

			if err := sendData(stream, []byte("ack")); err != nil {
				errs <- err
				return
			}

			stream.Recv()
			stream.CloseSend()
		}(sessionKey)
	}

	wg.Wait()
	close(errs)

	for err := range errs {
		if err != nil {
			t.Errorf("concurrent session error: %v", err)
		}
	}
}

func TestCloseMessageForwarded(t *testing.T) {
	t.Parallel()
	env := setupTestEnv(t, 0)

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	sessionKey := "close-forward-session"
	agentReceivedClose := make(chan bool, 1)
	clientDone := make(chan error, 1)
	agentDone := make(chan error, 1)

	// Client
	go func() {
		client := env.clientService(t)
		stream, err := client.Tunnel(ctx)
		if err != nil {
			clientDone <- err
			return
		}

		if err := sendInit(stream, sessionKey, "cookie", "workflow", nil); err != nil {
			clientDone <- err
			return
		}

		if err := sendData(stream, []byte("hello")); err != nil {
			clientDone <- err
			return
		}

		if err := sendClose(stream); err != nil {
			clientDone <- err
			return
		}

		stream.CloseSend()
		clientDone <- nil
	}()

	// Agent
	go func() {
		time.Sleep(50 * time.Millisecond)
		agent := env.agentService(t)
		stream, err := agent.Tunnel(ctx)
		if err != nil {
			agentDone <- err
			return
		}

		if err := sendInit(stream, sessionKey, "cookie", "workflow", nil); err != nil {
			agentDone <- err
			return
		}

		// Receive data
		req, err := stream.Recv()
		if err != nil {
			agentDone <- err
			return
		}
		if req.GetData() == nil {
			agentDone <- fmt.Errorf("expected data")
			return
		}

		// Receive close
		req, err = stream.Recv()
		if err == io.EOF {
			agentReceivedClose <- false
			agentDone <- nil
			return
		}
		if err != nil {
			agentDone <- err
			return
		}

		if req.GetClose() != nil {
			agentReceivedClose <- true
		} else {
			agentReceivedClose <- false
		}

		stream.CloseSend()
		agentDone <- nil
	}()

	// Wait for both
	<-clientDone
	<-agentDone

	select {
	case received := <-agentReceivedClose:
		if !received {
			t.Error("agent did not receive close message")
		}
	case <-time.After(100 * time.Millisecond):
		t.Error("timeout waiting for close check")
	}
}

func TestGetSessionInfo(t *testing.T) {
	t.Parallel()
	env := setupTestEnv(t, 0)

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	// Test non-existent session
	control := env.controlService(t)
	_, err := control.GetSessionInfo(ctx, &pb.SessionInfoRequest{SessionKey: "nonexistent"})
	if err == nil {
		t.Fatal("expected error for non-existent session")
	}
	if status.Code(err) != codes.NotFound {
		t.Errorf("expected NotFound, got %v", status.Code(err))
	}

	// Create a session and query it
	sessionKey := "info-test-session"
	workflowID := "test-workflow"

	sessionActive := make(chan struct{})

	go func() {
		client := env.clientService(t)
		stream, _ := client.Tunnel(ctx)
		sendInit(stream, sessionKey, "cookie", workflowID, nil)
		close(sessionActive)
		time.Sleep(500 * time.Millisecond)
		stream.CloseSend()
	}()

	go func() {
		time.Sleep(50 * time.Millisecond)
		agent := env.agentService(t)
		stream, _ := agent.Tunnel(ctx)
		sendInit(stream, sessionKey, "cookie", workflowID, nil)
		time.Sleep(500 * time.Millisecond)
		stream.CloseSend()
	}()

	<-sessionActive
	time.Sleep(100 * time.Millisecond)

	resp, err := control.GetSessionInfo(ctx, &pb.SessionInfoRequest{SessionKey: sessionKey})
	if err != nil {
		t.Fatalf("GetSessionInfo failed: %v", err)
	}

	if !resp.Active {
		t.Error("expected session to be active")
	}
	if resp.WorkflowId != workflowID {
		t.Errorf("expected workflow ID '%s', got '%s'", workflowID, resp.WorkflowId)
	}
	if resp.OperationType != OperationExec {
		t.Errorf("expected operation type '%s', got '%s'", OperationExec, resp.OperationType)
	}
}

func TestLargeDataTransfer(t *testing.T) {
	t.Parallel()
	env := setupTestEnv(t, 0)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	sessionKey := "large-data-session"
	dataSize := 1024 * 1024 // 1MB
	testData := make([]byte, dataSize)
	for i := range testData {
		testData[i] = byte(i % 256)
	}

	clientDone := make(chan error, 1)
	agentDone := make(chan error, 1)

	// Client
	go func() {
		client := env.clientService(t)
		stream, err := client.Tunnel(ctx)
		if err != nil {
			clientDone <- err
			return
		}

		if err := sendInit(stream, sessionKey, "cookie", "workflow", nil); err != nil {
			clientDone <- err
			return
		}

		if err := sendData(stream, testData); err != nil {
			clientDone <- err
			return
		}

		resp, err := stream.Recv()
		if err != nil {
			clientDone <- err
			return
		}

		if len(resp.GetData().Payload) != dataSize {
			clientDone <- fmt.Errorf("expected %d bytes, got %d", dataSize, len(resp.GetData().Payload))
			return
		}

		sendClose(stream)
		stream.CloseSend()
		clientDone <- nil
	}()

	// Agent
	go func() {
		time.Sleep(50 * time.Millisecond)
		agent := env.agentService(t)
		stream, err := agent.Tunnel(ctx)
		if err != nil {
			agentDone <- err
			return
		}

		if err := sendInit(stream, sessionKey, "cookie", "workflow", nil); err != nil {
			agentDone <- err
			return
		}

		req, err := stream.Recv()
		if err != nil {
			agentDone <- err
			return
		}

		if len(req.GetData().Payload) != dataSize {
			agentDone <- fmt.Errorf("expected %d bytes, got %d", dataSize, len(req.GetData().Payload))
			return
		}

		// Echo back
		if err := sendData(stream, req.GetData().Payload); err != nil {
			agentDone <- err
			return
		}

		stream.Recv()
		stream.CloseSend()
		agentDone <- nil
	}()

	select {
	case err := <-clientDone:
		if err != nil {
			t.Fatalf("client error: %v", err)
		}
	case <-ctx.Done():
		t.Fatal("client timeout")
	}

	select {
	case err := <-agentDone:
		if err != nil {
			t.Fatalf("agent error: %v", err)
		}
	case <-ctx.Done():
		t.Fatal("agent timeout")
	}
}

func TestSimultaneousDisconnect(t *testing.T) {
	t.Parallel()
	env := setupTestEnv(t, 0)

	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()

	sessionKey := "simultaneous-disconnect"

	var wg sync.WaitGroup
	wg.Add(2)

	// Client
	go func() {
		defer wg.Done()
		client := env.clientService(t)
		stream, _ := client.Tunnel(ctx)
		sendInit(stream, sessionKey, "cookie", "workflow", nil)
		for i := range 5 {
			sendData(stream, []byte(fmt.Sprintf("msg-%d", i)))
		}
		stream.CloseSend()
	}()

	// Agent
	go func() {
		defer wg.Done()
		time.Sleep(50 * time.Millisecond)
		agent := env.agentService(t)
		stream, _ := agent.Tunnel(ctx)
		sendInit(stream, sessionKey, "cookie", "workflow", nil)
		// Receive a couple then close immediately
		stream.Recv()
		stream.CloseSend()
	}()

	done := make(chan struct{})
	go func() {
		wg.Wait()
		close(done)
	}()

	select {
	case <-done:
		// Success - no deadlock
	case <-ctx.Done():
		t.Fatal("deadlock detected")
	}
}

func TestOperationTypes(t *testing.T) {
	t.Parallel()
	env := setupTestEnv(t, 0)

	tests := []struct {
		name     string
		init     *pb.TunnelInit
		wantType string
	}{
		{
			"exec",
			&pb.TunnelInit{Operation: &pb.TunnelInit_Exec{Exec: &pb.ExecOperation{}}},
			OperationExec,
		},
		{
			"portforward_tcp",
			&pb.TunnelInit{
				Operation: &pb.TunnelInit_PortForward{
					PortForward: &pb.PortForwardOperation{
						Protocol: pb.PortForwardOperation_TCP,
						Port:     8080,
					},
				},
			},
			OperationPortForward + "_TCP",
		},
		{
			"portforward_udp",
			&pb.TunnelInit{
				Operation: &pb.TunnelInit_PortForward{
					PortForward: &pb.PortForwardOperation{
						Protocol: pb.PortForwardOperation_UDP,
						Port:     8080,
					},
				},
			},
			OperationPortForward + "_UDP",
		},
		{
			"websocket",
			&pb.TunnelInit{
				Operation: &pb.TunnelInit_WebSocket{WebSocket: &pb.WebSocketOperation{}},
			},
			OperationWebSocket,
		},
		{
			"rsync",
			&pb.TunnelInit{Operation: &pb.TunnelInit_Rsync{Rsync: &pb.RsyncOperation{}}},
			OperationRsync,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			defer cancel()

			sessionKey := fmt.Sprintf("op-test-%s", tt.name)
			sessionActive := make(chan struct{})

			// Client - keep alive while we query
			go func() {
				client := env.clientService(t)
				stream, _ := client.Tunnel(ctx)
				sendInit(stream, sessionKey, "cookie", "workflow", tt.init)
				close(sessionActive)
				time.Sleep(300 * time.Millisecond) // Keep session alive
				stream.CloseSend()
			}()

			// Agent - keep alive while we query
			go func() {
				time.Sleep(50 * time.Millisecond)
				agent := env.agentService(t)
				stream, _ := agent.Tunnel(ctx)
				sendInit(stream, sessionKey, "cookie", "workflow", tt.init)
				time.Sleep(300 * time.Millisecond) // Keep session alive
				stream.CloseSend()
			}()

			<-sessionActive
			time.Sleep(100 * time.Millisecond) // Wait for rendezvous

			// Verify operation type via control service
			control := env.controlService(t)
			resp, err := control.GetSessionInfo(ctx, &pb.SessionInfoRequest{SessionKey: sessionKey})
			if err != nil {
				t.Fatalf("GetSessionInfo failed: %v", err)
			}
			if resp.OperationType != tt.wantType {
				t.Errorf("operation type = %q, want %q", resp.OperationType, tt.wantType)
			}
		})
	}
}

func TestMultipleMessagesBeforeClose(t *testing.T) {
	t.Parallel()
	env := setupTestEnv(t, 0)

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	sessionKey := "multi-msg-session"
	numMessages := 100
	clientDone := make(chan error, 1)
	agentDone := make(chan error, 1)

	// Client sends many messages
	go func() {
		client := env.clientService(t)
		stream, err := client.Tunnel(ctx)
		if err != nil {
			clientDone <- err
			return
		}

		if err := sendInit(stream, sessionKey, "cookie", "workflow", nil); err != nil {
			clientDone <- err
			return
		}

		for i := range numMessages {
			if err := sendData(stream, []byte(fmt.Sprintf("msg-%d", i))); err != nil {
				clientDone <- err
				return
			}
		}

		// Receive all responses
		for range numMessages {
			_, err := stream.Recv()
			if err != nil {
				clientDone <- err
				return
			}
		}

		sendClose(stream)
		stream.CloseSend()
		clientDone <- nil
	}()

	// Agent echoes
	go func() {
		time.Sleep(50 * time.Millisecond)
		agent := env.agentService(t)
		stream, err := agent.Tunnel(ctx)
		if err != nil {
			agentDone <- err
			return
		}

		if err := sendInit(stream, sessionKey, "cookie", "workflow", nil); err != nil {
			agentDone <- err
			return
		}

		for range numMessages {
			req, err := stream.Recv()
			if err != nil {
				agentDone <- err
				return
			}
			if err := sendData(stream, req.GetData().Payload); err != nil {
				agentDone <- err
				return
			}
		}

		stream.Recv()
		stream.CloseSend()
		agentDone <- nil
	}()

	select {
	case err := <-clientDone:
		if err != nil {
			t.Fatalf("client error: %v", err)
		}
	case <-ctx.Done():
		t.Fatal("timeout")
	}

	select {
	case err := <-agentDone:
		if err != nil {
			t.Fatalf("agent error: %v", err)
		}
	case <-ctx.Done():
		t.Fatal("timeout")
	}
}
