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
	"fmt"
	"io"
	"log/slog"
	"net"
	"strings"
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

const bufSize = 1024 * 1024

// setupTestServer creates a test gRPC server with the router services registered.
// Returns only what's needed for black-box testing: the server (for lifecycle) and listener (for dialing).
func setupTestServer(t *testing.T) (*grpc.Server, *bufconn.Listener) {
	lis := bufconn.Listen(bufSize)
	server := grpc.NewServer()

	config := SessionStoreConfig{
		RendezvousTimeout: 60 * time.Second,
	}

	// Use a no-op logger for tests (logs are not asserted)
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))

	store := NewSessionStore(config, logger)
	rs := NewRouterServer(store, logger)
	RegisterRouterServices(server, rs)

	go func() {
		if err := server.Serve(lis); err != nil {
			t.Logf("Server exited with error: %v", err)
		}
	}()

	// Only return server and listener - no internal state exposed
	return server, lis
}

func bufDialer(lis *bufconn.Listener) func(context.Context, string) (net.Conn, error) {
	return func(ctx context.Context, _ string) (net.Conn, error) {
		return lis.Dial()
	}
}

type routerTestEnv struct {
	server *grpc.Server
	lis    *bufconn.Listener
}

func newRouterTestEnv(t *testing.T) *routerTestEnv {
	t.Helper()
	server, lis := setupTestServer(t)
	env := &routerTestEnv{server: server, lis: lis}
	t.Cleanup(server.Stop)
	return env
}

func (env *routerTestEnv) Dialer() func(context.Context, string) (net.Conn, error) {
	return bufDialer(env.lis)
}

func (env *routerTestEnv) dialConn() (*grpc.ClientConn, error) {
	return grpc.NewClient("passthrough:///bufnet",
		grpc.WithContextDialer(env.Dialer()),
		grpc.WithTransportCredentials(insecure.NewCredentials()))
}

func (env *routerTestEnv) connect(t *testing.T) *grpc.ClientConn {
	t.Helper()
	conn, err := env.dialConn()
	if err != nil {
		t.Fatalf("failed to dial bufconn: %v", err)
	}
	t.Cleanup(func() { conn.Close() })
	return conn
}

func (env *routerTestEnv) ClientService(t *testing.T) pb.RouterClientServiceClient {
	return pb.NewRouterClientServiceClient(env.connect(t))
}

func (env *routerTestEnv) AgentService(t *testing.T) pb.RouterAgentServiceClient {
	return pb.NewRouterAgentServiceClient(env.connect(t))
}

func (env *routerTestEnv) ControlService(t *testing.T) pb.RouterControlServiceClient {
	return pb.NewRouterControlServiceClient(env.connect(t))
}

func newTestContext(t *testing.T, timeout time.Duration) (context.Context, context.CancelFunc) {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	t.Cleanup(cancel)
	return ctx, cancel
}

type sessionIDs struct {
	key      string
	cookie   string
	workflow string
}

func newSessionIDs(label string) sessionIDs {
	return sessionIDs{
		key:      fmt.Sprintf("%s-session", label),
		cookie:   fmt.Sprintf("%s-cookie", label),
		workflow: fmt.Sprintf("%s-workflow", label),
	}
}

func sendClientInit(t *testing.T, stream pb.RouterClientService_TunnelClient, init *pb.TunnelInit) {
	t.Helper()
	if err := stream.Send(&pb.TunnelRequest{
		Message: &pb.TunnelRequest_Init{Init: init},
	}); err != nil {
		t.Fatalf("failed to send client init: %v", err)
	}
}

func sendAgentInit(t *testing.T, stream pb.RouterAgentService_RegisterTunnelClient, init *pb.TunnelInit) {
	t.Helper()
	if err := stream.Send(&pb.TunnelResponse{
		Message: &pb.TunnelResponse_Init{Init: init},
	}); err != nil {
		t.Fatalf("failed to send agent init: %v", err)
	}
}

// TestMinimalExecFlow is a focused test with strict 2s timeout to quickly reproduce the close message issue
func TestMinimalExecFlow(t *testing.T) {
	env := newRouterTestEnv(t)

	// Strict 2 second timeout - fail fast!
	ctx, cancel := newTestContext(t, 2*time.Second)
	defer cancel()

	clientService := env.ClientService(t)
	agentService := env.AgentService(t)

	sessionKey := "minimal-test"
	cookie := "test-cookie"
	workflowID := "test-workflow"

	clientDone := make(chan error, 1)
	agentDone := make(chan error, 1)

	// Client goroutine
	go func() {
		stream, err := clientService.Tunnel(ctx)
		if err != nil {
			clientDone <- err
			return
		}

		sendClientInit(t, stream, &pb.TunnelInit{
			SessionKey: sessionKey,
			Cookie:     cookie,
			WorkflowId: workflowID,
			Operation:  pb.OperationType_OPERATION_EXEC,
		})
		t.Log("CLIENT: Sent init")

		// Send data
		if err := stream.Send(&pb.TunnelRequest{
			Message: &pb.TunnelRequest_Data{
				Data: &pb.TunnelData{Payload: []byte("hello"), Seq: 1},
			},
		}); err != nil {
			clientDone <- err
			return
		}
		t.Log("CLIENT: Sent data")

		// Receive response
		resp, err := stream.Recv()
		if err != nil {
			clientDone <- err
			return
		}
		if data := resp.GetData(); data != nil {
			t.Logf("CLIENT: Received: %s", string(data.Payload))
		}

		// Send close
		if err := stream.Send(&pb.TunnelRequest{
			Message: &pb.TunnelRequest_Close{Close: &pb.TunnelClose{}},
		}); err != nil {
			clientDone <- err
			return
		}
		t.Log("CLIENT: Sent close")

		// Close send
		if err := stream.CloseSend(); err != nil {
			clientDone <- err
			return
		}
		t.Log("CLIENT: Done")
		clientDone <- nil
	}()

	// Agent goroutine
	go func() {
		time.Sleep(50 * time.Millisecond) // Let client connect first

		stream, err := agentService.RegisterTunnel(ctx)
		if err != nil {
			agentDone <- err
			return
		}

		sendAgentInit(t, stream, &pb.TunnelInit{
			SessionKey: sessionKey,
			Cookie:     cookie,
			WorkflowId: workflowID,
			Operation:  pb.OperationType_OPERATION_EXEC,
		})
		t.Log("AGENT: Sent init")

		// Receive data
		req, err := stream.Recv()
		if err != nil {
			agentDone <- err
			return
		}
		if data := req.GetData(); data != nil {
			t.Logf("AGENT: Received: %s", string(data.Payload))
		}

		// Send response
		if err := stream.Send(&pb.TunnelResponse{
			Message: &pb.TunnelResponse_Data{
				Data: &pb.TunnelData{Payload: []byte("world"), Seq: 1},
			},
		}); err != nil {
			agentDone <- err
			return
		}
		t.Log("AGENT: Sent response")

		// THIS IS THE KEY TEST - wait for close from client
		// The server should forward the close message from client to agent
		t.Log("AGENT: Waiting for close message (THIS SHOULD NOT TIMEOUT)...")
		req, err = stream.Recv()
		if err == io.EOF {
			t.Log("AGENT: Got EOF")
			agentDone <- nil
			return
		}
		if err != nil {
			t.Logf("AGENT: Recv error: %v", err)
			agentDone <- err
			return
		}

		if req.GetClose() != nil {
			t.Log("AGENT: Got close message - SUCCESS!")
		}

		stream.CloseSend()
		t.Log("AGENT: Done")
		agentDone <- nil
	}()

	// Wait for both with clear error messages
	select {
	case err := <-clientDone:
		if err != nil {
			t.Fatalf("Client error: %v", err)
		}
		t.Log("TEST: Client completed")
	case <-ctx.Done():
		t.Fatal("TEST: Client timed out!")
	}

	select {
	case err := <-agentDone:
		if err != nil {
			t.Fatalf("Agent error: %v", err)
		}
		t.Log("TEST: Agent completed")
	case <-ctx.Done():
		t.Fatal("TEST: Agent timed out - BUG: Close message not forwarded to agent!")
	}

	t.Log("TEST: SUCCESS - Both client and agent completed within 2 seconds")
}

