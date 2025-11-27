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
		MaxSessionKeyLen:  256,
		MaxCookieLen:      256,
		MaxWorkflowIDLen:  256,
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

func (e *testEnv) userService(t *testing.T) pb.RouterUserServiceClient {
	return pb.NewRouterUserServiceClient(e.dial(t))
}

func (e *testEnv) agentService(t *testing.T) pb.RouterAgentServiceClient {
	return pb.NewRouterAgentServiceClient(e.dial(t))
}

func (e *testEnv) controlService(t *testing.T) pb.RouterControlServiceClient {
	return pb.NewRouterControlServiceClient(e.dial(t))
}

// Helper functions for sending frames

// sendUserInit sends a UserInit frame. If initTemplate is nil, creates a default exec operation.
func sendUserInit(stream pb.RouterUserService_TunnelClient, sessionKey, cookie, workflowID string, initTemplate *pb.UserInit) error {
	init := &pb.UserInit{
		SessionKey: sessionKey,
		Cookie:     cookie,
		WorkflowId: workflowID,
	}
	if initTemplate == nil {
		init.Operation = &pb.UserInit_Exec{Exec: &pb.ExecOperation{}}
	} else {
		init.Operation = initTemplate.Operation
	}
	return stream.Send(&pb.UserFrame{
		Frame: &pb.UserFrame_Init{Init: init},
	})
}

// sendAgentInit sends an AgentInit frame.
func sendAgentInit(stream pb.RouterAgentService_TunnelClient, sessionKey string) error {
	return stream.Send(&pb.AgentFrame{
		Frame: &pb.AgentFrame_Init{Init: &pb.AgentInit{SessionKey: sessionKey}},
	})
}

func sendUserPayload(stream pb.RouterUserService_TunnelClient, data []byte) error {
	return stream.Send(&pb.UserFrame{
		Frame: &pb.UserFrame_Payload{Payload: data},
	})
}

func sendAgentPayload(stream pb.RouterAgentService_TunnelClient, data []byte) error {
	return stream.Send(&pb.AgentFrame{
		Frame: &pb.AgentFrame_Payload{Payload: data},
	})
}

// getUserPayload extracts payload bytes from a UserFrame
func getUserPayload(frame *pb.UserFrame) []byte {
	if p, ok := frame.Frame.(*pb.UserFrame_Payload); ok {
		return p.Payload
	}
	return nil
}

// getAgentPayload extracts payload bytes from an AgentFrame
func getAgentPayload(frame *pb.AgentFrame) []byte {
	if p, ok := frame.Frame.(*pb.AgentFrame_Payload); ok {
		return p.Payload
	}
	return nil
}

// Tests

