/*
Copyright (c) 2025, NVIDIA CORPORATION. All rights reserved.

NVIDIA CORPORATION and its licensors retain all intellectual property
and proprietary rights in and to this software, related documentation
and any modifications thereto. Any use, reproduction, disclosure or
distribution of this software and related documentation without an express
license agreement from NVIDIA CORPORATION is strictly prohibited.
*/

// forward.go - Forwarder interface definition
//
// This file defines the Forwarder interface that abstracts the transport layer
// (WebSocket vs gRPC) for port forwarding, exec, and rsync operations.
//
// IMPORTANT: This file contains ONLY the interface and factory.
// Implementation details belong in forward_ws.go and forward_grpc.go.

package main

import (
	"context"
	"net"

	"go.corp.nvidia.com/osmo/runtime/pkg/args"
	"go.corp.nvidia.com/osmo/runtime/pkg/metrics"
)

// Forwarder defines the interface for forwarding data between CLI and backend services.
// Both WebSocket and gRPC implementations satisfy this interface.
//
// This abstraction allows us to:
// - Gradually migrate from WebSocket to gRPC
// - Test both implementations with the same test suite
// - Use feature flags to switch implementations at runtime
type Forwarder interface {
	// ServePortForward handles a port forwarding or webserver session.
	// This is the main entry point for ActionPortForward and ActionWebServer.
	//
	// For WebSocket: Opens control channel, spawns ForwardTCP/ForwardWebSocket per connection.
	// For gRPC: Dials router_go directly (no control channel needed).
	ServePortForward(ctx context.Context, cfg *PortForwardConfig) error

	// ForwardTCP forwards data between the router and a local TCP port.
	// Used for rsync and single-connection scenarios.
	ForwardTCP(ctx context.Context, key, cookie string, port int, opts *ForwardOpts) error

	// ForwardUDP forwards UDP packets between the router and a local UDP port.
	// Handles packet encapsulation for multiplexing multiple UDP clients.
	ForwardUDP(ctx context.Context, key, cookie string, port int) error

	// ForwardConn forwards data to an existing connection (e.g., Unix socket for exec).
	ForwardConn(ctx context.Context, key, cookie string, conn net.Conn) error

	// ForwardWebSocket bridges a WebSocket connection to a local WebSocket server.
	ForwardWebSocket(ctx context.Context, key, cookie string, port int, payload map[string]interface{}) error

	// Close releases resources held by the forwarder.
	Close() error
}

// PortForwardConfig contains configuration for a port forwarding session.
type PortForwardConfig struct {
	Key             string
	Cookie          string
	Port            int
	RouterAddress   string // WS control channel address (used by wsForwarder only)
	Action          ActionType
	EnableTelemetry bool
	MetricChan      chan metrics.Metric
	CmdArgs         args.CtrlArgs // For token refresh
}

// ForwardOpts configures optional forwarding behavior.
type ForwardOpts struct {
	EnableTelemetry bool
	MetricChan      chan metrics.Metric
	ActionType      ActionType
}

// NewForwarder creates a Forwarder based on feature flags.
// Returns gRPC forwarder if enabled, otherwise WebSocket forwarder.
func NewForwarder(clientInfo ServiceRequest, cmdArgs args.CtrlArgs) (Forwarder, error) {
	if useGrpcForwarder(clientInfo, cmdArgs) {
		return newGrpcForwarder(grpcForwarderAddr(clientInfo, cmdArgs), cmdArgs.Workflow, cmdArgs)
	}
	return newWSForwarder(clientInfo.RouterAddress, cmdArgs.Workflow, cmdArgs), nil
}

// useGrpcForwarder determines if gRPC should be used based on feature flags.
func useGrpcForwarder(clientInfo ServiceRequest, cmdArgs args.CtrlArgs) bool {
	return clientInfo.UseGrpcRouter ||
		clientInfo.GrpcRouterAddress != "" ||
		(cmdArgs.UseGrpcRouter && cmdArgs.GrpcRouterAddress != "")
}

// grpcForwarderAddr returns the gRPC address from request or command-line args.
func grpcForwarderAddr(clientInfo ServiceRequest, cmdArgs args.CtrlArgs) string {
	if clientInfo.GrpcRouterAddress != "" {
		return clientInfo.GrpcRouterAddress
	}
	return cmdArgs.GrpcRouterAddress
}