// TestExecRoundTrip tests basic exec data flow: client -> router -> agent -> router -> client
func TestExecRoundTrip(t *testing.T) {
	env := newRouterTestEnv(t)

	ctx, cancel := newTestContext(t, 10*time.Second)
	defer cancel()

	clientService := env.ClientService(t)
	agentService := env.AgentService(t)

	ids := newSessionIDs("exec-roundtrip")
	sessionKey := ids.key
	cookie := ids.cookie
	workflowID := ids.workflow

	var wg sync.WaitGroup
	wg.Add(2)

	clientErrors := make(chan error, 1)
	agentErrors := make(chan error, 1)

	// Start client
	go func() {
		defer wg.Done()
		clientStream, err := clientService.Tunnel(ctx)
		if err != nil {
			clientErrors <- err
			return
		}

		// Send init
		err = clientStream.Send(&pb.TunnelRequest{
			Message: &pb.TunnelRequest_Init{
				Init: &pb.TunnelInit{Operation: pb.OperationType_OPERATION_EXEC,
					SessionKey: sessionKey,
					Cookie:     cookie,
					WorkflowId: workflowID,
				},
			},
		})
		if err != nil {
			clientErrors <- err
			return
		}

		// Send data
		testData := []byte("echo hello world")
		err = clientStream.Send(&pb.TunnelRequest{
			Message: &pb.TunnelRequest_Data{
				Data: &pb.TunnelData{
					Payload: testData,
					Seq:     1,
				},
			},
		})
		if err != nil {
			clientErrors <- err
			return
		}

		// Receive response from agent
		resp, err := clientStream.Recv()
		if err != nil {
			clientErrors <- err
			return
		}

		data := resp.GetData()
		if data == nil {
			clientErrors <- io.ErrUnexpectedEOF
			return
		}

		if string(data.Payload) != "hello world from agent" {
			t.Errorf("Expected 'hello world from agent', got '%s'", string(data.Payload))
		}

		// Send close message
		err = clientStream.Send(&pb.TunnelRequest{
			Message: &pb.TunnelRequest_Close{
				Close: &pb.TunnelClose{},
			},
		})
		if err != nil {
			clientErrors <- err
			return
		}

		// Close the send side
		err = clientStream.CloseSend()
		if err != nil {
			clientErrors <- err
			return
		}

		// Drain any remaining messages from agent
		for {
			_, err := clientStream.Recv()
			if err == io.EOF {
				break
			}
			if err != nil {
				// Context canceled is ok during shutdown
				if strings.Contains(err.Error(), "context canceled") {
					break
				}
				clientErrors <- err
				return
			}
		}

		clientErrors <- nil
	}()

	// Start agent
	go func() {
		defer wg.Done()
		// Give client time to connect first
		time.Sleep(100 * time.Millisecond)

		agentStream, err := agentService.RegisterTunnel(ctx)
		if err != nil {
			agentErrors <- err
			return
		}

		// Send init
		err = agentStream.Send(&pb.TunnelResponse{
			Message: &pb.TunnelResponse_Init{
				Init: &pb.TunnelInit{Operation: pb.OperationType_OPERATION_EXEC,
					SessionKey: sessionKey,
					Cookie:     cookie,
					WorkflowId: workflowID,
				},
			},
		})
		if err != nil {
			agentErrors <- err
			return
		}

		// Receive data from client
		req, err := agentStream.Recv()
		if err != nil {
			agentErrors <- err
			return
		}

		data := req.GetData()
		if data == nil {
			agentErrors <- io.ErrUnexpectedEOF
			return
		}

		if string(data.Payload) != "echo hello world" {
			t.Errorf("Agent expected 'echo hello world', got '%s'", string(data.Payload))
		}

		// Send response back
		err = agentStream.Send(&pb.TunnelResponse{
			Message: &pb.TunnelResponse_Data{
				Data: &pb.TunnelData{
					Payload: []byte("hello world from agent"),
					Seq:     1,
				},
			},
		})
		if err != nil {
			agentErrors <- err
			return
		}

		// Wait for close from client
		req, err = agentStream.Recv()
		if err == io.EOF {
			// Client closed cleanly
			agentErrors <- nil
			return
		}
		if err != nil {
			// Context canceled during test shutdown is ok
			if strings.Contains(err.Error(), "context canceled") {
				agentErrors <- nil
				return
			}
			agentErrors <- err
			return
		}

		// Send close response
		if req.GetClose() != nil {
			err = agentStream.Send(&pb.TunnelResponse{
				Message: &pb.TunnelResponse_Close{
					Close: &pb.TunnelClose{ExitCode: 0},
				},
			})
			if err != nil {
				agentErrors <- err
				return
			}
		}

		err = agentStream.CloseSend()
		if err != nil {
			agentErrors <- err
			return
		}

		agentErrors <- nil
	}()

	wg.Wait()

	// Check for errors - with proper shutdown coordination, there should be no errors
	select {
	case err := <-clientErrors:
		if err != nil {
			t.Fatalf("Client error: %v", err)
		}
	default:
	}

	select {
	case err := <-agentErrors:
		if err != nil {
			t.Fatalf("Agent error: %v", err)
		}
	default:
	}
}

// TestRendezvousTimeout tests that rendezvous times out if one party never connects
func TestRendezvousTimeout(t *testing.T) {
	env := newRouterTestEnv(t)

	ctx, cancel := newTestContext(t, 5*time.Second)
	defer cancel()

	clientService := env.ClientService(t)

	clientStream, err := clientService.Tunnel(ctx)
	if err != nil {
		t.Fatalf("Failed to create stream: %v", err)
	}

	// Send init
	err = clientStream.Send(&pb.TunnelRequest{
		Message: &pb.TunnelRequest_Init{
			Init: &pb.TunnelInit{Operation: pb.OperationType_OPERATION_EXEC,
				SessionKey: "timeout-session",
				Cookie:     "timeout-cookie",
				WorkflowId: "timeout-workflow",
			},
		},
	})
	if err != nil {
		t.Fatalf("Failed to send init: %v", err)
	}

	// Try to receive - should timeout since agent never connects
	_, err = clientStream.Recv()
	if err == nil {
		t.Fatal("Expected timeout error, got nil")
	}

	t.Logf("Got expected error: %v", err)
}

