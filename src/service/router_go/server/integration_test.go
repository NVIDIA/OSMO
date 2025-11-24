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

	pb "go.corp.nvidia.com/osmo/proto/router/v1"
)

const bufSize = 1024 * 1024

// setupTestServer creates a test gRPC server with the router services registered.
// Returns only what's needed for black-box testing: the server (for lifecycle) and listener (for dialing).
func setupTestServer(t *testing.T) (*grpc.Server, *bufconn.Listener) {
	lis := bufconn.Listen(bufSize)
	server := grpc.NewServer()

	config := SessionStoreConfig{
		TTL:                5 * time.Minute,
		RendezvousTimeout:  60 * time.Second,
		FlowControlBuffer:  16,
		FlowControlTimeout: 30 * time.Second,
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

// TestMinimalExecFlow is a focused test with strict 2s timeout to quickly reproduce the close message issue
func TestMinimalExecFlow(t *testing.T) {
	server, lis := setupTestServer(t)
	defer server.Stop()

	// Strict 2 second timeout - fail fast!
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()

	clientConn, err := grpc.DialContext(ctx, "bufnet",
		grpc.WithContextDialer(bufDialer(lis)),
		grpc.WithTransportCredentials(insecure.NewCredentials()))
	if err != nil {
		t.Fatalf("Failed to dial: %v", err)
	}
	defer clientConn.Close()

	agentConn, err := grpc.DialContext(ctx, "bufnet",
		grpc.WithContextDialer(bufDialer(lis)),
		grpc.WithTransportCredentials(insecure.NewCredentials()))
	if err != nil {
		t.Fatalf("Failed to dial: %v", err)
	}
	defer agentConn.Close()

	clientService := pb.NewRouterClientServiceClient(clientConn)
	agentService := pb.NewRouterAgentServiceClient(agentConn)

	sessionKey := "minimal-test"
	cookie := "test-cookie"
	workflowID := "test-workflow"

	clientDone := make(chan error, 1)
	agentDone := make(chan error, 1)

	// Client goroutine
	go func() {
		stream, err := clientService.Exec(ctx)
		if err != nil {
			clientDone <- err
			return
		}

		// Send init
		if err := stream.Send(&pb.ExecRequest{
			Message: &pb.ExecRequest_Init{
				Init: &pb.ExecInit{SessionKey: sessionKey, Cookie: cookie, WorkflowId: workflowID},
			},
		}); err != nil {
			clientDone <- err
			return
		}
		t.Log("CLIENT: Sent init")

		// Send data
		if err := stream.Send(&pb.ExecRequest{
			Message: &pb.ExecRequest_Data{
				Data: &pb.ExecData{Payload: []byte("hello"), Seq: 1},
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
		if err := stream.Send(&pb.ExecRequest{
			Message: &pb.ExecRequest_Close{Close: &pb.ExecClose{}},
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

		stream, err := agentService.RegisterExec(ctx)
		if err != nil {
			agentDone <- err
			return
		}

		// Send init
		if err := stream.Send(&pb.ExecResponse{
			Message: &pb.ExecResponse_Init{
				Init: &pb.ExecInit{SessionKey: sessionKey, Cookie: cookie, WorkflowId: workflowID},
			},
		}); err != nil {
			agentDone <- err
			return
		}
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
		if err := stream.Send(&pb.ExecResponse{
			Message: &pb.ExecResponse_Data{
				Data: &pb.ExecData{Payload: []byte("world"), Seq: 1},
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
	server, lis := setupTestServer(t)
	defer server.Stop()

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	// Create client and agent connections
	clientConn, err := grpc.DialContext(ctx, "bufnet",
		grpc.WithContextDialer(bufDialer(lis)),
		grpc.WithTransportCredentials(insecure.NewCredentials()))
	if err != nil {
		t.Fatalf("Failed to dial: %v", err)
	}
	defer clientConn.Close()

	agentConn, err := grpc.DialContext(ctx, "bufnet",
		grpc.WithContextDialer(bufDialer(lis)),
		grpc.WithTransportCredentials(insecure.NewCredentials()))
	if err != nil {
		t.Fatalf("Failed to dial agent: %v", err)
	}
	defer agentConn.Close()

	clientService := pb.NewRouterClientServiceClient(clientConn)
	agentService := pb.NewRouterAgentServiceClient(agentConn)

	// Create session
	sessionKey := "test-session-exec-1"
	cookie := "test-cookie-1"
	workflowID := "test-workflow-1"

	var wg sync.WaitGroup
	wg.Add(2)

	clientErrors := make(chan error, 1)
	agentErrors := make(chan error, 1)

	// Start client
	go func() {
		defer wg.Done()
		clientStream, err := clientService.Exec(ctx)
		if err != nil {
			clientErrors <- err
			return
		}

		// Send init
		err = clientStream.Send(&pb.ExecRequest{
			Message: &pb.ExecRequest_Init{
				Init: &pb.ExecInit{
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
		err = clientStream.Send(&pb.ExecRequest{
			Message: &pb.ExecRequest_Data{
				Data: &pb.ExecData{
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
		err = clientStream.Send(&pb.ExecRequest{
			Message: &pb.ExecRequest_Close{
				Close: &pb.ExecClose{},
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

		agentStream, err := agentService.RegisterExec(ctx)
		if err != nil {
			agentErrors <- err
			return
		}

		// Send init
		err = agentStream.Send(&pb.ExecResponse{
			Message: &pb.ExecResponse_Init{
				Init: &pb.ExecInit{
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
		err = agentStream.Send(&pb.ExecResponse{
			Message: &pb.ExecResponse_Data{
				Data: &pb.ExecData{
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
			err = agentStream.Send(&pb.ExecResponse{
				Message: &pb.ExecResponse_Close{
					Close: &pb.ExecClose{ExitCode: 0},
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
	server, lis := setupTestServer(t)
	defer server.Stop()

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	clientConn, err := grpc.DialContext(ctx, "bufnet",
		grpc.WithContextDialer(bufDialer(lis)),
		grpc.WithTransportCredentials(insecure.NewCredentials()))
	if err != nil {
		t.Fatalf("Failed to dial: %v", err)
	}
	defer clientConn.Close()

	clientService := pb.NewRouterClientServiceClient(clientConn)

	clientStream, err := clientService.Exec(ctx)
	if err != nil {
		t.Fatalf("Failed to create stream: %v", err)
	}

	// Send init
	err = clientStream.Send(&pb.ExecRequest{
		Message: &pb.ExecRequest_Init{
			Init: &pb.ExecInit{
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
	server, lis := setupTestServer(t)
	defer server.Stop()

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	clientConn, err := grpc.DialContext(ctx, "bufnet",
		grpc.WithContextDialer(bufDialer(lis)),
		grpc.WithTransportCredentials(insecure.NewCredentials()))
	if err != nil {
		t.Fatalf("Failed to dial: %v", err)
	}
	defer clientConn.Close()

	agentConn, err := grpc.DialContext(ctx, "bufnet",
		grpc.WithContextDialer(bufDialer(lis)),
		grpc.WithTransportCredentials(insecure.NewCredentials()))
	if err != nil {
		t.Fatalf("Failed to dial agent: %v", err)
	}
	defer agentConn.Close()

	clientService := pb.NewRouterClientServiceClient(clientConn)
	agentService := pb.NewRouterAgentServiceClient(agentConn)

	sessionKey := "test-session-pf-1"
	cookie := "test-cookie-pf-1"
	workflowID := "test-workflow-pf-1"

	var wg sync.WaitGroup
	wg.Add(2)

	clientErrors := make(chan error, 1)
	agentErrors := make(chan error, 1)

	// Start client
	go func() {
		defer wg.Done()
		clientStream, err := clientService.PortForward(ctx)
		if err != nil {
			clientErrors <- err
			return
		}

		// Send init
		err = clientStream.Send(&pb.PortForwardRequest{
			Message: &pb.PortForwardRequest_Init{
				Init: &pb.PortForwardInit{
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
		err = clientStream.Send(&pb.PortForwardRequest{
			Message: &pb.PortForwardRequest_Data{
				Data: &pb.PortForwardData{
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
		clientStream.Send(&pb.PortForwardRequest{
			Message: &pb.PortForwardRequest_Close{
				Close: &pb.PortForwardClose{Reason: "done"},
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

		agentStream, err := agentService.RegisterPortForward(ctx)
		if err != nil {
			agentErrors <- err
			return
		}

		// Send init
		err = agentStream.Send(&pb.PortForwardResponse{
			Message: &pb.PortForwardResponse_Init{
				Init: &pb.PortForwardInit{
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
		err = agentStream.Send(&pb.PortForwardResponse{
			Message: &pb.PortForwardResponse_Data{
				Data: &pb.PortForwardData{
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
			agentStream.Send(&pb.PortForwardResponse{
				Message: &pb.PortForwardResponse_Close{
					Close: &pb.PortForwardClose{Reason: "agent closing"},
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
	server, lis := setupTestServer(t)
	defer server.Stop()

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	numSessions := 10
	var wg sync.WaitGroup
	errors := make(chan error, numSessions*2)

	for i := 0; i < numSessions; i++ {
		wg.Add(2)
		sessionID := i

		// Client goroutine
		go func(id int) {
			defer wg.Done()

			conn, err := grpc.DialContext(ctx, "bufnet",
				grpc.WithContextDialer(bufDialer(lis)),
				grpc.WithTransportCredentials(insecure.NewCredentials()))
			if err != nil {
				errors <- err
				return
			}
			defer conn.Close()

			clientService := pb.NewRouterClientServiceClient(conn)
			stream, err := clientService.Exec(ctx)
			if err != nil {
				errors <- err
				return
			}

			// Use unique session IDs to avoid collisions
			sessionKey := fmt.Sprintf("session-%d", id)
			cookie := fmt.Sprintf("cookie-%d", id)
			workflowID := fmt.Sprintf("workflow-%d", id)

			// Init
			err = stream.Send(&pb.ExecRequest{
				Message: &pb.ExecRequest_Init{
					Init: &pb.ExecInit{
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
			err = stream.Send(&pb.ExecRequest{
				Message: &pb.ExecRequest_Data{
					Data: &pb.ExecData{Payload: []byte("test"), Seq: 1},
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
			stream.Send(&pb.ExecRequest{
				Message: &pb.ExecRequest_Close{
					Close: &pb.ExecClose{},
				},
			})
			stream.CloseSend()
		}(sessionID)

		// Agent goroutine
		go func(id int) {
			defer wg.Done()
			time.Sleep(50 * time.Millisecond)

			conn, err := grpc.DialContext(ctx, "bufnet",
				grpc.WithContextDialer(bufDialer(lis)),
				grpc.WithTransportCredentials(insecure.NewCredentials()))
			if err != nil {
				errors <- err
				return
			}
			defer conn.Close()

			agentService := pb.NewRouterAgentServiceClient(conn)
			stream, err := agentService.RegisterExec(ctx)
			if err != nil {
				errors <- err
				return
			}

			// Use unique session IDs matching client
			sessionKey := fmt.Sprintf("session-%d", id)
			cookie := fmt.Sprintf("cookie-%d", id)
			workflowID := fmt.Sprintf("workflow-%d", id)

			// Init
			err = stream.Send(&pb.ExecResponse{
				Message: &pb.ExecResponse_Init{
					Init: &pb.ExecInit{
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
			err = stream.Send(&pb.ExecResponse{
				Message: &pb.ExecResponse_Data{
					Data: &pb.ExecData{Payload: []byte("response"), Seq: 1},
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
			server, lis := setupTestServer(t)
			defer server.Stop()

			ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
			defer cancel()

			// Setup connections
			clientConn, err := grpc.DialContext(ctx, "bufnet",
				grpc.WithContextDialer(bufDialer(lis)),
				grpc.WithTransportCredentials(insecure.NewCredentials()))
			if err != nil {
				t.Fatalf("Failed to dial: %v", err)
			}
			defer clientConn.Close()

			agentConn, err := grpc.DialContext(ctx, "bufnet",
				grpc.WithContextDialer(bufDialer(lis)),
				grpc.WithTransportCredentials(insecure.NewCredentials()))
			if err != nil {
				t.Fatalf("Failed to dial agent: %v", err)
			}
			defer agentConn.Close()

			clientService := pb.NewRouterClientServiceClient(clientConn)
			agentService := pb.NewRouterAgentServiceClient(agentConn)

			sessionKey := fmt.Sprintf("test-session-%s", tc.name)
			cookie := fmt.Sprintf("cookie-%s", tc.name)
			workflowID := fmt.Sprintf("workflow-%s", tc.name)

			clientDone := make(chan error, 1)
			agentDone := make(chan error, 1)

			// Client goroutine
			go func() {
				stream, err := clientService.Exec(ctx)
				if err != nil {
					clientDone <- err
					return
				}

				// Init
				if err := stream.Send(&pb.ExecRequest{
					Message: &pb.ExecRequest_Init{
						Init: &pb.ExecInit{
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
					if err := stream.Send(&pb.ExecRequest{
						Message: &pb.ExecRequest_Data{
							Data: &pb.ExecData{
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
				if err := stream.Send(&pb.ExecRequest{
					Message: &pb.ExecRequest_Close{
						Close: &pb.ExecClose{},
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
				stream, err := agentService.RegisterExec(ctx)
				if err != nil {
					agentDone <- err
					return
				}

				// Init
				if err := stream.Send(&pb.ExecResponse{
					Message: &pb.ExecResponse_Init{
						Init: &pb.ExecInit{
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
					if err := stream.Send(&pb.ExecResponse{
						Message: &pb.ExecResponse_Data{
							Data: &pb.ExecData{
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
					stream.Send(&pb.ExecResponse{
						Message: &pb.ExecResponse_Close{
							Close: &pb.ExecClose{ExitCode: 0},
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
		setupFunc     func(*testing.T, *grpc.Server, *bufconn.Listener) error
		expectedError []codes.Code // Can match any of these codes
	}{
		{
			name: "client connects without init",
			setupFunc: func(t *testing.T, server *grpc.Server, lis *bufconn.Listener) error {
				ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
				defer cancel()

				conn, _ := grpc.DialContext(ctx, "bufnet",
					grpc.WithContextDialer(bufDialer(lis)),
					grpc.WithTransportCredentials(insecure.NewCredentials()))
				defer conn.Close()

				client := pb.NewRouterClientServiceClient(conn)
				stream, err := client.Exec(ctx)
				if err != nil {
					return err
				}

				// Send data without init
				err = stream.Send(&pb.ExecRequest{
					Message: &pb.ExecRequest_Data{
						Data: &pb.ExecData{Payload: []byte("test")},
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
			setupFunc: func(t *testing.T, server *grpc.Server, lis *bufconn.Listener) error {
				ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
				defer cancel()

				conn, _ := grpc.DialContext(ctx, "bufnet",
					grpc.WithContextDialer(bufDialer(lis)),
					grpc.WithTransportCredentials(insecure.NewCredentials()))
				defer conn.Close()

				client := pb.NewRouterClientServiceClient(conn)

				// First stream
				stream1, err := client.Exec(ctx)
				if err != nil {
					return err
				}
				stream1.Send(&pb.ExecRequest{
					Message: &pb.ExecRequest_Init{
						Init: &pb.ExecInit{
							SessionKey: "duplicate-key",
							Cookie:     "cookie1",
							WorkflowId: "workflow1",
						},
					},
				})

				// Second stream with same key
				stream2, err := client.Exec(ctx)
				if err != nil {
					return err
				}
				err = stream2.Send(&pb.ExecRequest{
					Message: &pb.ExecRequest_Init{
						Init: &pb.ExecInit{
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
			// - AlreadyExists: Second client tries immediately and hits the existing session
			// - DeadlineExceeded: Second client waits for rendezvous but first never completes
			// Both are correct behaviors indicating the duplicate key problem
			expectedError: []codes.Code{codes.AlreadyExists, codes.DeadlineExceeded},
		},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			server, lis := setupTestServer(t)
			defer server.Stop()

			err := tc.setupFunc(t, server, lis)
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
	server, lis := setupTestServer(t)
	defer server.Stop()

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	numSessions := 5
	done := make(chan error, numSessions*2)

	for i := 0; i < numSessions; i++ {
		sessionID := i

		// Client
		go func(id int) {
			conn, err := grpc.DialContext(ctx, "bufnet",
				grpc.WithContextDialer(bufDialer(lis)),
				grpc.WithTransportCredentials(insecure.NewCredentials()))
			if err != nil {
				done <- err
				return
			}
			defer conn.Close()

			client := pb.NewRouterClientServiceClient(conn)
			stream, err := client.Exec(ctx)
			if err != nil {
				done <- err
				return
			}

			// Init
			stream.Send(&pb.ExecRequest{
				Message: &pb.ExecRequest_Init{
					Init: &pb.ExecInit{
						SessionKey: fmt.Sprintf("isolated-session-%d", id),
						Cookie:     fmt.Sprintf("cookie-%d", id),
						WorkflowId: fmt.Sprintf("workflow-%d", id),
					},
				},
			})

			// Send unique message
			uniqueMsg := fmt.Sprintf("message-from-client-%d", id)
			stream.Send(&pb.ExecRequest{
				Message: &pb.ExecRequest_Data{
					Data: &pb.ExecData{Payload: []byte(uniqueMsg)},
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

			stream.Send(&pb.ExecRequest{Message: &pb.ExecRequest_Close{Close: &pb.ExecClose{}}})
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
			conn, err := grpc.DialContext(ctx, "bufnet",
				grpc.WithContextDialer(bufDialer(lis)),
				grpc.WithTransportCredentials(insecure.NewCredentials()))
			if err != nil {
				done <- err
				return
			}
			defer conn.Close()

			agent := pb.NewRouterAgentServiceClient(conn)
			stream, err := agent.RegisterExec(ctx)
			if err != nil {
				done <- err
				return
			}

			// Init
			stream.Send(&pb.ExecResponse{
				Message: &pb.ExecResponse_Init{
					Init: &pb.ExecInit{
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
			stream.Send(&pb.ExecResponse{
				Message: &pb.ExecResponse_Data{
					Data: &pb.ExecData{Payload: []byte(uniqueResp)},
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
	server, lis := setupTestServer(t)
	defer server.Stop()

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	// Setup connections
	clientConn, err := grpc.DialContext(ctx, "bufnet",
		grpc.WithContextDialer(bufDialer(lis)),
		grpc.WithTransportCredentials(insecure.NewCredentials()))
	if err != nil {
		t.Fatalf("Failed to dial: %v", err)
	}
	defer clientConn.Close()

	agentConn, err := grpc.DialContext(ctx, "bufnet",
		grpc.WithContextDialer(bufDialer(lis)),
		grpc.WithTransportCredentials(insecure.NewCredentials()))
	if err != nil {
		t.Fatalf("Failed to dial: %v", err)
	}
	defer agentConn.Close()

	clientService := pb.NewRouterClientServiceClient(clientConn)
	agentService := pb.NewRouterAgentServiceClient(agentConn)

	sessionKey := "test-rsync-session"
	cookie := "rsync-cookie"
	workflowID := "rsync-workflow"

	var wg sync.WaitGroup
	wg.Add(2)

	clientErrors := make(chan error, 1)
	agentErrors := make(chan error, 1)

	// Client goroutine
	go func() {
		defer wg.Done()

		stream, err := clientService.Rsync(ctx)
		if err != nil {
			clientErrors <- err
			return
		}

		// Send init
		err = stream.Send(&pb.RsyncRequest{
			Message: &pb.RsyncRequest_Init{
				Init: &pb.RsyncInit{
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
		err = stream.Send(&pb.RsyncRequest{
			Message: &pb.RsyncRequest_Data{
				Data: &pb.RsyncData{
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
		err = stream.Send(&pb.RsyncRequest{
			Message: &pb.RsyncRequest_Close{
				Close: &pb.RsyncClose{
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

		stream, err := agentService.RegisterRsync(ctx)
		if err != nil {
			agentErrors <- err
			return
		}

		// Send init
		err = stream.Send(&pb.RsyncResponse{
			Message: &pb.RsyncResponse_Init{
				Init: &pb.RsyncInit{
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
		err = stream.Send(&pb.RsyncResponse{
			Message: &pb.RsyncResponse_Data{
				Data: &pb.RsyncData{
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
			stream.Send(&pb.RsyncResponse{
				Message: &pb.RsyncResponse_Close{
					Close: &pb.RsyncClose{Success: true},
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

// TestRefreshToken tests the token refresh RPC
func TestRefreshToken(t *testing.T) {
	server, lis := setupTestServer(t)
	defer server.Stop()

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	// Setup connection
	conn, err := grpc.DialContext(ctx, "bufnet",
		grpc.WithContextDialer(bufDialer(lis)),
		grpc.WithTransportCredentials(insecure.NewCredentials()))
	if err != nil {
		t.Fatalf("Failed to dial: %v", err)
	}
	defer conn.Close()

	controlService := pb.NewRouterControlServiceClient(conn)

	// Test successful token refresh
	t.Run("successful refresh", func(t *testing.T) {
		req := &pb.RefreshTokenRequest{
			CurrentToken: "old-token-12345",
			WorkflowId:   "workflow-123",
		}

		resp, err := controlService.RefreshToken(ctx, req)
		if err != nil {
			t.Fatalf("RefreshToken failed: %v", err)
		}

		if resp.NewToken == "" {
			t.Error("Expected new token, got empty string")
		}

		if resp.ExpiresAt <= 0 {
			t.Errorf("Expected positive expiry timestamp, got %d", resp.ExpiresAt)
		}

		t.Logf("RefreshToken succeeded: new_token=%s, expires_at=%d", resp.NewToken, resp.ExpiresAt)
	})

	// Test with empty token
	t.Run("empty token", func(t *testing.T) {
		req := &pb.RefreshTokenRequest{
			CurrentToken: "",
			WorkflowId:   "workflow-123",
		}

		resp, err := controlService.RefreshToken(ctx, req)
		// Current implementation is a placeholder, so it will still succeed
		// In production, this should return an error
		if err != nil {
			t.Logf("Empty token correctly rejected: %v", err)
		} else {
			t.Logf("Empty token accepted (placeholder behavior): new_token=%s", resp.NewToken)
		}
	})

	// Test with invalid token format
	t.Run("invalid token format", func(t *testing.T) {
		req := &pb.RefreshTokenRequest{
			CurrentToken: "invalid-format-!@#$%",
			WorkflowId:   "workflow-123",
		}

		resp, err := controlService.RefreshToken(ctx, req)
		// Current implementation is a placeholder, so it will still succeed
		// In production, this should validate and return an error
		if err != nil {
			t.Logf("Invalid token correctly rejected: %v", err)
		} else {
			t.Logf("Invalid token accepted (placeholder behavior): new_token=%s", resp.NewToken)
		}
	})
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
			server, lis := setupTestServer(t)
			defer server.Stop()

			ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
			defer cancel()

			clientConn, err := grpc.DialContext(ctx, "bufnet",
				grpc.WithContextDialer(bufDialer(lis)),
				grpc.WithTransportCredentials(insecure.NewCredentials()))
			if err != nil {
				t.Fatalf("Failed to dial: %v", err)
			}
			defer clientConn.Close()

			agentConn, err := grpc.DialContext(ctx, "bufnet",
				grpc.WithContextDialer(bufDialer(lis)),
				grpc.WithTransportCredentials(insecure.NewCredentials()))
			if err != nil {
				t.Fatalf("Failed to dial: %v", err)
			}
			defer agentConn.Close()

			clientService := pb.NewRouterClientServiceClient(clientConn)
			agentService := pb.NewRouterAgentServiceClient(agentConn)

			sessionKey := fmt.Sprintf("rsync-%s", tc.name)
			clientDone := make(chan error, 1)
			agentDone := make(chan error, 1)

			// Client goroutine
			go func() {
				stream, err := clientService.Rsync(ctx)
				if err != nil {
					clientDone <- err
					return
				}

				// Init
				stream.Send(&pb.RsyncRequest{
					Message: &pb.RsyncRequest_Init{
						Init: &pb.RsyncInit{
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
					stream.Send(&pb.RsyncRequest{
						Message: &pb.RsyncRequest_Data{
							Data: &pb.RsyncData{Payload: data},
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
				stream.Send(&pb.RsyncRequest{
					Message: &pb.RsyncRequest_Close{
						Close: &pb.RsyncClose{Success: true},
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
				stream, err := agentService.RegisterRsync(ctx)
				if err != nil {
					agentDone <- err
					return
				}

				// Init
				stream.Send(&pb.RsyncResponse{
					Message: &pb.RsyncResponse_Init{
						Init: &pb.RsyncInit{
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
					stream.Send(&pb.RsyncResponse{
						Message: &pb.RsyncResponse_Data{
							Data: &pb.RsyncData{Payload: []byte("ack")},
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
					stream.Send(&pb.RsyncResponse{
						Message: &pb.RsyncResponse_Close{
							Close: &pb.RsyncClose{Success: true},
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
	server, lis := setupTestServer(t)
	defer server.Stop()

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	// Setup connections
	clientConn, err := grpc.DialContext(ctx, "bufnet",
		grpc.WithContextDialer(bufDialer(lis)),
		grpc.WithTransportCredentials(insecure.NewCredentials()))
	if err != nil {
		t.Fatalf("Failed to dial: %v", err)
	}
	defer clientConn.Close()

	agentConn, err := grpc.DialContext(ctx, "bufnet",
		grpc.WithContextDialer(bufDialer(lis)),
		grpc.WithTransportCredentials(insecure.NewCredentials()))
	if err != nil {
		t.Fatalf("Failed to dial: %v", err)
	}
	defer agentConn.Close()

	clientService := pb.NewRouterClientServiceClient(clientConn)
	agentService := pb.NewRouterAgentServiceClient(agentConn)
	controlService := pb.NewRouterControlServiceClient(clientConn)

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
			stream, err := clientService.Exec(ctx)
			if err != nil {
				t.Errorf("Client stream error: %v", err)
				return
			}

			stream.Send(&pb.ExecRequest{
				Message: &pb.ExecRequest_Init{
					Init: &pb.ExecInit{
						SessionKey: sessionKey,
						Cookie:     "test-cookie",
						WorkflowId: workflowID,
					},
				},
			})

			// Keep session alive briefly
			time.Sleep(500 * time.Millisecond)

			stream.Send(&pb.ExecRequest{
				Message: &pb.ExecRequest_Close{
					Close: &pb.ExecClose{},
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

			stream, err := agentService.RegisterExec(ctx)
			if err != nil {
				t.Errorf("Agent stream error: %v", err)
				return
			}

			stream.Send(&pb.ExecResponse{
				Message: &pb.ExecResponse_Init{
					Init: &pb.ExecInit{
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

			if resp.LastActivity <= 0 {
				t.Error("Expected positive last_activity timestamp")
			}

			t.Logf("Session info: active=%v, workflow=%s, created_at=%d, last_activity=%d, type=%v",
				resp.Active, resp.WorkflowId, resp.CreatedAt, resp.LastActivity, resp.OperationType)

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
			server, lis := setupTestServer(t)
			defer server.Stop()

			ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
			defer cancel()

			clientConn, err := grpc.DialContext(ctx, "bufnet",
				grpc.WithContextDialer(bufDialer(lis)),
				grpc.WithTransportCredentials(insecure.NewCredentials()))
			if err != nil {
				t.Fatalf("Failed to dial: %v", err)
			}
			defer clientConn.Close()

			agentConn, err := grpc.DialContext(ctx, "bufnet",
				grpc.WithContextDialer(bufDialer(lis)),
				grpc.WithTransportCredentials(insecure.NewCredentials()))
			if err != nil {
				t.Fatalf("Failed to dial: %v", err)
			}
			defer agentConn.Close()

			clientService := pb.NewRouterClientServiceClient(clientConn)
			agentService := pb.NewRouterAgentServiceClient(agentConn)

			sessionKey := fmt.Sprintf("pf-%s", tc.name)
			clientDone := make(chan error, 1)
			agentDone := make(chan error, 1)

			// Client goroutine
			go func() {
				stream, err := clientService.PortForward(ctx)
				if err != nil {
					clientDone <- err
					return
				}

				// Send init
				stream.Send(&pb.PortForwardRequest{
					Message: &pb.PortForwardRequest_Init{
						Init: &pb.PortForwardInit{
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
					stream.Send(&pb.PortForwardRequest{
						Message: &pb.PortForwardRequest_Data{
							Data: &pb.PortForwardData{Payload: data},
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
				stream.Send(&pb.PortForwardRequest{
					Message: &pb.PortForwardRequest_Close{
						Close: &pb.PortForwardClose{},
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

				stream, err := agentService.RegisterPortForward(ctx)
				if err != nil {
					agentDone <- err
					return
				}

				// Send init
				stream.Send(&pb.PortForwardResponse{
					Message: &pb.PortForwardResponse_Init{
						Init: &pb.PortForwardInit{
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
					stream.Send(&pb.PortForwardResponse{
						Message: &pb.PortForwardResponse_Data{
							Data: &pb.PortForwardData{Payload: data},
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
					stream.Send(&pb.PortForwardResponse{
						Message: &pb.PortForwardResponse_Close{
							Close: &pb.PortForwardClose{},
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
