// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION. All rights reserved.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
// http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.
//
// SPDX-License-Identifier: Apache-2.0

package main

import (
	"context"
	"fmt"
	"io"
	"log"
	"sync"
	"time"

	"google.golang.org/grpc"
	"google.golang.org/grpc/metadata"

	"go.corp.nvidia.com/osmo/operator/utils"
	pb "go.corp.nvidia.com/osmo/proto/operator"
)

// NodeConditionRuleListener manages the NodeConditionStream connection and updates shared rules.
type NodeConditionRuleListener struct {
	args               utils.ListenerArgs
	nodeConditionRules *utils.NodeConditionRules
	inst               *utils.Instruments
}

// Logf logs with stream name prefix.
func (ncrl *NodeConditionRuleListener) Logf(format string, args ...any) {
	log.Printf("["+string(utils.StreamNameNodeConditionRule)+"] "+format, args...)
}

// NewNodeConditionRuleListener creates a new node condition rule listener instance.
func NewNodeConditionRuleListener(
	args utils.ListenerArgs,
	nodeConditionRules *utils.NodeConditionRules,
	inst *utils.Instruments,
) *NodeConditionRuleListener {
	return &NodeConditionRuleListener{
		args:               args,
		nodeConditionRules: nodeConditionRules,
		inst:               inst,
	}
}

// receiveMessages receives NodeConditionsMessage from the server and updates rules.
// Returns nil on clean shutdown (EOF or context cancellation) and an error otherwise.
func (ncrl *NodeConditionRuleListener) receiveMessages(
	stream pb.ListenerService_NodeConditionStreamClient,
) error {
	for {
		msg, err := stream.Recv()
		if err != nil {
			return err
		}
		switch resp := msg.Response.(type) {
		case *pb.NodeConditionStreamResponse_NodeConditions:
			ncrl.nodeConditionRules.SetRules(resp.NodeConditions.Rules)
			ncrl.Logf("Updated node condition rules: %v", resp.NodeConditions.Rules)
		case *pb.NodeConditionStreamResponse_Heartbeat:
			ncrl.Logf("Received heartbeat response: %s", resp.Heartbeat.Time)
		}
	}
}

// sendHeartbeats sends periodic heartbeats to keep the stream alive.
// Returns nil on clean shutdown and an error if sending fails.
func (ncrl *NodeConditionRuleListener) sendHeartbeats(
	streamCtx context.Context,
	stream pb.ListenerService_NodeConditionStreamClient,
) error {
	ticker := time.NewTicker(time.Duration(ncrl.args.HeartbeatIntervalSec) * time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-streamCtx.Done():
			return nil
		case <-ticker.C:
			msg := &pb.HeartbeatMessage{
				Time: time.Now().UTC().Format(time.RFC3339),
			}
			if err := stream.Send(msg); err != nil {
				return err
			}
		}
	}
}

// Run connects to NodeConditionStream and updates the shared node conditions.
// It sends periodic heartbeats to keep the bidirectional stream alive.
func (ncrl *NodeConditionRuleListener) Run(ctx context.Context) error {
	serviceAddr, err := utils.ParseServiceURL(ncrl.args.ServiceURL)
	if err != nil {
		return fmt.Errorf("failed to parse service URL: %w", err)
	}

	dialOpts, err := utils.GetDialOptions(ncrl.args)
	if err != nil {
		return fmt.Errorf("failed to get dial options: %w", err)
	}

	conn, err := grpc.NewClient(serviceAddr, dialOpts...)
	if err != nil {
		return fmt.Errorf("failed to create gRPC connection: %w", err)
	}
	defer conn.Close()

	client := pb.NewListenerServiceClient(conn)

	md := metadata.Pairs("backend-name", ncrl.args.Backend)
	streamCtx, streamCancel := context.WithCancelCause(
		metadata.NewOutgoingContext(ctx, md))
	defer streamCancel(nil)

	stream, err := client.NodeConditionStream(streamCtx)
	if err != nil {
		return fmt.Errorf("failed to create node condition stream: %w", err)
	}

	var wg sync.WaitGroup
	wg.Add(2)

	go func() {
		defer wg.Done()
		streamCancel(ncrl.receiveMessages(stream))
	}()

	go func() {
		defer wg.Done()
		streamCancel(ncrl.sendHeartbeats(streamCtx, stream))
	}()

	// Block until the stream context is done (goroutine error or parent cancellation).
	<-streamCtx.Done()

	var finalErr error
	if cause := context.Cause(streamCtx); cause != nil && cause != context.Canceled && cause != io.EOF {
		finalErr = fmt.Errorf("stream error: %w", cause)
	} else if ctx.Err() != nil {
		finalErr = ctx.Err()
	}

	shutdownComplete := make(chan struct{})
	go func() {
		wg.Wait()
		close(shutdownComplete)
	}()
	select {
	case <-shutdownComplete:
		ncrl.Logf("All goroutines stopped gracefully")
	case <-time.After(5 * time.Second):
		ncrl.Logf("Warning: goroutines did not stop within timeout")
	}

	return finalErr
}