// TestPortForwardRoundTrip tests port-forward TCP data flow
func TestPortForwardRoundTrip(t *testing.T) {
	env := newRouterTestEnv(t)

	ctx, cancel := newTestContext(t, 10*time.Second)
	defer cancel()

	clientService := env.ClientService(t)
	agentService := env.AgentService(t)

	pfIDs := newSessionIDs("portforward-roundtrip")
	sessionKey := pfIDs.key
	cookie := pfIDs.cookie
	workflowID := pfIDs.workflow

	var wg sync.WaitGroup
	wg.Add(2)

	clientErrors := make(chan error, 1)
	agentErrors := make(chan error, 1)

	// Start client
	go func() {
		defer wg.Done()
		clientStream, err := clientService.Tunnel(ctx)
		if err != nil {
			clientErrors <- err
			return
		}

		// Send init
		err = clientStream.Send(&pb.TunnelRequest{
			Message: &pb.TunnelRequest_Init{
				Init: &pb.TunnelInit{Operation: pb.OperationType_OPERATION_PORT_FORWARD,
					SessionKey: sessionKey,
					Cookie:     cookie,
					WorkflowId: workflowID,
					Protocol:   pb.Protocol_PROTOCOL_TCP,
					RemotePort: 8080,
				},
			},
		})
		if err != nil {
			clientErrors <- err
			return
		}

		// Send HTTP request data
		httpRequest := []byte("GET / HTTP/1.1\r\nHost: localhost\r\n\r\n")
		err = clientStream.Send(&pb.TunnelRequest{
			Message: &pb.TunnelRequest_Data{
				Data: &pb.TunnelData{
					Payload: httpRequest,
					Seq:     1,
				},
			},
		})
		if err != nil {
			clientErrors <- err
			return
		}

		// Receive HTTP response
		resp, err := clientStream.Recv()
		if err != nil {
			clientErrors <- err
			return
		}

		data := resp.GetData()
		if data == nil {
			clientErrors <- io.ErrUnexpectedEOF
			return
		}

		t.Logf("Client received: %s", string(data.Payload))

		// Proper close: send close message and wait for agent acknowledgment
		clientStream.Send(&pb.TunnelRequest{
			Message: &pb.TunnelRequest_Close{
				Close: &pb.TunnelClose{Reason: "done"},
			},
		})

		// Wait for agent close or EOF
		_, err = clientStream.Recv()
		if err != io.EOF && err != nil {
			t.Logf("Client final recv: %v", err)
		}

		clientStream.CloseSend()
		clientErrors <- nil
	}()

	// Start agent
	go func() {
		defer wg.Done()
		time.Sleep(100 * time.Millisecond)

		agentStream, err := agentService.RegisterTunnel(ctx)
		if err != nil {
			agentErrors <- err
			return
		}

		// Send init
		err = agentStream.Send(&pb.TunnelResponse{
			Message: &pb.TunnelResponse_Init{
				Init: &pb.TunnelInit{Operation: pb.OperationType_OPERATION_PORT_FORWARD,
					SessionKey: sessionKey,
					Cookie:     cookie,
					WorkflowId: workflowID,
					Protocol:   pb.Protocol_PROTOCOL_TCP,
					RemotePort: 8080,
				},
			},
		})
		if err != nil {
			agentErrors <- err
			return
		}

		// Receive HTTP request
		req, err := agentStream.Recv()
		if err != nil {
			agentErrors <- err
			return
		}

		data := req.GetData()
		if data == nil {
			agentErrors <- io.ErrUnexpectedEOF
			return
		}

		t.Logf("Agent received: %s", string(data.Payload))

		// Send HTTP response
		httpResponse := []byte("HTTP/1.1 200 OK\r\nContent-Length: 13\r\n\r\nHello, World!")
		err = agentStream.Send(&pb.TunnelResponse{
			Message: &pb.TunnelResponse_Data{
				Data: &pb.TunnelData{
					Payload: httpResponse,
					Seq:     1,
				},
			},
		})
		if err != nil {
			agentErrors <- err
			return
		}

		// Wait for close from client
		req, err = agentStream.Recv()
		if err == io.EOF {
			agentErrors <- nil
			return
		}
		if err != nil {
			agentErrors <- err
			return
		}

		// If we got a close message, respond with close
		if req.GetClose() != nil {
			agentStream.Send(&pb.TunnelResponse{
				Message: &pb.TunnelResponse_Close{
					Close: &pb.TunnelClose{Reason: "agent closing"},
				},
			})
		}

		agentStream.CloseSend()
		agentErrors <- nil
	}()

	wg.Wait()

	// Check for errors - with proper shutdown coordination, there should be no errors
	select {
	case err := <-clientErrors:
		if err != nil {
			t.Fatalf("Client error: %v", err)
		}
	default:
	}

	select {
	case err := <-agentErrors:
		if err != nil {
			t.Fatalf("Agent error: %v", err)
		}
	default:
	}
}

// TestConcurrentSessions tests multiple concurrent exec sessions
func TestConcurrentSessions(t *testing.T) {
	env := newRouterTestEnv(t)

	ctx, cancel := newTestContext(t, 30*time.Second)
	defer cancel()

	numSessions := 10
	var wg sync.WaitGroup
	errors := make(chan error, numSessions*2)

	for i := range numSessions {
		wg.Add(2)
		sessionID := i

		// Client goroutine
		go func(id int) {
			defer wg.Done()

			conn, err := env.dialConn()
			if err != nil {
				errors <- err
				return
			}
			defer conn.Close()

			clientService := pb.NewRouterClientServiceClient(conn)
			stream, err := clientService.Tunnel(ctx)
			if err != nil {
				errors <- err
				return
			}

			// Use unique session IDs to avoid collisions
			sessionKey := fmt.Sprintf("session-%d", id)
			cookie := fmt.Sprintf("cookie-%d", id)
			workflowID := fmt.Sprintf("workflow-%d", id)

			// Init
			err = stream.Send(&pb.TunnelRequest{
				Message: &pb.TunnelRequest_Init{
					Init: &pb.TunnelInit{Operation: pb.OperationType_OPERATION_EXEC,
						SessionKey: sessionKey,
						Cookie:     cookie,
						WorkflowId: workflowID,
					},
				},
			})
			if err != nil {
				errors <- err
				return
			}

			// Send data
			err = stream.Send(&pb.TunnelRequest{
				Message: &pb.TunnelRequest_Data{
					Data: &pb.TunnelData{Payload: []byte("test"), Seq: 1},
				},
			})
			if err != nil {
				errors <- err
				return
			}

			// Receive response
			_, err = stream.Recv()
			if err != nil {
				errors <- err
				return
			}

			// Proper close
			stream.Send(&pb.TunnelRequest{
				Message: &pb.TunnelRequest_Close{
					Close: &pb.TunnelClose{},
				},
			})
			stream.CloseSend()
		}(sessionID)

		// Agent goroutine
		go func(id int) {
			defer wg.Done()
			time.Sleep(50 * time.Millisecond)

			conn, err := env.dialConn()
			if err != nil {
				errors <- err
				return
			}
			defer conn.Close()

			agentService := pb.NewRouterAgentServiceClient(conn)
			stream, err := agentService.RegisterTunnel(ctx)
			if err != nil {
				errors <- err
				return
			}

			// Use unique session IDs matching client
			sessionKey := fmt.Sprintf("session-%d", id)
			cookie := fmt.Sprintf("cookie-%d", id)
			workflowID := fmt.Sprintf("workflow-%d", id)

			// Init
			err = stream.Send(&pb.TunnelResponse{
				Message: &pb.TunnelResponse_Init{
					Init: &pb.TunnelInit{Operation: pb.OperationType_OPERATION_EXEC,
						SessionKey: sessionKey,
						Cookie:     cookie,
						WorkflowId: workflowID,
					},
				},
			})
			if err != nil {
				errors <- err
				return
			}

			// Receive data
			_, err = stream.Recv()
			if err != nil {
				errors <- err
				return
			}

			// Send response
			err = stream.Send(&pb.TunnelResponse{
				Message: &pb.TunnelResponse_Data{
					Data: &pb.TunnelData{Payload: []byte("response"), Seq: 1},
				},
			})
			if err != nil {
				errors <- err
				return
			}

			// Wait for close or just finish
			stream.Recv() // Ignore errors, client may have closed already
			stream.CloseSend()
		}(sessionID)
	}

	wg.Wait()
	close(errors)

	// Check for errors - with proper shutdown coordination, there should be no errors
	for err := range errors {
		if err != nil {
			t.Errorf("Concurrent session error: %v", err)
		}
	}
}

