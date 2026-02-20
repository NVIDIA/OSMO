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

// NewNodeConditionRuleListener creates a new node condition rule listener instance.
func NewNodeConditionRuleListener(args utils.ListenerArgs, nodeConditionRules *utils.NodeConditionRules, inst *utils.Instruments) *NodeConditionRuleListener {
	return &NodeConditionRuleListener{
		args:               args,
		nodeConditionRules: nodeConditionRules,
		inst:               inst,
	}
}

// Run connects to NodeConditionStream and updates the shared node conditions.
func (ncrl *NodeConditionRuleListener) Run(ctx context.Context) error {
	serviceAddr, err := utils.ParseServiceURL(ncrl.args.ServiceURL)
	if err != nil {
		return fmt.Errorf("failed to parse service URL: %w", err)
	}

	// Create connection
	conn, err := grpc.NewClient(
		serviceAddr,
		grpc.WithTransportCredentials(utils.GetTransportCredentials(ncrl.args.ServiceURL)),
	)
	if err != nil {
		return fmt.Errorf("failed to create gRPC connection: %w", err)
	}
	defer conn.Close()

	client := pb.NewListenerServiceClient(conn)

	md := metadata.Pairs("backend-name", ncrl.args.Backend)
	streamCtx := metadata.NewOutgoingContext(ctx, md)

	stream, err := client.NodeConditionStream(streamCtx, &pb.NodeConditionStreamRequest{})
	if err != nil {
		return fmt.Errorf("failed to create node condition stream: %w", err)
	}

	log.Println("Connected to node condition stream")

	for {
		msg, err := stream.Recv()
		if err != nil {
			if err == io.EOF {
				log.Println("Node condition stream closed by server")
				return nil // Clean closure, not an error
			}
			if ctx.Err() != nil {
				log.Println("Node condition stream stopped due to context cancellation")
				return ctx.Err()
			}
			log.Printf("Error receiving from node condition stream: %v", err)
			return fmt.Errorf("stream receive error: %w", err)
		}

		ncrl.nodeConditionRules.SetRules(msg.Rules)
		log.Printf("Updated node condition rules: %v", msg.Rules)
	}
}
