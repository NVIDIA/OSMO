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
	"testing"

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
		msg      *pb.TunnelMessage
		wantTag  byte
		constVal byte
	}{
		{
			name: "init message",
			msg: &pb.TunnelMessage{
				Message: &pb.TunnelMessage_Init{
					Init: &pb.TunnelInit{SessionKey: "test"},
				},
			},
			wantTag:  TagInit,
			constVal: 0x0a,
		},
		{
			name: "data message",
			msg: &pb.TunnelMessage{
				Message: &pb.TunnelMessage_Data{
					Data: &pb.TunnelData{Payload: []byte("test")},
				},
			},
			wantTag:  TagData,
			constVal: 0x12,
		},
		{
			name: "close message",
			msg: &pb.TunnelMessage{
				Message: &pb.TunnelMessage_Close{
					Close: &pb.TunnelClose{},
				},
			},
			wantTag:  TagClose,
			constVal: 0x1a,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			// Verify constant has expected value
			if tt.wantTag != tt.constVal {
				t.Errorf("constant value mismatch: got 0x%02x, want 0x%02x", tt.wantTag, tt.constVal)
			}

			// Marshal the message and check first byte matches our constant
			data, err := proto.Marshal(tt.msg)
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

// TestRawMessageTypeDetection verifies IsInit/IsData/IsClose work correctly.
func TestRawMessageTypeDetection(t *testing.T) {
	t.Parallel()

	initMsg := &pb.TunnelMessage{
		Message: &pb.TunnelMessage_Init{Init: &pb.TunnelInit{SessionKey: "key"}},
	}
	dataMsg := &pb.TunnelMessage{
		Message: &pb.TunnelMessage_Data{Data: &pb.TunnelData{Payload: []byte("payload")}},
	}
	closeMsg := &pb.TunnelMessage{
		Message: &pb.TunnelMessage_Close{Close: &pb.TunnelClose{}},
	}

	initBytes, _ := proto.Marshal(initMsg)
	dataBytes, _ := proto.Marshal(dataMsg)
	closeBytes, _ := proto.Marshal(closeMsg)

	tests := []struct {
		name      string
		raw       *RawMessage
		wantInit  bool
		wantData  bool
		wantClose bool
	}{
		{
			name:      "init message",
			raw:       &RawMessage{Raw: initBytes},
			wantInit:  true,
			wantData:  false,
			wantClose: false,
		},
		{
			name:      "data message",
			raw:       &RawMessage{Raw: dataBytes},
			wantInit:  false,
			wantData:  true,
			wantClose: false,
		},
		{
			name:      "close message",
			raw:       &RawMessage{Raw: closeBytes},
			wantInit:  false,
			wantData:  false,
			wantClose: true,
		},
		{
			name:      "empty message",
			raw:       &RawMessage{Raw: nil},
			wantInit:  false,
			wantData:  false,
			wantClose: false,
		},
		{
			name:      "empty bytes",
			raw:       &RawMessage{Raw: []byte{}},
			wantInit:  false,
			wantData:  false,
			wantClose: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := tt.raw.IsInit(); got != tt.wantInit {
				t.Errorf("IsInit() = %v, want %v", got, tt.wantInit)
			}
			if got := tt.raw.IsData(); got != tt.wantData {
				t.Errorf("IsData() = %v, want %v", got, tt.wantData)
			}
			if got := tt.raw.IsClose(); got != tt.wantClose {
				t.Errorf("IsClose() = %v, want %v", got, tt.wantClose)
			}
		})
	}
}