func TestBasicExecRoundTrip(t *testing.T) {
	t.Parallel()
	env := setupTestEnv(t, 0)

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	userDone := make(chan error, 1)
	agentDone := make(chan error, 1)

	sessionKey := "test-session"

	// User
	go func() {
		user := env.userService(t)
		stream, err := user.Tunnel(ctx)
		if err != nil {
			userDone <- err
			return
		}

		if err := sendUserInit(stream, sessionKey, "cookie", "workflow", nil); err != nil {
			userDone <- err
			return
		}

		if err := sendUserPayload(stream, []byte("hello")); err != nil {
			userDone <- err
			return
		}

		resp, err := stream.Recv()
		if err != nil {
			userDone <- err
			return
		}

		if string(getUserPayload(resp)) != "world" {
			userDone <- fmt.Errorf("expected 'world', got '%s'", string(getUserPayload(resp)))
			return
		}

		stream.CloseSend()
		userDone <- nil
	}()

	// Agent
	go func() {
		time.Sleep(50 * time.Millisecond) // Let user connect first
		agent := env.agentService(t)
		stream, err := agent.Tunnel(ctx)
		if err != nil {
			agentDone <- err
			return
		}

		if err := sendAgentInit(stream, sessionKey); err != nil {
			agentDone <- err
			return
		}

		req, err := stream.Recv()
		if err != nil {
			agentDone <- err
			return
		}

		if string(getAgentPayload(req)) != "hello" {
			agentDone <- fmt.Errorf("expected 'hello', got '%s'", string(getAgentPayload(req)))
			return
		}

		if err := sendAgentPayload(stream, []byte("world")); err != nil {
			agentDone <- err
			return
		}

		// Wait for EOF (user closed)
		stream.Recv()
		stream.CloseSend()
		agentDone <- nil
	}()

	// Wait for both
	select {
	case err := <-userDone:
		if err != nil {
			t.Fatalf("user error: %v", err)
		}
	case <-ctx.Done():
		t.Fatal("user timeout")
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

	user := env.userService(t)
	stream, err := user.Tunnel(ctx)
	if err != nil {
		t.Fatalf("failed to create stream: %v", err)
	}

	if err := sendUserInit(stream, "timeout-session", "cookie", "workflow", nil); err != nil {
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

	userDone := make(chan error, 1)
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

		if err := sendAgentInit(stream, sessionKey); err != nil {
			agentDone <- err
			return
		}

		req, err := stream.Recv()
		if err != nil {
			agentDone <- err
			return
		}

		if string(getAgentPayload(req)) != "ping" {
			agentDone <- fmt.Errorf("expected 'ping', got '%s'", string(getAgentPayload(req)))
			return
		}

		if err := sendAgentPayload(stream, []byte("pong")); err != nil {
			agentDone <- err
			return
		}

		stream.Recv()
		stream.CloseSend()
		agentDone <- nil
	}()

	// User connects after
	go func() {
		time.Sleep(100 * time.Millisecond) // Agent connects first
		user := env.userService(t)
		stream, err := user.Tunnel(ctx)
		if err != nil {
			userDone <- err
			return
		}

		if err := sendUserInit(stream, sessionKey, "cookie", "workflow", nil); err != nil {
			userDone <- err
			return
		}

		if err := sendUserPayload(stream, []byte("ping")); err != nil {
			userDone <- err
			return
		}

		resp, err := stream.Recv()
		if err != nil {
			userDone <- err
			return
		}

		if string(getUserPayload(resp)) != "pong" {
			userDone <- fmt.Errorf("expected 'pong', got '%s'", string(getUserPayload(resp)))
			return
		}

		stream.CloseSend()
		userDone <- nil
	}()

	// Wait for both
	for range 2 {
		select {
		case err := <-userDone:
			if err != nil {
				t.Fatalf("user error: %v", err)
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

func TestDuplicateUserConnection(t *testing.T) {
	t.Parallel()
	env := setupTestEnv(t, 2*time.Second)

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	sessionKey := "dup-user-session"

	// First user
	user1 := env.userService(t)
	stream1, err := user1.Tunnel(ctx)
	if err != nil {
		t.Fatalf("user1 failed: %v", err)
	}
	if err := sendUserInit(stream1, sessionKey, "cookie", "workflow", nil); err != nil {
		t.Fatalf("user1 init failed: %v", err)
	}

	// Wait for first user to register
	time.Sleep(50 * time.Millisecond)

	// Second user with same session key
	user2 := env.userService(t)
	stream2, err := user2.Tunnel(ctx)
	if err != nil {
		t.Fatalf("user2 failed: %v", err)
	}
	if err := sendUserInit(stream2, sessionKey, "cookie", "workflow", nil); err != nil {
		t.Fatalf("user2 init failed: %v", err)
	}

	// Second user should get AlreadyExists error
	_, err = stream2.Recv()
	if err == nil {
		t.Fatal("expected error for duplicate user")
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

		// User
		go func(key, data string) {
			defer wg.Done()
			user := env.userService(t)
			stream, err := user.Tunnel(ctx)
			if err != nil {
				errs <- err
				return
			}

			if err := sendUserInit(stream, key, "cookie", "workflow", nil); err != nil {
				errs <- err
				return
			}

			if err := sendUserPayload(stream, []byte(data)); err != nil {
				errs <- err
				return
			}

			_, err = stream.Recv()
			if err != nil && err != io.EOF {
				errs <- err
				return
			}

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

			if err := sendAgentInit(stream, key); err != nil {
				errs <- err
				return
			}

			req, err := stream.Recv()
			if err != nil {
				errs <- err
				return
			}
			if getAgentPayload(req) == nil {
				errs <- fmt.Errorf("expected payload")
				return
			}

			if err := sendAgentPayload(stream, []byte("ack")); err != nil {
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

func TestStreamCloseSignalsEnd(t *testing.T) {
	// Test that CloseSend() properly signals end of tunnel (replaces TestCloseMessageForwarded)
	t.Parallel()
	env := setupTestEnv(t, 0)

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	sessionKey := "stream-close-session"
	agentReceivedEOF := make(chan bool, 1)
	userDone := make(chan error, 1)
	agentDone := make(chan error, 1)

	// User
	go func() {
		user := env.userService(t)
		stream, err := user.Tunnel(ctx)
		if err != nil {
			userDone <- err
			return
		}

		if err := sendUserInit(stream, sessionKey, "cookie", "workflow", nil); err != nil {
			userDone <- err
			return
		}

		if err := sendUserPayload(stream, []byte("hello")); err != nil {
			userDone <- err
			return
		}

		// Close the stream to signal end
		stream.CloseSend()
		userDone <- nil
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

		if err := sendAgentInit(stream, sessionKey); err != nil {
			agentDone <- err
			return
		}

		// Receive payload
		req, err := stream.Recv()
		if err != nil {
			agentDone <- err
			return
		}
		if getAgentPayload(req) == nil {
			agentDone <- fmt.Errorf("expected payload")
			return
		}

		// Receive EOF (user closed stream)
		_, err = stream.Recv()
		if err == io.EOF {
			agentReceivedEOF <- true
		} else {
			agentReceivedEOF <- false
		}

		stream.CloseSend()
		agentDone <- nil
	}()

	// Wait for both
	<-userDone
	<-agentDone

	select {
	case received := <-agentReceivedEOF:
		if !received {
			t.Error("agent did not receive EOF when user closed stream")
		}
	case <-time.After(100 * time.Millisecond):
		t.Error("timeout waiting for EOF check")
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

	userConnected := make(chan struct{})
	agentConnected := make(chan struct{})

	go func() {
		user := env.userService(t)
		stream, _ := user.Tunnel(ctx)
		sendUserInit(stream, sessionKey, "cookie", workflowID, nil)
		close(userConnected)
		time.Sleep(500 * time.Millisecond)
		stream.CloseSend()
	}()

	go func() {
		<-userConnected                    // Wait for user first
		time.Sleep(100 * time.Millisecond) // Give time for query below
		agent := env.agentService(t)
		stream, _ := agent.Tunnel(ctx)
		sendAgentInit(stream, sessionKey)
		close(agentConnected)
		time.Sleep(500 * time.Millisecond)
		stream.CloseSend()
	}()

	// Wait for user to connect
	<-userConnected
	time.Sleep(50 * time.Millisecond)

	// Query before agent connects - should exist but NOT be active (pre-rendezvous)
	resp, err := control.GetSessionInfo(ctx, &pb.SessionInfoRequest{SessionKey: sessionKey})
	if err != nil {
		t.Fatalf("GetSessionInfo failed (pre-rendezvous): %v", err)
	}
	if resp.Active {
		t.Error("expected session to NOT be active before rendezvous")
	}
	if resp.WorkflowId != workflowID {
		t.Errorf("expected workflow ID '%s', got '%s'", workflowID, resp.WorkflowId)
	}

	// Wait for agent to connect
	<-agentConnected
	time.Sleep(50 * time.Millisecond)

	// Query after both connected - should be active
	resp, err = control.GetSessionInfo(ctx, &pb.SessionInfoRequest{SessionKey: sessionKey})
	if err != nil {
		t.Fatalf("GetSessionInfo failed (post-rendezvous): %v", err)
	}
	if !resp.Active {
		t.Error("expected session to be active after rendezvous")
	}
	if resp.OperationType != OperationExec {
		t.Errorf("expected operation type '%s', got '%s'", OperationExec, resp.OperationType)
	}
}

func TestTerminateSession(t *testing.T) {
	t.Parallel()
	env := setupTestEnv(t, 0)

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	control := env.controlService(t)

	// Test terminating non-existent session
	resp, err := control.TerminateSession(ctx, &pb.TerminateSessionRequest{SessionKey: "nonexistent"})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if resp.Terminated {
		t.Error("expected Terminated=false for non-existent session")
	}

	// Test validation - empty session key
	_, err = control.TerminateSession(ctx, &pb.TerminateSessionRequest{SessionKey: ""})
	if err == nil {
		t.Fatal("expected error for empty session key")
	}
	if status.Code(err) != codes.InvalidArgument {
		t.Errorf("expected InvalidArgument, got %v", status.Code(err))
	}

	// Create an active session and terminate it
	sessionKey := "terminate-test-session"
	userDone := make(chan error, 1)
	agentDone := make(chan error, 1)
	userConnected := make(chan struct{})
	agentConnected := make(chan struct{})

	// User
	go func() {
		user := env.userService(t)
		stream, err := user.Tunnel(ctx)
		if err != nil {
			userDone <- err
			return
		}

		if err := sendUserInit(stream, sessionKey, "cookie", "workflow", nil); err != nil {
			userDone <- err
			return
		}
		close(userConnected)

		// Wait for data or error (termination should cause error)
		_, err = stream.Recv()
		userDone <- err // Either nil, EOF, or cancellation error
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

		if err := sendAgentInit(stream, sessionKey); err != nil {
			agentDone <- err
			return
		}
		close(agentConnected)

		// Wait for data or error (termination should cause error)
		_, err = stream.Recv()
		agentDone <- err // Either nil, EOF, or cancellation error
	}()

	// Wait for both to connect
	<-userConnected
	<-agentConnected
	time.Sleep(100 * time.Millisecond)

	// Verify session exists before termination
	infoResp, err := control.GetSessionInfo(ctx, &pb.SessionInfoRequest{SessionKey: sessionKey})
	if err != nil {
		t.Fatalf("GetSessionInfo failed: %v", err)
	}
	if !infoResp.Active {
		t.Error("expected session to be active before termination")
	}

	// Terminate the session
	resp, err = control.TerminateSession(ctx, &pb.TerminateSessionRequest{
		SessionKey: sessionKey,
		Reason:     "test termination",
	})
	if err != nil {
		t.Fatalf("TerminateSession failed: %v", err)
	}
	if !resp.Terminated {
		t.Error("expected Terminated=true")
	}

	// Verify session no longer exists
	_, err = control.GetSessionInfo(ctx, &pb.SessionInfoRequest{SessionKey: sessionKey})
	if err == nil {
		t.Error("expected error for terminated session")
	}
	if status.Code(err) != codes.NotFound {
		t.Errorf("expected NotFound, got %v", status.Code(err))
	}

	// Both user and agent should receive errors
	select {
	case <-userDone:
		// User received error or EOF - expected
	case <-time.After(2 * time.Second):
		t.Error("user did not receive termination signal")
	}

	select {
	case <-agentDone:
		// Agent received error or EOF - expected
	case <-time.After(2 * time.Second):
		t.Error("agent did not receive termination signal")
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

	userDone := make(chan error, 1)
	agentDone := make(chan error, 1)

	// User
	go func() {
		user := env.userService(t)
		stream, err := user.Tunnel(ctx)
		if err != nil {
			userDone <- err
			return
		}

		if err := sendUserInit(stream, sessionKey, "cookie", "workflow", nil); err != nil {
			userDone <- err
			return
		}

		if err := sendUserPayload(stream, testData); err != nil {
			userDone <- err
			return
		}

		resp, err := stream.Recv()
		if err != nil {
			userDone <- err
			return
		}

		if len(getUserPayload(resp)) != dataSize {
			userDone <- fmt.Errorf("expected %d bytes, got %d", dataSize, len(getUserPayload(resp)))
			return
		}

		stream.CloseSend()
		userDone <- nil
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

		if err := sendAgentInit(stream, sessionKey); err != nil {
			agentDone <- err
			return
		}

		req, err := stream.Recv()
		if err != nil {
			agentDone <- err
			return
		}

		payload := getAgentPayload(req)
		if len(payload) != dataSize {
			agentDone <- fmt.Errorf("expected %d bytes, got %d", dataSize, len(payload))
			return
		}

		// Echo back
		if err := sendAgentPayload(stream, payload); err != nil {
			agentDone <- err
			return
		}

		stream.Recv()
		stream.CloseSend()
		agentDone <- nil
	}()

	select {
	case err := <-userDone:
		if err != nil {
			t.Fatalf("user error: %v", err)
		}
	case <-ctx.Done():
		t.Fatal("user timeout")
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

	// User
	go func() {
		defer wg.Done()
		user := env.userService(t)
		stream, _ := user.Tunnel(ctx)
		sendUserInit(stream, sessionKey, "cookie", "workflow", nil)
		for i := range 5 {
			sendUserPayload(stream, []byte(fmt.Sprintf("msg-%d", i)))
		}
		stream.CloseSend()
	}()

	// Agent
	go func() {
		defer wg.Done()
		time.Sleep(50 * time.Millisecond)
		agent := env.agentService(t)
		stream, _ := agent.Tunnel(ctx)
		sendAgentInit(stream, sessionKey)
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
		init     *pb.UserInit
		wantType string
	}{
		{
			"exec",
			&pb.UserInit{Operation: &pb.UserInit_Exec{Exec: &pb.ExecOperation{}}},
			OperationExec,
		},
		{
			"portforward_tcp",
			&pb.UserInit{
				Operation: &pb.UserInit_PortForward{
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
			&pb.UserInit{
				Operation: &pb.UserInit_PortForward{
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
			&pb.UserInit{
				Operation: &pb.UserInit_WebSocket{WebSocket: &pb.WebSocketOperation{}},
			},
			OperationWebSocket,
		},
		{
			"rsync",
			&pb.UserInit{Operation: &pb.UserInit_Rsync{Rsync: &pb.RsyncOperation{}}},
			OperationRsync,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			defer cancel()

			sessionKey := fmt.Sprintf("op-test-%s", tt.name)
			sessionActive := make(chan struct{})

			// User - keep alive while we query
			go func() {
				user := env.userService(t)
				stream, _ := user.Tunnel(ctx)
				sendUserInit(stream, sessionKey, "cookie", "workflow", tt.init)
				close(sessionActive)
				time.Sleep(300 * time.Millisecond) // Keep session alive
				stream.CloseSend()
			}()

			// Agent - keep alive while we query
			go func() {
				time.Sleep(50 * time.Millisecond)
				agent := env.agentService(t)
				stream, _ := agent.Tunnel(ctx)
				sendAgentInit(stream, sessionKey)
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

func TestMultiplePayloadsBeforeClose(t *testing.T) {
	t.Parallel()
	env := setupTestEnv(t, 0)

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	sessionKey := "multi-payload-session"
	numPayloads := 100
	userDone := make(chan error, 1)
	agentDone := make(chan error, 1)

	// User sends many payloads
	go func() {
		user := env.userService(t)
		stream, err := user.Tunnel(ctx)
		if err != nil {
			userDone <- err
			return
		}

		if err := sendUserInit(stream, sessionKey, "cookie", "workflow", nil); err != nil {
			userDone <- err
			return
		}

		for i := range numPayloads {
			if err := sendUserPayload(stream, []byte(fmt.Sprintf("msg-%d", i))); err != nil {
				userDone <- err
				return
			}
		}

		// Receive all responses
		for range numPayloads {
			_, err := stream.Recv()
			if err != nil {
				userDone <- err
				return
			}
		}

		stream.CloseSend()
		userDone <- nil
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

		if err := sendAgentInit(stream, sessionKey); err != nil {
			agentDone <- err
			return
		}

		for range numPayloads {
			req, err := stream.Recv()
			if err != nil {
				agentDone <- err
				return
			}
			if err := sendAgentPayload(stream, getAgentPayload(req)); err != nil {
				agentDone <- err
				return
			}
		}

		stream.Recv()
		stream.CloseSend()
		agentDone <- nil
	}()

	select {
	case err := <-userDone:
		if err != nil {
			t.Fatalf("user error: %v", err)
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

func TestInitValidation(t *testing.T) {
	t.Parallel()
	env := setupTestEnv(t, 100*time.Millisecond)

	tests := []struct {
		name     string
		init     *pb.UserInit
		wantCode codes.Code
	}{
		{
			name:     "empty session key",
			init:     &pb.UserInit{SessionKey: "", Operation: &pb.UserInit_Exec{Exec: &pb.ExecOperation{}}},
			wantCode: codes.InvalidArgument,
		},
		{
			name:     "nil operation",
			init:     &pb.UserInit{SessionKey: "key"},
			wantCode: codes.InvalidArgument,
		},
		{
			name: "port zero",
			init: &pb.UserInit{
				SessionKey: "key",
				Operation: &pb.UserInit_PortForward{
					PortForward: &pb.PortForwardOperation{Port: 0, Protocol: pb.PortForwardOperation_TCP},
				},
			},
			wantCode: codes.InvalidArgument,
		},
		{
			name: "port too high",
			init: &pb.UserInit{
				SessionKey: "key",
				Operation: &pb.UserInit_PortForward{
					PortForward: &pb.PortForwardOperation{Port: 70000, Protocol: pb.PortForwardOperation_TCP},
				},
			},
			wantCode: codes.InvalidArgument,
		},
		{
			name: "port negative",
			init: &pb.UserInit{
				SessionKey: "key",
				Operation: &pb.UserInit_PortForward{
					PortForward: &pb.PortForwardOperation{Port: -1, Protocol: pb.PortForwardOperation_TCP},
				},
			},
			wantCode: codes.InvalidArgument,
		},
		{
			name: "protocol unspecified",
			init: &pb.UserInit{
				SessionKey: "key",
				Operation: &pb.UserInit_PortForward{
					PortForward: &pb.PortForwardOperation{Port: 8080, Protocol: pb.PortForwardOperation_UNSPECIFIED},
				},
			},
			wantCode: codes.InvalidArgument,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
			defer cancel()

			user := env.userService(t)
			stream, err := user.Tunnel(ctx)
			if err != nil {
				t.Fatalf("failed to create stream: %v", err)
			}

			// Send the invalid init
			err = stream.Send(&pb.UserFrame{
				Frame: &pb.UserFrame_Init{Init: tt.init},
			})
			if err != nil {
				t.Fatalf("failed to send init: %v", err)
			}

			// Recv should return the validation error
			_, err = stream.Recv()
			if err == nil {
				t.Fatal("expected error for invalid init")
			}
			if status.Code(err) != tt.wantCode {
				t.Errorf("got code %v, want %v (err: %v)", status.Code(err), tt.wantCode, err)
			}
		})
	}
}