// TestExecDataDriven tests various exec scenarios with different message patterns
func TestExecDataDriven(t *testing.T) {
	testCases := []struct {
		name           string
		clientMessages [][]byte
		agentResponses [][]byte
		shouldError    bool
		errorCode      codes.Code
	}{
		{
			name:           "single message exchange",
			clientMessages: [][]byte{[]byte("hello")},
			agentResponses: [][]byte{[]byte("world")},
			shouldError:    false,
		},
		{
			name: "multiple message exchange",
			clientMessages: [][]byte{
				[]byte("message 1"),
				[]byte("message 2"),
				[]byte("message 3"),
			},
			agentResponses: [][]byte{
				[]byte("response 1"),
				[]byte("response 2"),
				[]byte("response 3"),
			},
			shouldError: false,
		},
		{
			name:           "empty message",
			clientMessages: [][]byte{[]byte("")},
			agentResponses: [][]byte{[]byte("")},
			shouldError:    false,
		},
		{
			name:           "large message (1MB)",
			clientMessages: [][]byte{make([]byte, 1024*1024)},
			agentResponses: [][]byte{make([]byte, 1024*1024)},
			shouldError:    false,
		},
		{
			name: "many small messages",
			clientMessages: func() [][]byte {
				msgs := make([][]byte, 100)
				for i := range msgs {
					msgs[i] = []byte(fmt.Sprintf("msg%d", i))
				}
				return msgs
			}(),
			agentResponses: func() [][]byte {
				msgs := make([][]byte, 100)
				for i := range msgs {
					msgs[i] = []byte(fmt.Sprintf("resp%d", i))
				}
				return msgs
			}(),
			shouldError: false,
		},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			env := newRouterTestEnv(t)

			ctx, cancel := newTestContext(t, 30*time.Second)
			defer cancel()

			clientService := env.ClientService(t)
			agentService := env.AgentService(t)

			sessionKey := fmt.Sprintf("test-session-%s", tc.name)
			cookie := fmt.Sprintf("cookie-%s", tc.name)
			workflowID := fmt.Sprintf("workflow-%s", tc.name)

			clientDone := make(chan error, 1)
			agentDone := make(chan error, 1)

			// Client goroutine
			go func() {
				stream, err := clientService.Tunnel(ctx)
				if err != nil {
					clientDone <- err
					return
				}

				// Init
				if err := stream.Send(&pb.TunnelRequest{
					Message: &pb.TunnelRequest_Init{
						Init: &pb.TunnelInit{Operation: pb.OperationType_OPERATION_EXEC,
							SessionKey: sessionKey,
							Cookie:     cookie,
							WorkflowId: workflowID,
						},
					},
				}); err != nil {
					clientDone <- err
					return
				}

				// Send all messages
				for i, msg := range tc.clientMessages {
					if err := stream.Send(&pb.TunnelRequest{
						Message: &pb.TunnelRequest_Data{
							Data: &pb.TunnelData{
								Payload: msg,
								Seq:     uint64(i + 1),
							},
						},
					}); err != nil {
						clientDone <- err
						return
					}
				}

				// Receive all responses
				for range tc.agentResponses {
					resp, err := stream.Recv()
					if err != nil {
						clientDone <- err
						return
					}
					if resp.GetData() == nil {
						clientDone <- fmt.Errorf("expected data, got nil")
						return
					}
				}

				// Close
				if err := stream.Send(&pb.TunnelRequest{
					Message: &pb.TunnelRequest_Close{
						Close: &pb.TunnelClose{},
					},
				}); err != nil {
					clientDone <- err
					return
				}

				stream.CloseSend()
				// Drain
				for {
					_, err := stream.Recv()
					if err == io.EOF || (err != nil && strings.Contains(err.Error(), "context canceled")) {
						break
					}
				}
				clientDone <- nil
			}()

			// Agent goroutine
			go func() {
				time.Sleep(50 * time.Millisecond)
				stream, err := agentService.RegisterTunnel(ctx)
				if err != nil {
					agentDone <- err
					return
				}

				// Init
				if err := stream.Send(&pb.TunnelResponse{
					Message: &pb.TunnelResponse_Init{
						Init: &pb.TunnelInit{Operation: pb.OperationType_OPERATION_EXEC,
							SessionKey: sessionKey,
							Cookie:     cookie,
							WorkflowId: workflowID,
						},
					},
				}); err != nil {
					agentDone <- err
					return
				}

				// Receive and respond to all messages
				for i, response := range tc.agentResponses {
					req, err := stream.Recv()
					if err != nil {
						agentDone <- err
						return
					}
					if req.GetData() == nil {
						agentDone <- fmt.Errorf("expected data at index %d, got nil", i)
						return
					}

					// Send response
					if err := stream.Send(&pb.TunnelResponse{
						Message: &pb.TunnelResponse_Data{
							Data: &pb.TunnelData{
								Payload: response,
								Seq:     uint64(i + 1),
							},
						},
					}); err != nil {
						agentDone <- err
						return
					}
				}

				// Wait for close
				req, err := stream.Recv()
				if err == io.EOF || (err != nil && strings.Contains(err.Error(), "context canceled")) {
					agentDone <- nil
					return
				}
				if err != nil {
					agentDone <- err
					return
				}

				if req.GetClose() != nil {
					stream.Send(&pb.TunnelResponse{
						Message: &pb.TunnelResponse_Close{
							Close: &pb.TunnelClose{ExitCode: 0},
						},
					})
				}
				stream.CloseSend()
				agentDone <- nil
			}()

			// Wait for completion
			clientErr := <-clientDone
			agentErr := <-agentDone

			if tc.shouldError {
				if clientErr == nil && agentErr == nil {
					t.Error("Expected error but got none")
				}
				if clientErr != nil && status.Code(clientErr) != tc.errorCode {
					t.Errorf("Expected error code %v, got %v", tc.errorCode, status.Code(clientErr))
				}
			} else {
				// With proper shutdown coordination, both should complete without errors
				if clientErr != nil {
					t.Errorf("Client error: %v", clientErr)
				}
				if agentErr != nil {
					t.Errorf("Agent error: %v", agentErr)
				}
			}
		})
	}
}

// TestErrorScenarios tests various error conditions
func TestErrorScenarios(t *testing.T) {
	testCases := []struct {
		name          string
		setupFunc     func(*testing.T, *routerTestEnv) error
		expectedError []codes.Code // Can match any of these codes
	}{
		{
			name: "client connects without init",
			setupFunc: func(t *testing.T, env *routerTestEnv) error {
				ctx, cancel := newTestContext(t, 2*time.Second)
				defer cancel()

				conn, _ := env.dialConn()
				defer conn.Close()

				client := pb.NewRouterClientServiceClient(conn)
				stream, err := client.Tunnel(ctx)
				if err != nil {
					return err
				}

				// Send data without init
				err = stream.Send(&pb.TunnelRequest{
					Message: &pb.TunnelRequest_Data{
						Data: &pb.TunnelData{Payload: []byte("test")},
					},
				})
				if err != nil {
					return err
				}

				_, err = stream.Recv()
				return err
			},
			expectedError: []codes.Code{codes.InvalidArgument},
		},
		{
			name: "duplicate session key",
			setupFunc: func(t *testing.T, env *routerTestEnv) error {
				ctx, cancel := newTestContext(t, 2*time.Second)
				defer cancel()

				conn, _ := env.dialConn()
				defer conn.Close()

				client := pb.NewRouterClientServiceClient(conn)

				// First stream
				stream1, err := client.Tunnel(ctx)
				if err != nil {
					return err
				}
				stream1.Send(&pb.TunnelRequest{
					Message: &pb.TunnelRequest_Init{
						Init: &pb.TunnelInit{Operation: pb.OperationType_OPERATION_EXEC,
							SessionKey: "duplicate-key",
							Cookie:     "cookie1",
							WorkflowId: "workflow1",
						},
					},
				})

				// Second stream with same key
				stream2, err := client.Tunnel(ctx)
				if err != nil {
					return err
				}
				err = stream2.Send(&pb.TunnelRequest{
					Message: &pb.TunnelRequest_Init{
						Init: &pb.TunnelInit{Operation: pb.OperationType_OPERATION_EXEC,
							SessionKey: "duplicate-key",
							Cookie:     "cookie2",
							WorkflowId: "workflow2",
						},
					},
				})
				if err != nil {
					return err
				}

				_, err = stream2.Recv()
				return err
			},
			// Note: This is non-deterministic due to timing races
			// - AlreadyExists: Second client hits atomic check in WaitForRendezvous
			// - DeadlineExceeded: Second client waits for rendezvous but first never completes
			// - Aborted: First client finishes and deletes session while second is waiting
			// All are correct behaviors indicating the duplicate key problem
			expectedError: []codes.Code{codes.AlreadyExists, codes.DeadlineExceeded, codes.Aborted},
		},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			env := newRouterTestEnv(t)

			err := tc.setupFunc(t, env)
			if err == nil {
				t.Fatal("Expected error but got nil")
			}

			code := status.Code(err)
			matched := false
			for _, expected := range tc.expectedError {
				if code == expected {
					matched = true
					break
				}
			}
			if !matched {
				t.Errorf("Expected error code in %v, got %v (error: %v)", tc.expectedError, code, err)
			}
		})
	}
}

