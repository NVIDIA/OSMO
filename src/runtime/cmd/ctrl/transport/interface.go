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

package transport

import (
	"context"
)

// Protocol types for port forwarding
type PortForwardProtocol int

const (
	ProtocolTCP PortForwardProtocol = iota
	ProtocolUDP
)

// Transport defines the interface for router communication
// This abstraction allows switching between WebSocket and gRPC
type Transport interface {
	// ConnectExec establishes an exec session connection
	ConnectExec(ctx context.Context, key, cookie, workflowID string) (Stream, error)

	// ConnectPortForward establishes a port-forward connection
	ConnectPortForward(ctx context.Context, key, cookie, workflowID string, protocol PortForwardProtocol, remotePort int) (Stream, error)

	// ConnectRsync establishes an rsync connection
	ConnectRsync(ctx context.Context, key, cookie, workflowID string, direction string) (Stream, error)

	// Close closes the transport
	Close() error
}

// Stream represents a bidirectional data stream
type Stream interface {
	// Send sends data to the remote end
	Send(data []byte) error

	// Recv receives data from the remote end
	// Returns io.EOF when the stream is closed
	Recv() ([]byte, error)

	// Close closes the stream
	Close() error
}

// Config holds transport configuration
type Config struct {
	RouterAddress string
	UseTLS        bool
	Token         string
}
