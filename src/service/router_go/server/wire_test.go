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
	"net"
	"testing"
	"unsafe"

	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials/insecure"
	"google.golang.org/protobuf/proto"

	pb "go.corp.nvidia.com/osmo/proto/router"
)

// TestWireTagsMatchProto verifies that our hardcoded wire tag constants
// match the actual protobuf wire format. This test will fail if the proto
// field numbers change, alerting us to update the constants.
//
// CRITICAL: UserFrame and AgentFrame MUST have matching tags for zero-copy:
// - init = 1 (tag 0x0a) in both
// - payload = 2 (tag 0x12) in both
func TestWireTagsMatchProto(t *testing.T) {
	t.Parallel()

	// Test UserFrame tags
	t.Run("UserFrame", func(t *testing.T) {
		t.Parallel()

		userInit := &pb.UserFrame{
			Frame: &pb.UserFrame_Init{
				Init: &pb.UserInit{SessionKey: "test"},
			},
		}
		userPayload := &pb.UserFrame{
			Frame: &pb.UserFrame_Payload{Payload: []byte("test")},
		}

		initBytes, _ := proto.Marshal(userInit)
		payloadBytes, _ := proto.Marshal(userPayload)

		if initBytes[0] != TagInit {
			t.Errorf("UserFrame init tag = 0x%02x, want 0x%02x", initBytes[0], TagInit)
		}
		if payloadBytes[0] != TagPayload {
			t.Errorf("UserFrame payload tag = 0x%02x, want 0x%02x", payloadBytes[0], TagPayload)
		}
	})

	// Test AgentFrame tags - MUST match UserFrame for zero-copy
	t.Run("AgentFrame", func(t *testing.T) {
		t.Parallel()

		agentInit := &pb.AgentFrame{
			Frame: &pb.AgentFrame_Init{
				Init: &pb.AgentInit{SessionKey: "test"},
			},
		}
		agentPayload := &pb.AgentFrame{
			Frame: &pb.AgentFrame_Payload{Payload: []byte("test")},
		}

		initBytes, _ := proto.Marshal(agentInit)
		payloadBytes, _ := proto.Marshal(agentPayload)

		if initBytes[0] != TagInit {
			t.Errorf("AgentFrame init tag = 0x%02x, want 0x%02x", initBytes[0], TagInit)
		}
		if payloadBytes[0] != TagPayload {
			t.Errorf("AgentFrame payload tag = 0x%02x, want 0x%02x", payloadBytes[0], TagPayload)
		}
	})

	// Verify constant values
	t.Run("constants", func(t *testing.T) {
		t.Parallel()

		if TagInit != 0x0a {
			t.Errorf("TagInit = 0x%02x, want 0x0a", TagInit)
		}
		if TagPayload != 0x12 {
			t.Errorf("TagPayload = 0x%02x, want 0x12", TagPayload)
		}
	})
}

// TestRawFrameTypeDetection verifies IsInit/IsPayload work correctly.
func TestRawFrameTypeDetection(t *testing.T) {
	t.Parallel()

	// Use UserFrame for testing (AgentFrame has same wire format)
	initFrame := &pb.UserFrame{
		Frame: &pb.UserFrame_Init{Init: &pb.UserInit{SessionKey: "key"}},
	}
	payloadFrame := &pb.UserFrame{
		Frame: &pb.UserFrame_Payload{Payload: []byte("payload")},
	}

	initBytes, _ := proto.Marshal(initFrame)
	payloadBytes, _ := proto.Marshal(payloadFrame)

	tests := []struct {
		name        string
		raw         *RawFrame
		wantInit    bool
		wantPayload bool
	}{
		{
			name:        "init frame",
			raw:         &RawFrame{Raw: initBytes},
			wantInit:    true,
			wantPayload: false,
		},
		{
			name:        "payload frame",
			raw:         &RawFrame{Raw: payloadBytes},
			wantInit:    false,
			wantPayload: true,
		},
		{
			name:        "empty frame",
			raw:         &RawFrame{Raw: nil},
			wantInit:    false,
			wantPayload: false,
		},
		{
			name:        "empty bytes",
			raw:         &RawFrame{Raw: []byte{}},
			wantInit:    false,
			wantPayload: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			if got := tt.raw.IsInit(); got != tt.wantInit {
				t.Errorf("IsInit() = %v, want %v", got, tt.wantInit)
			}
			if got := tt.raw.IsPayload(); got != tt.wantPayload {
				t.Errorf("IsPayload() = %v, want %v", got, tt.wantPayload)
			}
		})
	}
}