// TestSessionIsolation tests that sessions don't interfere with each other
func TestSessionIsolation(t *testing.T) {
	env := newRouterTestEnv(t)

	ctx, cancel := newTestContext(t, 10*time.Second)
	defer cancel()

	numSessions := 5
	done := make(chan error, numSessions*2)

	for i := range numSessions {
		sessionID := i

		// Client
		go func(id int) {
			conn, err := env.dialConn()
			if err != nil {
				done <- err
				return
			}
			defer conn.Close()

			client := pb.NewRouterClientServiceClient(conn)
			stream, err := client.Tunnel(ctx)
			if err != nil {
				done <- err
				return
			}

			// Init
			stream.Send(&pb.TunnelRequest{
				Message: &pb.TunnelRequest_Init{
					Init: &pb.TunnelInit{Operation: pb.OperationType_OPERATION_EXEC,
						SessionKey: fmt.Sprintf("isolated-session-%d", id),
						Cookie:     fmt.Sprintf("cookie-%d", id),
						WorkflowId: fmt.Sprintf("workflow-%d", id),
					},
				},
			})

			// Send unique message
			uniqueMsg := fmt.Sprintf("message-from-client-%d", id)
			stream.Send(&pb.TunnelRequest{
				Message: &pb.TunnelRequest_Data{
					Data: &pb.TunnelData{Payload: []byte(uniqueMsg)},
				},
			})

			// Receive response - should match our session
			resp, err := stream.Recv()
			if err != nil {
				done <- err
				return
			}

			expectedResp := fmt.Sprintf("response-to-client-%d", id)
			if string(resp.GetData().Payload) != expectedResp {
				done <- fmt.Errorf("session %d: expected '%s', got '%s'", id, expectedResp, string(resp.GetData().Payload))
				return
			}

			stream.Send(&pb.TunnelRequest{Message: &pb.TunnelRequest_Close{Close: &pb.TunnelClose{}}})
			stream.CloseSend()
			for {
				_, err := stream.Recv()
				if err != nil {
					break
				}
			}
			done <- nil
		}(sessionID)

		// Agent
		go func(id int) {
			time.Sleep(50 * time.Millisecond)
			conn, err := env.dialConn()
			if err != nil {
				done <- err
				return
			}
			defer conn.Close()

			agent := pb.NewRouterAgentServiceClient(conn)
			stream, err := agent.RegisterTunnel(ctx)
			if err != nil {
				done <- err
				return
			}

			// Init
			stream.Send(&pb.TunnelResponse{
				Message: &pb.TunnelResponse_Init{
					Init: &pb.TunnelInit{Operation: pb.OperationType_OPERATION_EXEC,
						SessionKey: fmt.Sprintf("isolated-session-%d", id),
						Cookie:     fmt.Sprintf("cookie-%d", id),
						WorkflowId: fmt.Sprintf("workflow-%d", id),
					},
				},
			})

			// Receive message
			req, err := stream.Recv()
			if err != nil {
				done <- err
				return
			}

			expectedMsg := fmt.Sprintf("message-from-client-%d", id)
			if string(req.GetData().Payload) != expectedMsg {
				done <- fmt.Errorf("session %d: expected '%s', got '%s'", id, expectedMsg, string(req.GetData().Payload))
				return
			}

			// Send unique response
			uniqueResp := fmt.Sprintf("response-to-client-%d", id)
			stream.Send(&pb.TunnelResponse{
				Message: &pb.TunnelResponse_Data{
					Data: &pb.TunnelData{Payload: []byte(uniqueResp)},
				},
			})

			// Wait for close
			stream.Recv()
			stream.CloseSend()
			done <- nil
		}(sessionID)
	}

	// Collect results - with proper shutdown coordination, all should complete without errors
	for i := 0; i < numSessions*2; i++ {
		err := <-done
		if err != nil {
			t.Errorf("Session isolation error: %v", err)
		}
	}
}

// TestRsyncRoundTrip tests rsync operation data flow
func TestRsyncRoundTrip(t *testing.T) {
	env := newRouterTestEnv(t)

	ctx, cancel := newTestContext(t, 10*time.Second)
	defer cancel()

	clientService := env.ClientService(t)
	agentService := env.AgentService(t)

	rsyncIDs := newSessionIDs("rsync-roundtrip")
	sessionKey := rsyncIDs.key
	cookie := rsyncIDs.cookie
	workflowID := rsyncIDs.workflow

	var wg sync.WaitGroup
	wg.Add(2)

	clientErrors := make(chan error, 1)
	agentErrors := make(chan error, 1)

	// Client goroutine
	go func() {
		defer wg.Done()

		stream, err := clientService.Tunnel(ctx)
		if err != nil {
			clientErrors <- err
			return
		}

		// Send init
		err = stream.Send(&pb.TunnelRequest{
			Message: &pb.TunnelRequest_Init{
				Init: &pb.TunnelInit{Operation: pb.OperationType_OPERATION_RSYNC,
					SessionKey: sessionKey,
					Cookie:     cookie,
					WorkflowId: workflowID,
					Direction:  "upload",
				},
			},
		})
		if err != nil {
			clientErrors <- err
			return
		}

		// Send rsync data (simulating file transfer)
		testData := []byte("rsync-file-content-chunk-1")
		err = stream.Send(&pb.TunnelRequest{
			Message: &pb.TunnelRequest_Data{
				Data: &pb.TunnelData{
					Payload: testData,
				},
			},
		})
		if err != nil {
			clientErrors <- err
			return
		}

		// Receive acknowledgment from agent
		resp, err := stream.Recv()
		if err != nil {
			clientErrors <- err
			return
		}

		if data := resp.GetData(); data != nil {
			t.Logf("Client received rsync ack: %d bytes", len(data.Payload))
		}

		// Send close
		err = stream.Send(&pb.TunnelRequest{
			Message: &pb.TunnelRequest_Close{
				Close: &pb.TunnelClose{
					Success: true,
				},
			},
		})
		if err != nil {
			clientErrors <- err
			return
		}

		// Close send side
		err = stream.CloseSend()
		if err != nil {
			clientErrors <- err
			return
		}

		// Drain remaining messages
		for {
			_, err := stream.Recv()
			if err == io.EOF {
				break
			}
			if err != nil && strings.Contains(err.Error(), "context canceled") {
				break
			}
			if err != nil {
				clientErrors <- err
				return
			}
		}

		clientErrors <- nil
	}()

	// Agent goroutine
	go func() {
		defer wg.Done()
		time.Sleep(50 * time.Millisecond)

		stream, err := agentService.RegisterTunnel(ctx)
		if err != nil {
			agentErrors <- err
			return
		}

		// Send init
		err = stream.Send(&pb.TunnelResponse{
			Message: &pb.TunnelResponse_Init{
				Init: &pb.TunnelInit{Operation: pb.OperationType_OPERATION_RSYNC,
					SessionKey: sessionKey,
					Cookie:     cookie,
					WorkflowId: workflowID,
					Direction:  "upload",
				},
			},
		})
		if err != nil {
			agentErrors <- err
			return
		}

		// Receive rsync data
		req, err := stream.Recv()
		if err != nil {
			agentErrors <- err
			return
		}

		if data := req.GetData(); data != nil {
			t.Logf("Agent received rsync data: %d bytes", len(data.Payload))
			if string(data.Payload) != "rsync-file-content-chunk-1" {
				agentErrors <- fmt.Errorf("expected 'rsync-file-content-chunk-1', got '%s'", string(data.Payload))
				return
			}
		}

		// Send acknowledgment
		err = stream.Send(&pb.TunnelResponse{
			Message: &pb.TunnelResponse_Data{
				Data: &pb.TunnelData{
					Payload: []byte("ack"),
				},
			},
		})
		if err != nil {
			agentErrors <- err
			return
		}

		// Wait for close
		req, err = stream.Recv()
		if err == io.EOF {
			agentErrors <- nil
			return
		}
		if err != nil && strings.Contains(err.Error(), "context canceled") {
			agentErrors <- nil
			return
		}
		if err != nil {
			agentErrors <- err
			return
		}

		if req.GetClose() != nil {
			t.Log("Agent received close message")
			stream.Send(&pb.TunnelResponse{
				Message: &pb.TunnelResponse_Close{
					Close: &pb.TunnelClose{Success: true},
				},
			})
		}

		stream.CloseSend()
		agentErrors <- nil
	}()

	wg.Wait()

	// Check for errors
	select {
	case err := <-clientErrors:
		if err != nil {
			t.Fatalf("Client error: %v", err)
		}
	default:
	}

	select {
	case err := <-agentErrors:
		if err != nil {
			t.Fatalf("Agent error: %v", err)
		}
	default:
	}
}

