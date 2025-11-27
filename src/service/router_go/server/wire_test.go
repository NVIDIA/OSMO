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
func TestWireTagsMatchProto(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name     string
		frame    *pb.TunnelFrame
		wantTag  byte
		constVal byte
	}{
		{
			name: "init frame",
			frame: &pb.TunnelFrame{
				Frame: &pb.TunnelFrame_Init{
					Init: &pb.TunnelInit{SessionKey: "test"},
				},
			},
			wantTag:  TagInit,
			constVal: 0x0a,
		},
		{
			name: "payload frame",
			frame: &pb.TunnelFrame{
				Frame: &pb.TunnelFrame_Payload{
					Payload: []byte("test"),
				},
			},
			wantTag:  TagPayload,
			constVal: 0x12,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			// Verify constant has expected value
			if tt.wantTag != tt.constVal {
				t.Errorf("constant value mismatch: got 0x%02x, want 0x%02x", tt.wantTag, tt.constVal)
			}

			// Marshal the frame and check first byte matches our constant
			data, err := proto.Marshal(tt.frame)
			if err != nil {
				t.Fatalf("failed to marshal: %v", err)
			}

			if len(data) == 0 {
				t.Fatal("marshaled data is empty")
			}

			if data[0] != tt.wantTag {
				t.Errorf("wire format mismatch: first byte is 0x%02x, want 0x%02x (constant %s)",
					data[0], tt.wantTag, tt.name)
			}
		})
	}
}

// TestRawFrameTypeDetection verifies IsInit/IsPayload work correctly.
func TestRawFrameTypeDetection(t *testing.T) {
	t.Parallel()

	initFrame := &pb.TunnelFrame{
		Frame: &pb.TunnelFrame_Init{Init: &pb.TunnelInit{SessionKey: "key"}},
	}
	payloadFrame := &pb.TunnelFrame{
		Frame: &pb.TunnelFrame_Payload{Payload: []byte("payload")},
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
			if got := tt.raw.IsInit(); got != tt.wantInit {
				t.Errorf("IsInit() = %v, want %v", got, tt.wantInit)
			}
			if got := tt.raw.IsPayload(); got != tt.wantPayload {
				t.Errorf("IsPayload() = %v, want %v", got, tt.wantPayload)
			}
		})
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
	for i := 0; i < 10; i++ {
		payload := make([]byte, 1024) // 1KB payload
		// Fill with unique pattern so we can detect overwrites
		for j := range payload {
			payload[j] = byte(i)
		}

		frame := &pb.TunnelFrame{
			Frame: &pb.TunnelFrame_Payload{Payload: payload},
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
			t.Fatalf("BUFFER REUSE DETECTED! Frames %d and %d share buffer at %#x.\n"+
				"gRPC is now reusing receive buffers. Implement buffer pooling:\n"+
				"  1. In rawCodec.Unmarshal, copy data into a pooled buffer\n"+
				"  2. Add RawFrame.Release() to return buffer to pool\n"+
				"  3. Call Release() after SendMsg completes\n"+
				"See CODE_ANALYSIS_REPORT.md section 8.1 for implementation details.",
				prevIdx, i, ptr)
		}
		seen[ptr] = i
	}

	t.Logf("Verified %d frames received with unique buffer pointers (no reuse)", len(tester.receivedPtrs))
}
