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

// wire.go - Zero-copy message handling for the router
//
// WHY THIS EXISTS:
// When the router receives a frame and forwards it to the other party,
// we want to minimize:
//   1. Memory allocations (reduces GC pressure)
//   2. Unnecessary copies (improves throughput)
//
// HOW IT WORKS:
//   1. First frame: parsed as UserInit or AgentInit (needed for session setup)
//   2. All subsequent frames: forwarded as raw bytes (zero-copy)
//
// PROTOCOL:
//   User → Router: UserInit (first), then raw payload bytes
//   Agent → Router: AgentInit (first), then raw payload bytes
//   Router forwards payload frames transparently without inspection.
//   Stream close (EOF) signals end of tunnel.
//
// ZERO-COPY FORWARDING:
// UserFrame and AgentFrame have identical wire formats for payload:
//   - Both use tag 2 for payload field
//   - Wire format: [0x12][length][bytes]
// This allows the router to forward bytes transparently between user and agent.
//
// MEMORY LAYOUT:
//
//   Traditional approach:
//     Network → gRPC buffer → Unmarshal → new message → Marshal → new buffer → Network
//                                           ↑ ALLOC+COPY              ↑ ALLOC+COPY
//
//   Zero-copy approach:
//     Network → gRPC buffer → RawFrame{Raw: buffer} → forward same bytes → Network
//                                     ↑ NO COPY                 ↑ NO COPY
//
// gRPC BUFFER OWNERSHIP:
// We store a reference to gRPC's receive buffer without copying. This relies on
// gRPC-go allocating a fresh buffer for each RecvMsg call (current behavior).
// TestGRPCBufferNotReused verifies this assumption and will fail if gRPC changes.

import (
	"google.golang.org/grpc/encoding"
	"google.golang.org/protobuf/proto"

	pb "go.corp.nvidia.com/osmo/proto/router"
)

// RawFrame wraps raw protobuf bytes for zero-copy forwarding.
//
// For INIT frames (first message), we parse to extract session info.
// For PAYLOAD frames (all subsequent), we forward raw bytes without parsing.
type RawFrame struct {
	// Raw bytes from the wire. This references gRPC's buffer directly.
	// When we forward the frame, we send these exact bytes.
	Raw []byte

	// Lazily parsed init messages. Only one is populated based on frame type.
	parsedUserInit  *pb.UserInit
	parsedAgentInit *pb.AgentInit
}

// Protobuf wire tags for UserFrame/AgentFrame oneof fields.
//
// In protobuf wire format, each field starts with a tag byte:
//
//	tag = (field_number << 3) | wire_type
//
// For embedded messages and bytes (wire type 2), fields 1-15 fit in a single byte.
// These constants are verified by TestWireTagsMatchProto in wire_test.go.
//
// IMPORTANT: UserFrame and AgentFrame MUST use the same tags for zero-copy:
//   - init = 1 (tag 0x0a) in both
//   - payload = 2 (tag 0x12) in both
const (
	TagInit    = 0x0a // field 1, wire type 2: (1 << 3) | 2
	TagPayload = 0x12 // field 2, wire type 2: (2 << 3) | 2
)

// IsInit returns true if this is an init frame.
// Uses quick byte inspection without full parsing.
func (f *RawFrame) IsInit() bool {
	return len(f.Raw) > 0 && f.Raw[0] == TagInit
}

// IsPayload returns true if this is a payload frame.
// Uses quick byte inspection without full parsing.
func (f *RawFrame) IsPayload() bool {
	return len(f.Raw) > 0 && f.Raw[0] == TagPayload
}

// GetUserInit parses and returns the UserInit if this is a user init frame.
// Returns nil if it's not an init frame or parsing fails.
// The parsed result is cached for subsequent calls.
func (f *RawFrame) GetUserInit() *pb.UserInit {
	if !f.IsInit() {
		return nil
	}

	if f.parsedUserInit != nil {
		return f.parsedUserInit
	}

	// Parse the UserFrame to extract UserInit
	frame := &pb.UserFrame{}
	if err := proto.Unmarshal(f.Raw, frame); err != nil {
		return nil
	}

	f.parsedUserInit = frame.GetInit()
	return f.parsedUserInit
}

// GetAgentInit parses and returns the AgentInit if this is an agent init frame.
// Returns nil if it's not an init frame or parsing fails.
// The parsed result is cached for subsequent calls.
func (f *RawFrame) GetAgentInit() *pb.AgentInit {
	if !f.IsInit() {
		return nil
	}

	if f.parsedAgentInit != nil {
		return f.parsedAgentInit
	}

	// Parse the AgentFrame to extract AgentInit
	frame := &pb.AgentFrame{}
	if err := proto.Unmarshal(f.Raw, frame); err != nil {
		return nil
	}

	f.parsedAgentInit = frame.GetInit()
	return f.parsedAgentInit
}

// ----------------------------------------------------------------------------
// Custom gRPC Codec
// ----------------------------------------------------------------------------

// rawCodec is a gRPC codec that preserves raw bytes for zero-copy forwarding.
//
// For receiving: stores raw bytes in RawFrame without deserializing
// For sending: if given a RawFrame, sends its raw bytes directly
//
// This codec is registered with the name "proto" to override the default
// protobuf codec for our services.
type rawCodec struct {
	// fallback is the original protobuf codec for messages that aren't RawFrame
	fallback encoding.Codec
}

// Name returns "proto" to override the default protobuf codec.
func (c rawCodec) Name() string {
	return "proto"
}

// Marshal serializes a message to bytes.
//
// If the message is a RawFrame (by value or pointer), we return its raw bytes
// directly (zero copy). Otherwise, we fall back to standard protobuf marshaling.
func (c rawCodec) Marshal(v any) ([]byte, error) {
	// Zero-copy path: handle both RawFrame and *RawFrame
	switch raw := v.(type) {
	case RawFrame:
		return raw.Raw, nil
	case *RawFrame:
		return raw.Raw, nil
	}

	// Fallback: use standard protobuf marshaling
	if msg, ok := v.(proto.Message); ok {
		return proto.Marshal(msg)
	}

	// Use the fallback codec
	return c.fallback.Marshal(v)
}

// Unmarshal deserializes bytes into a message.
//
// If the target is a *RawFrame, we store a reference to gRPC's buffer.
// This is safe because gRPC allocates fresh buffers per RecvMsg (verified
// by TestGRPCBufferNotReused). Otherwise, we fall back to protobuf unmarshaling.
func (c rawCodec) Unmarshal(data []byte, v interface{}) error {
	// Zero-copy path: store reference to gRPC's buffer
	if raw, ok := v.(*RawFrame); ok {
		raw.Raw = data
		raw.parsedUserInit = nil  // Clear any cached parse
		raw.parsedAgentInit = nil // Clear any cached parse
		return nil
	}

	// Fallback: use standard protobuf unmarshaling
	if msg, ok := v.(proto.Message); ok {
		return proto.Unmarshal(data, msg)
	}

	// Use the fallback codec
	return c.fallback.Unmarshal(data, v)
}

// newRawCodec creates a codec that preserves raw bytes for RawFrame
// while falling back to the standard proto codec for other types.
func newRawCodec() encoding.Codec {
	// Get the default proto codec to use as fallback
	fallback := encoding.GetCodec("proto")
	return rawCodec{fallback: fallback}
}

// RegisterRawCodec registers our zero-copy codec.
// This should be called once at startup.
func RegisterRawCodec() {
	encoding.RegisterCodec(newRawCodec())
}