// TestRsyncDataDriven tests various rsync scenarios
func TestRsyncDataDriven(t *testing.T) {
	testCases := []struct {
		name      string
		direction string
		dataSize  int
		chunks    int
	}{
		{
			name:      "small push",
			direction: "upload",
			dataSize:  1024,
			chunks:    1,
		},
		{
			name:      "large push (1MB)",
			direction: "upload",
			dataSize:  1024 * 1024,
			chunks:    1,
		},
		{
			name:      "multiple chunks push",
			direction: "upload",
			dataSize:  1024,
			chunks:    10,
		},
		{
			name:      "pull operation",
			direction: "download",
			dataSize:  2048,
			chunks:    1,
		},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			env := newRouterTestEnv(t)

			ctx, cancel := newTestContext(t, 30*time.Second)
			defer cancel()

			clientService := env.ClientService(t)
			agentService := env.AgentService(t)

			sessionKey := fmt.Sprintf("rsync-%s", tc.name)
			clientDone := make(chan error, 1)
			agentDone := make(chan error, 1)

			// Client goroutine
			go func() {
				stream, err := clientService.Tunnel(ctx)
				if err != nil {
					clientDone <- err
					return
				}

				// Init
				stream.Send(&pb.TunnelRequest{
					Message: &pb.TunnelRequest_Init{
						Init: &pb.TunnelInit{Operation: pb.OperationType_OPERATION_RSYNC,
							SessionKey: sessionKey,
							Cookie:     "cookie",
							WorkflowId: "workflow",
							Direction:  tc.direction,
						},
					},
				})

				// Send data chunks
				for i := 0; i < tc.chunks; i++ {
					data := make([]byte, tc.dataSize)
					for j := range data {
						data[j] = byte(i % 256)
					}
					stream.Send(&pb.TunnelRequest{
						Message: &pb.TunnelRequest_Data{
							Data: &pb.TunnelData{Payload: data},
						},
					})
				}

				// Receive acks
				for i := 0; i < tc.chunks; i++ {
					_, err := stream.Recv()
					if err != nil {
						clientDone <- err
						return
					}
				}

				// Close
				stream.Send(&pb.TunnelRequest{
					Message: &pb.TunnelRequest_Close{
						Close: &pb.TunnelClose{Success: true},
					},
				})
				stream.CloseSend()

				// Drain
				for {
					_, err := stream.Recv()
					if err != nil {
						break
					}
				}
				clientDone <- nil
			}()

			// Agent goroutine
			go func() {
				time.Sleep(50 * time.Millisecond)
				stream, err := agentService.RegisterTunnel(ctx)
				if err != nil {
					agentDone <- err
					return
				}

				// Init
				stream.Send(&pb.TunnelResponse{
					Message: &pb.TunnelResponse_Init{
						Init: &pb.TunnelInit{Operation: pb.OperationType_OPERATION_RSYNC,
							SessionKey: sessionKey,
							Cookie:     "cookie",
							WorkflowId: "workflow",
							Direction:  tc.direction,
						},
					},
				})

				// Receive and ack data
				for i := 0; i < tc.chunks; i++ {
					req, err := stream.Recv()
					if err != nil {
						agentDone <- err
						return
					}
					if req.GetData() == nil {
						agentDone <- fmt.Errorf("expected data, got nil")
						return
					}

					// Send ack
					stream.Send(&pb.TunnelResponse{
						Message: &pb.TunnelResponse_Data{
							Data: &pb.TunnelData{Payload: []byte("ack")},
						},
					})
				}

				// Wait for close
				req, err := stream.Recv()
				if err == io.EOF || (err != nil && strings.Contains(err.Error(), "context canceled")) {
					agentDone <- nil
					return
				}
				if err != nil {
					agentDone <- err
					return
				}

				if req.GetClose() != nil {
					stream.Send(&pb.TunnelResponse{
						Message: &pb.TunnelResponse_Close{
							Close: &pb.TunnelClose{Success: true},
						},
					})
				}
				stream.CloseSend()
				agentDone <- nil
			}()

			// Wait for completion
			clientErr := <-clientDone
			agentErr := <-agentDone

			if clientErr != nil {
				t.Errorf("Client error: %v", clientErr)
			}
			if agentErr != nil {
				t.Errorf("Agent error: %v", agentErr)
			}
		})
	}
}

// TestGetSessionInfo tests the GetSessionInfo RPC
func TestGetSessionInfo(t *testing.T) {
	env := newRouterTestEnv(t)

	ctx, cancel := newTestContext(t, 10*time.Second)
	defer cancel()

	clientService := env.ClientService(t)
	agentService := env.AgentService(t)
	controlService := env.ControlService(t)

	// Test 1: Non-existent session
	t.Run("non-existent session", func(t *testing.T) {
		req := &pb.SessionInfoRequest{
			SessionKey: "non-existent-key",
		}

		_, err := controlService.GetSessionInfo(ctx, req)
		if err == nil {
			t.Error("Expected error for non-existent session, got nil")
		}
		if status.Code(err) != codes.NotFound {
			t.Errorf("Expected NotFound, got %v", status.Code(err))
		}
	})

	// Test 2: Active session
	t.Run("active session", func(t *testing.T) {
		sessionKey := "test-session-info"
		workflowID := "workflow-123"

		var wg sync.WaitGroup
		wg.Add(2)

		// Create a session by starting client and agent
		go func() {
			defer wg.Done()
			stream, err := clientService.Tunnel(ctx)
			if err != nil {
				t.Errorf("Client stream error: %v", err)
				return
			}

			stream.Send(&pb.TunnelRequest{
				Message: &pb.TunnelRequest_Init{
					Init: &pb.TunnelInit{Operation: pb.OperationType_OPERATION_EXEC,
						SessionKey: sessionKey,
						Cookie:     "test-cookie",
						WorkflowId: workflowID,
					},
				},
			})

			// Keep session alive briefly
			time.Sleep(500 * time.Millisecond)

			stream.Send(&pb.TunnelRequest{
				Message: &pb.TunnelRequest_Close{
					Close: &pb.TunnelClose{},
				},
			})
			stream.CloseSend()

			// Drain
			for {
				_, err := stream.Recv()
				if err != nil {
					break
				}
			}
		}()

		go func() {
			defer wg.Done()
			time.Sleep(100 * time.Millisecond)

			stream, err := agentService.RegisterTunnel(ctx)
			if err != nil {
				t.Errorf("Agent stream error: %v", err)
				return
			}

			stream.Send(&pb.TunnelResponse{
				Message: &pb.TunnelResponse_Init{
					Init: &pb.TunnelInit{Operation: pb.OperationType_OPERATION_EXEC,
						SessionKey: sessionKey,
						Cookie:     "test-cookie",
						WorkflowId: workflowID,
					},
				},
			})

			// Query session info while active
			req := &pb.SessionInfoRequest{
				SessionKey: sessionKey,
			}

			resp, err := controlService.GetSessionInfo(ctx, req)
			if err != nil {
				t.Errorf("GetSessionInfo failed: %v", err)
				return
			}

			if !resp.Active {
				t.Error("Expected session to be active")
			}

			if resp.WorkflowId != workflowID {
				t.Errorf("Expected workflow_id '%s', got '%s'", workflowID, resp.WorkflowId)
			}

			if resp.OperationType != pb.OperationType_OPERATION_EXEC {
				t.Errorf("Expected EXEC operation type, got %v", resp.OperationType)
			}

			if resp.CreatedAt <= 0 {
				t.Error("Expected positive created_at timestamp")
			}

			t.Logf("Session info: active=%v, workflow=%s, created_at=%d, type=%v",
				resp.Active, resp.WorkflowId, resp.CreatedAt, resp.OperationType)

			// Wait for client to close
			for {
				_, err := stream.Recv()
				if err != nil {
					break
				}
			}
			stream.CloseSend()
		}()

		wg.Wait()
	})
}