// TestRawCodecZeroCopy verifies the codec does NOT copy bytes for RawFrame.
// This is the core zero-copy guarantee: we store gRPC's buffer directly
// and return it directly when forwarding.
func TestRawCodecZeroCopy(t *testing.T) {
	t.Parallel()
	codec := rawCodec{}

	t.Run("Unmarshal stores original slice", func(t *testing.T) {
		t.Parallel()

		// Simulate bytes from gRPC's receive buffer
		wireBytes := []byte{0x12, 0x05, 'h', 'e', 'l', 'l', 'o'}

		var rf RawFrame
		if err := codec.Unmarshal(wireBytes, &rf); err != nil {
			t.Fatalf("Unmarshal failed: %v", err)
		}

		// Verify same underlying array (zero-copy)
		if &rf.Raw[0] != &wireBytes[0] {
			t.Fatal("Unmarshal COPIED bytes - zero-copy violated!")
		}
	})

	t.Run("Marshal returns original slice", func(t *testing.T) {
		t.Parallel()

		original := []byte{0x12, 0x05, 'h', 'e', 'l', 'l', 'o'}
		rf := RawFrame{Raw: original}

		marshaled, err := codec.Marshal(&rf)
		if err != nil {
			t.Fatalf("Marshal failed: %v", err)
		}

		// Verify same underlying array (zero-copy)
		if &marshaled[0] != &original[0] {
			t.Fatal("Marshal COPIED bytes - zero-copy violated!")
		}
	})

	t.Run("full forwarding path is zero-copy", func(t *testing.T) {
		t.Parallel()

		// Simulate: gRPC receives bytes → Unmarshal → forward → Marshal → gRPC sends
		wireBytes := []byte{0x12, 0x0a, 'f', 'o', 'r', 'w', 'a', 'r', 'd', 'e', 'd', '!'}

		// Step 1: Unmarshal (gRPC receive)
		var rf RawFrame
		if err := codec.Unmarshal(wireBytes, &rf); err != nil {
			t.Fatalf("Unmarshal failed: %v", err)
		}

		// Step 2: Marshal (gRPC send)
		forwarded, err := codec.Marshal(&rf)
		if err != nil {
			t.Fatalf("Marshal failed: %v", err)
		}

		// Verify the entire path used the same buffer
		if &forwarded[0] != &wireBytes[0] {
			t.Fatal("Forwarding path COPIED bytes - zero-copy violated!")
		}

		t.Logf("Zero-copy verified: same buffer %p throughout", &wireBytes[0])
	})
}

// TestRawCodecProtobufFallback verifies non-RawFrame types use standard protobuf.
func TestRawCodecProtobufFallback(t *testing.T) {
	t.Parallel()
	codec := rawCodec{}

	input := &pb.UserFrame{
		Frame: &pb.UserFrame_Payload{Payload: []byte("test data")},
	}

	marshaled, err := codec.Marshal(input)
	if err != nil {
		t.Fatalf("Marshal failed: %v", err)
	}

	var output pb.UserFrame
	if err := codec.Unmarshal(marshaled, &output); err != nil {
		t.Fatalf("Unmarshal failed: %v", err)
	}

	if string(output.GetPayload()) != "test data" {
		t.Errorf("payload = %q, want %q", output.GetPayload(), "test data")
	}
}

// TestInitParsing verifies GetUserInit and GetAgentInit extract fields correctly.
func TestInitParsing(t *testing.T) {
	t.Parallel()

	t.Run("UserInit", func(t *testing.T) {
		t.Parallel()
		raw, _ := proto.Marshal(&pb.UserFrame{
			Frame: &pb.UserFrame_Init{
				Init: &pb.UserInit{
					SessionKey: "session-123",
					WorkflowId: "workflow-456",
					Operation:  &pb.UserInit_Exec{Exec: &pb.ExecOperation{Command: "ls"}},
				},
			},
		})

		init := (&RawFrame{Raw: raw}).GetUserInit()
		if init == nil {
			t.Fatal("GetUserInit returned nil")
		}
		if init.SessionKey != "session-123" || init.WorkflowId != "workflow-456" {
			t.Errorf("got (%q, %q), want (session-123, workflow-456)", init.SessionKey, init.WorkflowId)
		}
	})

	t.Run("AgentInit", func(t *testing.T) {
		t.Parallel()
		raw, _ := proto.Marshal(&pb.AgentFrame{
			Frame: &pb.AgentFrame_Init{
				Init: &pb.AgentInit{SessionKey: "agent-session", WorkflowId: "agent-workflow"},
			},
		})

		init := (&RawFrame{Raw: raw}).GetAgentInit()
		if init == nil {
			t.Fatal("GetAgentInit returned nil")
		}
		if init.SessionKey != "agent-session" || init.WorkflowId != "agent-workflow" {
			t.Errorf("got (%q, %q), want (agent-session, agent-workflow)", init.SessionKey, init.WorkflowId)
		}
	})

	t.Run("payload returns nil", func(t *testing.T) {
		t.Parallel()
		raw, _ := proto.Marshal(&pb.UserFrame{Frame: &pb.UserFrame_Payload{Payload: []byte("data")}})
		rf := &RawFrame{Raw: raw}

		if rf.GetUserInit() != nil || rf.GetAgentInit() != nil {
			t.Error("init getters should return nil for payload frames")
		}
	})
}

