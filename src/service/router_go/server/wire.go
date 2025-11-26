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

// wire.go - Zero-allocation message handling for the router
//
// WHY THIS EXISTS:
// When the router receives a message and forwards it to the other party,
// we want to minimize:
//   1. Memory allocations (reduces GC pressure)
//   2. Unnecessary copies (improves throughput)
//
// We keep the raw bytes and only parse what we need (message type,
// session key for init messages). The payload bytes are never copied.
//
// NOTE: This is a "lightweight" solution compared to migrating to flatbuffers.
//
// HOW IT WORKS:
//   1. gRPC receives raw bytes from the network
//   2. Our custom codec stores reference in RawMessage (zero copy)
//   3. We peek at the message type (init/data/close)
//   4. For data messages: forward the raw bytes directly
//   5. For init/close: parse the small protobuf fields we need
//
// MEMORY LAYOUT:
//
//   Traditional approach:
//     Network → gRPC buffer → Unmarshal → new TunnelMessage{payload: copy} → Marshal → new buffer → Network
//                                                              ↑ ALLOC+COPY                   ↑ ALLOC+COPY
//
//   Zero-copy approach:
//     Network → gRPC buffer → RawMessage{Raw: buffer} → forward same bytes → Network
//                                       ↑ NO COPY                  ↑ NO COPY
//
// gRPC BUFFER OWNERSHIP:
// We store a reference to gRPC's receive buffer without copying. This relies on
// gRPC-go allocating a fresh buffer for each RecvMsg call (current behavior).
// TestGRPCBufferNotReused verifies this assumption and will fail if gRPC changes.
// If that test ever fails, implement buffer pooling (see CODE_ANALYSIS_REPORT.md).

import (
	"google.golang.org/grpc/encoding"
	"google.golang.org/protobuf/proto"

	pb "go.corp.nvidia.com/osmo/proto/router"
)

// RawMessage wraps raw protobuf bytes for zero-allocation forwarding.
//
// For DATA messages, we never parse the payload - we just forward the raw bytes.
// For INIT/CLOSE messages, we parse them lazily when needed.
type RawMessage struct {
	// Raw bytes from the wire. This references gRPC's buffer directly.
	// When we forward the message, we send these exact bytes.
	Raw []byte

	// Lazily parsed protobuf message. Only populated when we need to
	// inspect the message contents (e.g., session_key from init).
	parsed *pb.TunnelMessage
}

// Parse deserializes the raw bytes into a TunnelMessage.
// This is called lazily - only when we need to inspect the message.
// For data messages being forwarded, this is NEVER called.
func (m *RawMessage) Parse() (*pb.TunnelMessage, error) {
	if m.parsed != nil {
		return m.parsed, nil
	}

	m.parsed = &pb.TunnelMessage{}
	if err := proto.Unmarshal(m.Raw, m.parsed); err != nil {
		return nil, err
	}
	return m.parsed, nil
}

// GetInit returns the TunnelInit if this is an init message.
// Returns nil if it's not an init message or parsing fails.
func (m *RawMessage) GetInit() *pb.TunnelInit {
	msg, err := m.Parse()
	if err != nil {
		return nil
	}
	return msg.GetInit()
}

// GetData returns the TunnelData if this is a data message.
// Returns nil if it's not a data message or parsing fails.
//
// NOTE: This is for TESTING ONLY. Calling this defeats the purpose
// of zero-copy because it parses the message and copies the payload bytes.
//
// For forwarding, use Raw directly instead.
func (m *RawMessage) GetData() *pb.TunnelData {
	msg, err := m.Parse()
	if err != nil {
		return nil
	}
	return msg.GetData()
}

// GetClose returns the TunnelClose if this is a close message.
// Returns nil if it's not a close message or parsing fails.
func (m *RawMessage) GetClose() *pb.TunnelClose {
	msg, err := m.Parse()
	if err != nil {
		return nil
	}
	return msg.GetClose()
}

// Protobuf wire tags for TunnelMessage oneof fields.
//
// In protobuf wire format, each field starts with a tag byte:
//
//	tag = (field_number << 3) | wire_type
//
// For embedded messages (wire type 2), fields 1-15 fit in a single byte.
// These constants are verified by TestWireTagsMatchProto in wire_test.go.
const (
	TagInit  = 0x0a // field 1, wire type 2: (1 << 3) | 2
	TagData  = 0x12 // field 2, wire type 2: (2 << 3) | 2
	TagClose = 0x1a // field 3, wire type 2: (3 << 3) | 2
)

// IsData returns true if this looks like a data message.
// Uses a quick heuristic check on the raw bytes without full parsing.
func (m *RawMessage) IsData() bool {
	return len(m.Raw) > 0 && m.Raw[0] == TagData
}

// IsInit returns true if this looks like an init message.
func (m *RawMessage) IsInit() bool {
	return len(m.Raw) > 0 && m.Raw[0] == TagInit
}

// IsClose returns true if this looks like a close message.
func (m *RawMessage) IsClose() bool {
	return len(m.Raw) > 0 && m.Raw[0] == TagClose
}

// ----------------------------------------------------------------------------
// Custom gRPC Codec
// ----------------------------------------------------------------------------

// rawCodec is a gRPC codec that preserves raw bytes for zero-copy forwarding.
//
// For receiving: stores raw bytes in RawMessage without deserializing
// For sending: if given a RawMessage, sends its raw bytes directly
//
// This codec is registered with the name "proto" to override the default
// protobuf codec for our services.
type rawCodec struct {
	// fallback is the original protobuf codec for messages that aren't RawMessage
	fallback encoding.Codec
}

// Name returns "proto" to override the default protobuf codec.
func (c rawCodec) Name() string {
	return "proto"
}

// Marshal serializes a message to bytes.
//
// If the message is a RawMessage (by value or pointer), we return its raw bytes
// directly (zero copy). Otherwise, we fall back to standard protobuf marshaling.
func (c rawCodec) Marshal(v interface{}) ([]byte, error) {
	// Zero-copy path: handle both RawMessage and *RawMessage
	switch raw := v.(type) {
	case RawMessage:
		return raw.Raw, nil
	case *RawMessage:
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
// If the target is a *RawMessage, we store a reference to gRPC's buffer.
// This is safe because gRPC allocates fresh buffers per RecvMsg (verified
// by TestGRPCBufferNotReused). Otherwise, we fall back to protobuf unmarshaling.
func (c rawCodec) Unmarshal(data []byte, v interface{}) error {
	// Zero-copy path: store reference to gRPC's buffer
	if raw, ok := v.(*RawMessage); ok {
		raw.Raw = data
		raw.parsed = nil // Clear any cached parse
		return nil
	}

	// Fallback: use standard protobuf unmarshaling
	if msg, ok := v.(proto.Message); ok {
		return proto.Unmarshal(data, msg)
	}

	// Use the fallback codec
	return c.fallback.Unmarshal(data, v)
}

// newRawCodec creates a codec that preserves raw bytes for RawMessage
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