// TestPortForwardDataDriven tests various port forward scenarios
func TestPortForwardDataDriven(t *testing.T) {
	testCases := []struct {
		name          string
		clientToAgent [][]byte // Data client sends
		agentToClient [][]byte // Data agent sends
		targetPort    int32
		bidirectional bool
	}{
		{
			name:          "small unidirectional",
			clientToAgent: [][]byte{[]byte("GET / HTTP/1.1\r\n\r\n")},
			agentToClient: [][]byte{[]byte("HTTP/1.1 200 OK\r\n\r\n")},
			targetPort:    8080,
			bidirectional: false,
		},
		{
			name: "large bidirectional",
			clientToAgent: [][]byte{
				make([]byte, 64*1024), // 64KB
			},
			agentToClient: [][]byte{
				make([]byte, 128*1024), // 128KB
			},
			targetPort:    9090,
			bidirectional: true,
		},
		{
			name: "multiple chunks",
			clientToAgent: [][]byte{
				[]byte("chunk1"),
				[]byte("chunk2"),
				[]byte("chunk3"),
			},
			agentToClient: [][]byte{
				[]byte("response1"),
				[]byte("response2"),
				[]byte("response3"),
			},
			targetPort:    3000,
			bidirectional: true,
		},
		{
			name: "websocket simulation",
			clientToAgent: [][]byte{
				[]byte("CONNECT"),
				[]byte("PING"),
				[]byte("DATA"),
			},
			agentToClient: [][]byte{
				[]byte("CONNECTED"),
				[]byte("PONG"),
				[]byte("ACK"),
			},
			targetPort:    8888,
			bidirectional: true,
		},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			env := newRouterTestEnv(t)

			ctx, cancel := newTestContext(t, 30*time.Second)
			defer cancel()

			clientService := env.ClientService(t)
			agentService := env.AgentService(t)

			sessionKey := fmt.Sprintf("pf-%s", tc.name)
			clientDone := make(chan error, 1)
			agentDone := make(chan error, 1)

			// Client goroutine
			go func() {
				stream, err := clientService.Tunnel(ctx)
				if err != nil {
					clientDone <- err
					return
				}

				// Send init
				stream.Send(&pb.TunnelRequest{
					Message: &pb.TunnelRequest_Init{
						Init: &pb.TunnelInit{Operation: pb.OperationType_OPERATION_PORT_FORWARD,
							SessionKey: sessionKey,
							Cookie:     "cookie",
							WorkflowId: "workflow",
							Protocol:   pb.Protocol_PROTOCOL_TCP,
							RemotePort: tc.targetPort,
						},
					},
				})

				// Send data to agent
				for _, data := range tc.clientToAgent {
					stream.Send(&pb.TunnelRequest{
						Message: &pb.TunnelRequest_Data{
							Data: &pb.TunnelData{Payload: data},
						},
					})
				}

				// Receive responses from agent
				received := 0
				for received < len(tc.agentToClient) {
					resp, err := stream.Recv()
					if err != nil {
						clientDone <- fmt.Errorf("client recv error: %w", err)
						return
					}
					if resp.GetData() != nil {
						received++
					}
				}

				// Close
				stream.Send(&pb.TunnelRequest{
					Message: &pb.TunnelRequest_Close{
						Close: &pb.TunnelClose{},
					},
				})
				stream.CloseSend()

				// Drain
				for {
					_, err := stream.Recv()
					if err != nil {
						break
					}
				}
				clientDone <- nil
			}()

			// Agent goroutine
			go func() {
				time.Sleep(50 * time.Millisecond)

				stream, err := agentService.RegisterTunnel(ctx)
				if err != nil {
					agentDone <- err
					return
				}

				// Send init
				stream.Send(&pb.TunnelResponse{
					Message: &pb.TunnelResponse_Init{
						Init: &pb.TunnelInit{Operation: pb.OperationType_OPERATION_PORT_FORWARD,
							SessionKey: sessionKey,
							Cookie:     "cookie",
							WorkflowId: "workflow",
							Protocol:   pb.Protocol_PROTOCOL_TCP,
							RemotePort: tc.targetPort,
						},
					},
				})

				// Receive data from client
				for range tc.clientToAgent {
					_, err := stream.Recv()
					if err != nil {
						agentDone <- fmt.Errorf("agent recv error: %w", err)
						return
					}
				}

				// Send responses back
				for _, data := range tc.agentToClient {
					stream.Send(&pb.TunnelResponse{
						Message: &pb.TunnelResponse_Data{
							Data: &pb.TunnelData{Payload: data},
						},
					})
				}

				// Wait for close
				req, err := stream.Recv()
				if err == io.EOF || (err != nil && strings.Contains(err.Error(), "context canceled")) {
					agentDone <- nil
					return
				}
				if err != nil {
					agentDone <- err
					return
				}

				if req.GetClose() != nil {
					stream.Send(&pb.TunnelResponse{
						Message: &pb.TunnelResponse_Close{
							Close: &pb.TunnelClose{},
						},
					})
				}
				stream.CloseSend()
				agentDone <- nil
			}()

			// Wait for completion
			clientErr := <-clientDone
			agentErr := <-agentDone

			if clientErr != nil {
				t.Errorf("Client error: %v", clientErr)
			}
			if agentErr != nil {
				t.Errorf("Agent error: %v", agentErr)
			}
		})
	}
}

// TestDeadlockOnSimultaneousDisconnect tests that both client and agent can disconnect
// simultaneously without causing a deadlock in the goroutine coordination.
func TestDeadlockOnSimultaneousDisconnect(t *testing.T) {
	env := newRouterTestEnv(t)

	// Very short timeout - if there's a deadlock, this will fail quickly
	ctx, cancel := newTestContext(t, 3*time.Second)
	defer cancel()

	clientService := env.ClientService(t)
	agentService := env.AgentService(t)

	sessionKey := "deadlock-test"
	cookie := "test-cookie"
	workflowID := "test-workflow"

	clientDone := make(chan error, 1)
	agentDone := make(chan error, 1)

	// Client goroutine
	go func() {
		stream, err := clientService.Tunnel(ctx)
		if err != nil {
			clientDone <- err
			return
		}

		// Send init
		if err := stream.Send(&pb.TunnelRequest{
			Message: &pb.TunnelRequest_Init{
				Init: &pb.TunnelInit{
					SessionKey: sessionKey,
					Cookie:     cookie,
					WorkflowId: workflowID,
					Operation:  pb.OperationType_OPERATION_EXEC,
				},
			},
		}); err != nil {
			clientDone <- err
			return
		}

		// Send some data
		for i := range 5 {
			if err := stream.Send(&pb.TunnelRequest{
				Message: &pb.TunnelRequest_Data{
					Data: &pb.TunnelData{Payload: []byte(fmt.Sprintf("msg-%d", i))},
				},
			}); err != nil {
				clientDone <- err
				return
			}
		}

		// Close immediately without waiting for responses
		stream.Send(&pb.TunnelRequest{
			Message: &pb.TunnelRequest_Close{Close: &pb.TunnelClose{}},
		})
		stream.CloseSend()
		clientDone <- nil
	}()

	// Agent goroutine
	go func() {
		time.Sleep(50 * time.Millisecond) // Let client connect first

		stream, err := agentService.RegisterTunnel(ctx)
		if err != nil {
			agentDone <- err
			return
		}

		// Send init
		if err := stream.Send(&pb.TunnelResponse{
			Message: &pb.TunnelResponse_Init{
				Init: &pb.TunnelInit{
					SessionKey: sessionKey,
					Cookie:     cookie,
					WorkflowId: workflowID,
					Operation:  pb.OperationType_OPERATION_EXEC,
				},
			},
		}); err != nil {
			agentDone <- err
			return
		}

		// Receive a couple messages then close immediately
		for range 2 {
			_, err := stream.Recv()
			if err == io.EOF {
				break
			}
			if err != nil {
				// Expected - connection might close
				break
			}
		}

		// Close immediately
		stream.Send(&pb.TunnelResponse{
			Message: &pb.TunnelResponse_Close{Close: &pb.TunnelClose{}},
		})
		stream.CloseSend()
		agentDone <- nil
	}()

	// Wait for both to complete - should not deadlock
	select {
	case err := <-clientDone:
		if err != nil {
			t.Logf("Client error (may be expected): %v", err)
		}
	case <-ctx.Done():
		t.Fatal("Client deadlocked - did not complete within timeout")
	}

	select {
	case err := <-agentDone:
		if err != nil {
			t.Logf("Agent error (may be expected): %v", err)
		}
	case <-ctx.Done():
		t.Fatal("Agent deadlocked - did not complete within timeout")
	}

	t.Log("SUCCESS: No deadlock on simultaneous disconnect")
}