// TestPayloadRoundTrip verifies payload bytes survive: proto → RawFrame → proto.
func TestPayloadRoundTrip(t *testing.T) {
	t.Parallel()
	codec := rawCodec{}

	// Test small, medium, large, and binary payloads
	for _, payload := range [][]byte{
		[]byte("hello"),
		make([]byte, 64*1024), // 64KB with pattern
		{0x00, 0xff, 0x7f, 0x80},
	} {
		// Fill large payload with pattern
		for i := range payload {
			if len(payload) > 100 {
				payload[i] = byte(i % 256)
			}
		}

		// proto.Marshal → codec.Unmarshal → codec.Marshal → proto.Unmarshal
		wireBytes, _ := proto.Marshal(&pb.UserFrame{
			Frame: &pb.UserFrame_Payload{Payload: payload},
		})

		var rf RawFrame
		codec.Unmarshal(wireBytes, &rf)
		forwarded, _ := codec.Marshal(&rf)

		var received pb.UserFrame
		proto.Unmarshal(forwarded, &received)

		if string(received.GetPayload()) != string(payload) {
			t.Errorf("payload corrupted: got %d bytes, want %d", len(received.GetPayload()), len(payload))
		}
	}
}

// bufferReuseTester is a minimal gRPC server for testing buffer behavior.
type bufferReuseTester struct {
	pb.UnimplementedRouterUserServiceServer
	receivedPtrs []uintptr // Stores pointer addresses of received buffers
}

func (s *bufferReuseTester) Tunnel(stream pb.RouterUserService_TunnelServer) error {
	for {
		var frame RawFrame
		if err := stream.RecvMsg(&frame); err != nil {
			return err
		}

		// Record the underlying buffer's memory address
		if len(frame.Raw) > 0 {
			ptr := uintptr(unsafe.Pointer(&frame.Raw[0]))
			s.receivedPtrs = append(s.receivedPtrs, ptr)
		}

		// Stop after receiving 10 frames
		if len(s.receivedPtrs) >= 10 {
			return nil
		}
	}
}

// TestGRPCBufferNotReused verifies that gRPC allocates fresh buffers per RecvMsg.
//
// Our zero-copy approach stores a reference to gRPC's receive buffer. If gRPC
// ever starts reusing/pooling these buffers, our stored data would be corrupted.
//
// This test will FAIL if gRPC changes behavior, alerting us to implement
// buffer pooling (copy into our own buffer) as a fix.
func TestGRPCBufferNotReused(t *testing.T) {
	// Register our custom codec
	RegisterRawCodec()

	// Start a gRPC server with our test implementation
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("failed to listen: %v", err)
	}
	defer listener.Close()

	tester := &bufferReuseTester{}
	srv := grpc.NewServer()
	pb.RegisterRouterUserServiceServer(srv, tester)

	go func() {
		_ = srv.Serve(listener)
	}()
	defer srv.Stop()

	// Connect a client
	conn, err := grpc.NewClient(
		listener.Addr().String(),
		grpc.WithTransportCredentials(insecure.NewCredentials()),
	)
	if err != nil {
		t.Fatalf("failed to connect: %v", err)
	}
	defer conn.Close()

	client := pb.NewRouterUserServiceClient(conn)
	stream, err := client.Tunnel(context.Background())
	if err != nil {
		t.Fatalf("failed to create stream: %v", err)
	}

	// Send 10 payload frames with different content
	for i := range 10 {
		payload := make([]byte, 1024) // 1KB payload
		// Fill with unique pattern so we can detect overwrites
		for j := range payload {
			payload[j] = byte(i)
		}

		frame := &pb.UserFrame{
			Frame: &pb.UserFrame_Payload{Payload: payload},
		}

		if err := stream.Send(frame); err != nil {
			t.Fatalf("failed to send frame %d: %v", i, err)
		}
	}

	// Close send side and wait for server to finish
	if err := stream.CloseSend(); err != nil {
		t.Fatalf("failed to close send: %v", err)
	}
	// Wait for server to receive and process all frames
	_, _ = stream.Recv()

	// Verify all buffer pointers are unique (no reuse)
	seen := make(map[uintptr]int)
	for i, ptr := range tester.receivedPtrs {
		if prevIdx, exists := seen[ptr]; exists {
			t.Fatalf("BUFFER REUSE DETECTED: frames %d and %d share buffer at %#x\n"+
				"gRPC is reusing receive buffers, which breaks zero-copy forwarding.\n"+
				"The router forwards RawFrame.Raw directly; if gRPC reuses the buffer,\n"+
				"it may be overwritten before SendMsg completes.",
				prevIdx, i, ptr)
		}
		seen[ptr] = i
	}

	t.Logf("Verified %d frames received with unique buffer pointers (no reuse)", len(tester.receivedPtrs))
}