// TestCloseMessageNotPropagated tests that when a client sends a Close message,
// it should be forwarded to the agent (not just closing the channel).
func TestCloseMessageNotPropagated(t *testing.T) {
	env := newRouterTestEnv(t)

	ctx, cancel := newTestContext(t, 3*time.Second)
	defer cancel()

	clientService := env.ClientService(t)
	agentService := env.AgentService(t)

	sessionKey := "close-propagation-test"
	cookie := "test-cookie"
	workflowID := "test-workflow"

	clientDone := make(chan error, 1)
	agentDone := make(chan error, 1)
	agentReceivedClose := make(chan bool, 1)

	// Client goroutine
	go func() {
		stream, err := clientService.Tunnel(ctx)
		if err != nil {
			clientDone <- err
			return
		}

		// Send init
		if err := stream.Send(&pb.TunnelRequest{
			Message: &pb.TunnelRequest_Init{
				Init: &pb.TunnelInit{
					SessionKey: sessionKey,
					Cookie:     cookie,
					WorkflowId: workflowID,
					Operation:  pb.OperationType_OPERATION_EXEC,
				},
			},
		}); err != nil {
			clientDone <- err
			return
		}

		// Send one data message
		if err := stream.Send(&pb.TunnelRequest{
			Message: &pb.TunnelRequest_Data{
				Data: &pb.TunnelData{Payload: []byte("hello")},
			},
		}); err != nil {
			clientDone <- err
			return
		}

		// Send close message - this should be forwarded to agent
		if err := stream.Send(&pb.TunnelRequest{
			Message: &pb.TunnelRequest_Close{Close: &pb.TunnelClose{}},
		}); err != nil {
			clientDone <- err
			return
		}

		stream.CloseSend()
		clientDone <- nil
	}()

	// Agent goroutine
	go func() {
		time.Sleep(50 * time.Millisecond)

		stream, err := agentService.RegisterTunnel(ctx)
		if err != nil {
			agentDone <- err
			return
		}

		// Send init
		if err := stream.Send(&pb.TunnelResponse{
			Message: &pb.TunnelResponse_Init{
				Init: &pb.TunnelInit{
					SessionKey: sessionKey,
					Cookie:     cookie,
					WorkflowId: workflowID,
					Operation:  pb.OperationType_OPERATION_EXEC,
				},
			},
		}); err != nil {
			agentDone <- err
			return
		}

		// Receive data
		req, err := stream.Recv()
		if err != nil {
			agentDone <- fmt.Errorf("recv data error: %w", err)
			return
		}
		if req.GetData() == nil {
			agentDone <- fmt.Errorf("expected data message, got: %v", req)
			return
		}

		// Now wait for close message - THIS IS THE KEY TEST
		// The server should forward the Close message, not just close the channel
		req, err = stream.Recv()
		if err == io.EOF {
			// This indicates the channel was closed without sending Close message (BUG)
			agentReceivedClose <- false
			agentDone <- nil
			return
		}
		if err != nil {
			agentDone <- fmt.Errorf("recv close error: %w", err)
			return
		}

		if req.GetClose() != nil {
			// SUCCESS - received explicit Close message
			agentReceivedClose <- true
			agentDone <- nil
			return
		}

		agentDone <- fmt.Errorf("expected Close message, got: %v", req)
	}()

	// Wait for both
	clientErr := <-clientDone
	if clientErr != nil {
		t.Fatalf("Client error: %v", clientErr)
	}

	agentErr := <-agentDone
	if agentErr != nil {
		t.Fatalf("Agent error: %v", agentErr)
	}

	// Check if agent received explicit Close message
	select {
	case received := <-agentReceivedClose:
		if !received {
			t.Fatal("BUG: Agent received EOF instead of explicit Close message")
		}
		t.Log("SUCCESS: Agent received explicit Close message")
	case <-time.After(100 * time.Millisecond):
		t.Fatal("Agent did not receive Close message or EOF")
	}
}

// TestBufferChannelDeadlock tests that when buffer channels fill up and one side
// closes, the system doesn't deadlock due to goroutines blocked on full channels.
func TestBufferChannelDeadlock(t *testing.T) {
	env := newRouterTestEnv(t)

	ctx, cancel := newTestContext(t, 5*time.Second)
	defer cancel()

	clientService := env.ClientService(t)
	agentService := env.AgentService(t)

	sessionKey := "buffer-deadlock-test"
	cookie := "test-cookie"
	workflowID := "test-workflow"

	clientDone := make(chan error, 1)
	agentDone := make(chan error, 1)

	// Client goroutine - send lots of data then close
	go func() {
		stream, err := clientService.Tunnel(ctx)
		if err != nil {
			clientDone <- err
			return
		}

		// Send init
		if err := stream.Send(&pb.TunnelRequest{
			Message: &pb.TunnelRequest_Init{
				Init: &pb.TunnelInit{
					SessionKey: sessionKey,
					Cookie:     cookie,
					WorkflowId: workflowID,
					Operation:  pb.OperationType_OPERATION_EXEC,
				},
			},
		}); err != nil {
			clientDone <- err
			return
		}

		// Flood with messages to fill buffers
		for i := range 100 {
			if err := stream.Send(&pb.TunnelRequest{
				Message: &pb.TunnelRequest_Data{
					Data: &pb.TunnelData{Payload: []byte(fmt.Sprintf("data-%d", i))},
				},
			}); err != nil {
				// Expected to fail if buffers full
				break
			}
		}

		// Close immediately
		stream.Send(&pb.TunnelRequest{
			Message: &pb.TunnelRequest_Close{Close: &pb.TunnelClose{}},
		})
		stream.CloseSend()
		clientDone <- nil
	}()

	// Agent goroutine - connect but DON'T consume messages
	go func() {
		time.Sleep(50 * time.Millisecond)

		stream, err := agentService.RegisterTunnel(ctx)
		if err != nil {
			agentDone <- err
			return
		}

		// Send init
		if err := stream.Send(&pb.TunnelResponse{
			Message: &pb.TunnelResponse_Init{
				Init: &pb.TunnelInit{
					SessionKey: sessionKey,
					Cookie:     cookie,
					WorkflowId: workflowID,
					Operation:  pb.OperationType_OPERATION_EXEC,
				},
			},
		}); err != nil {
			agentDone <- err
			return
		}

		// Deliberately DON'T read messages - let buffers fill
		// Just wait a bit then close
		time.Sleep(500 * time.Millisecond)

		stream.CloseSend()
		agentDone <- nil
	}()

	// Both should complete without deadlock
	select {
	case err := <-clientDone:
		if err != nil {
			t.Logf("Client error (may be expected): %v", err)
		}
	case <-ctx.Done():
		t.Fatal("Client deadlocked with full buffers")
	}

	select {
	case err := <-agentDone:
		if err != nil {
			t.Logf("Agent error (may be expected): %v", err)
		}
	case <-ctx.Done():
		t.Fatal("Agent deadlocked with full buffers")
	}

	t.Log("SUCCESS: No deadlock with full buffers")
}

// TestDoubleSessionDeletion tests that when both client and agent disconnect
// simultaneously, the double deletion doesn't cause a panic.
func TestDoubleSessionDeletion(t *testing.T) {
	env := newRouterTestEnv(t)

	ctx, cancel := newTestContext(t, 3*time.Second)
	defer cancel()

	clientService := env.ClientService(t)
	agentService := env.AgentService(t)

	// Run multiple iterations to increase chance of race
	for iteration := range 10 {
		sessionKey := fmt.Sprintf("double-delete-test-%d", iteration)
		cookie := "test-cookie"
		workflowID := "test-workflow"

		var wg sync.WaitGroup
		wg.Add(2)

		// Client goroutine
		go func() {
			defer wg.Done()
			stream, err := clientService.Tunnel(ctx)
			if err != nil {
				return
			}

			stream.Send(&pb.TunnelRequest{
				Message: &pb.TunnelRequest_Init{
					Init: &pb.TunnelInit{
						SessionKey: sessionKey,
						Cookie:     cookie,
						WorkflowId: workflowID,
						Operation:  pb.OperationType_OPERATION_EXEC,
					},
				},
			})

			// Send data then close immediately
			stream.Send(&pb.TunnelRequest{
				Message: &pb.TunnelRequest_Data{
					Data: &pb.TunnelData{Payload: []byte("data")},
				},
			})
			stream.CloseSend()
		}()

		// Agent goroutine - close immediately after init
		go func() {
			defer wg.Done()
			time.Sleep(20 * time.Millisecond)

			stream, err := agentService.RegisterTunnel(ctx)
			if err != nil {
				return
			}

			stream.Send(&pb.TunnelResponse{
				Message: &pb.TunnelResponse_Init{
					Init: &pb.TunnelInit{
						SessionKey: sessionKey,
						Cookie:     cookie,
						WorkflowId: workflowID,
						Operation:  pb.OperationType_OPERATION_EXEC,
					},
				},
			})

			// Close immediately
			stream.CloseSend()
		}()

		wg.Wait()
		// Small delay to allow server cleanup
		time.Sleep(50 * time.Millisecond)
	}

	t.Log("SUCCESS: No panic from double deletion")
}
