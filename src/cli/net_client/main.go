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

package main

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"log"
	"os"
	"time"

	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials"
	"google.golang.org/grpc/credentials/insecure"
	"google.golang.org/grpc/keepalive"

	pb "go.corp.nvidia.com/osmo/proto/router/v1"
)

type OutputFrame struct {
	Type      string `json:"type"`
	Seq       uint64 `json:"seq,omitempty"`
	Data      string `json:"data,omitempty"`
	Timestamp string `json:"timestamp,omitempty"`
	Action    string `json:"action,omitempty"`
	Rows      uint32 `json:"rows,omitempty"`
	Cols      uint32 `json:"cols,omitempty"`
	Code      string `json:"code,omitempty"`
	Message   string `json:"message,omitempty"`
}

var (
	operation     = flag.String("operation", "exec", "Operation type: exec, portforward, rsync")
	routerAddress = flag.String("router-address", "", "Router gRPC address (or use OSMO_ROUTER_ADDRESS)")
	sessionKey    = flag.String("session-key", "", "Session key")
	cookie        = flag.String("cookie", "", "Session cookie")
	workflowID    = flag.String("workflow-id", "", "Workflow ID (or use OSMO_WORKFLOW_ID)")
	token         = flag.String("token", "", "JWT token (or use OSMO_TOKEN)")
	useTLS        = flag.Bool("tls", true, "Use TLS")
	protocol      = flag.String("protocol", "tcp", "Protocol for port-forward: tcp or udp")
	remotePort    = flag.Int("remote-port", 0, "Remote port for port-forward")
)

func main() {
	flag.Parse()

	// Read from environment if not set via flags
	if *routerAddress == "" {
		*routerAddress = os.Getenv("OSMO_ROUTER_ADDRESS")
	}
	if *workflowID == "" {
		*workflowID = os.Getenv("OSMO_WORKFLOW_ID")
	}
	if *token == "" {
		*token = os.Getenv("OSMO_TOKEN")
	}
	if *sessionKey == "" {
		*sessionKey = os.Getenv("OSMO_SESSION_KEY")
	}
	if *cookie == "" {
		*cookie = os.Getenv("OSMO_COOKIE")
	}

	// Validate required parameters
	if *routerAddress == "" || *sessionKey == "" || *workflowID == "" {
		log.Fatal("Missing required parameters: router-address, session-key, workflow-id")
	}

	// Setup gRPC connection
	var opts []grpc.DialOption
	if *useTLS {
		creds := credentials.NewTLS(nil)
		opts = append(opts, grpc.WithTransportCredentials(creds))
	} else {
		opts = append(opts, grpc.WithTransportCredentials(insecure.NewCredentials()))
	}

	// Add keepalive options
	opts = append(opts, grpc.WithKeepaliveParams(keepalive.ClientParameters{
		Time:                60 * time.Second,
		Timeout:             20 * time.Second,
		PermitWithoutStream: true,
	}))

	conn, err := grpc.Dial(*routerAddress, opts...)
	if err != nil {
		outputError("UNAVAILABLE", fmt.Sprintf("Failed to connect to router: %v", err), 0)
		os.Exit(1)
	}
	defer conn.Close()

	client := pb.NewRouterClientServiceClient(conn)
	ctx := context.Background()

	// Route to appropriate operation handler
	switch *operation {
	case "exec":
		if err := handleExec(ctx, client); err != nil {
			outputError("INTERNAL", fmt.Sprintf("Exec failed: %v", err), 0)
			os.Exit(1)
		}
	case "portforward":
		if err := handlePortForward(ctx, client); err != nil {
			outputError("INTERNAL", fmt.Sprintf("Port forward failed: %v", err), 0)
			os.Exit(1)
		}
	case "rsync":
		if err := handleRsync(ctx, client); err != nil {
			outputError("INTERNAL", fmt.Sprintf("Rsync failed: %v", err), 0)
			os.Exit(1)
		}
	default:
		log.Fatalf("Unknown operation: %s", *operation)
	}
}

func handleExec(ctx context.Context, client pb.RouterClientServiceClient) error {
	stream, err := client.Exec(ctx)
	if err != nil {
		return err
	}

	// Send init message
	initReq := &pb.ExecRequest{
		Message: &pb.ExecRequest_Init{
			Init: &pb.ExecInit{
				SessionKey: *sessionKey,
				Cookie:     *cookie,
				WorkflowId: *workflowID,
			},
		},
	}
	if err := stream.Send(initReq); err != nil {
		return err
	}

	errChan := make(chan error, 2)

	// Read from stdin, send to stream
	go func() {
		buf := make([]byte, 4096)
		var seq uint64 = 1
		for {
			n, err := os.Stdin.Read(buf)
			if err == io.EOF {
				// Send close message
				closeReq := &pb.ExecRequest{
					Message: &pb.ExecRequest_Close{
						Close: &pb.ExecClose{},
					},
				}
				stream.Send(closeReq)
				errChan <- nil
				return
			}
			if err != nil {
				errChan <- err
				return
			}

			dataReq := &pb.ExecRequest{
				Message: &pb.ExecRequest_Data{
					Data: &pb.ExecData{
						Payload: buf[:n],
						Seq:     seq,
					},
				},
			}
			if err := stream.Send(dataReq); err != nil {
				errChan <- err
				return
			}
			seq++
		}
	}()

	// Read from stream, write to stdout
	go func() {
		var seq uint64 = 1
		for {
			resp, err := stream.Recv()
			if err == io.EOF {
				errChan <- nil
				return
			}
			if err != nil {
				errChan <- err
				return
			}

			if data := resp.GetData(); data != nil {
				outputData("stdout", data.Payload, seq)
				seq++
			} else if respError := resp.GetError(); respError != nil {
				outputError(respError.Code, respError.Message, seq)
				errChan <- fmt.Errorf("remote error: %s", respError.Message)
				return
			} else if resp.GetClose() != nil {
				errChan <- nil
				return
			}
		}
	}()

	return <-errChan
}

func handlePortForward(ctx context.Context, client pb.RouterClientServiceClient) error {
	stream, err := client.PortForward(ctx)
	if err != nil {
		return err
	}

	// Determine protocol
	proto := pb.Protocol_PROTOCOL_TCP
	if *protocol == "udp" {
		proto = pb.Protocol_PROTOCOL_UDP
	}

	// Send init message
	initReq := &pb.PortForwardRequest{
		Message: &pb.PortForwardRequest_Init{
			Init: &pb.PortForwardInit{
				SessionKey: *sessionKey,
				Cookie:     *cookie,
				WorkflowId: *workflowID,
				Protocol:   proto,
				RemotePort: int32(*remotePort),
			},
		},
	}
	if err := stream.Send(initReq); err != nil {
		return err
	}

	errChan := make(chan error, 2)

	// Read from stdin, send to stream
	go func() {
		buf := make([]byte, 4096)
		var seq uint64 = 1
		for {
			n, err := os.Stdin.Read(buf)
			if err == io.EOF {
				closeReq := &pb.PortForwardRequest{
					Message: &pb.PortForwardRequest_Close{
						Close: &pb.PortForwardClose{Reason: "client closed"},
					},
				}
				stream.Send(closeReq)
				errChan <- nil
				return
			}
			if err != nil {
				errChan <- err
				return
			}

			dataReq := &pb.PortForwardRequest{
				Message: &pb.PortForwardRequest_Data{
					Data: &pb.PortForwardData{
						Payload: buf[:n],
						Seq:     seq,
					},
				},
			}
			if err := stream.Send(dataReq); err != nil {
				errChan <- err
				return
			}
			seq++
		}
	}()

	// Read from stream, write to stdout
	go func() {
		var seq uint64 = 1
		for {
			resp, err := stream.Recv()
			if err == io.EOF {
				errChan <- nil
				return
			}
			if err != nil {
				errChan <- err
				return
			}

			if data := resp.GetData(); data != nil {
				// For port-forward, write raw bytes (no JSON framing)
				os.Stdout.Write(data.Payload)
				seq++
			} else if respError := resp.GetError(); respError != nil {
				outputError(respError.Code, respError.Message, seq)
				errChan <- fmt.Errorf("remote error: %s", respError.Message)
				return
			} else if resp.GetClose() != nil {
				errChan <- nil
				return
			}
		}
	}()

	return <-errChan
}

func handleRsync(ctx context.Context, client pb.RouterClientServiceClient) error {
	stream, err := client.Rsync(ctx)
	if err != nil {
		return err
	}

	// Send init message
	initReq := &pb.RsyncRequest{
		Message: &pb.RsyncRequest_Init{
			Init: &pb.RsyncInit{
				SessionKey: *sessionKey,
				Cookie:     *cookie,
				WorkflowId: *workflowID,
				Direction:  "upload", // Could be parameterized
			},
		},
	}
	if err := stream.Send(initReq); err != nil {
		return err
	}

	errChan := make(chan error, 2)

	// Read from stdin, send to stream
	go func() {
		buf := make([]byte, 4096)
		var seq uint64 = 1
		for {
			n, err := os.Stdin.Read(buf)
			if err == io.EOF {
				closeReq := &pb.RsyncRequest{
					Message: &pb.RsyncRequest_Close{
						Close: &pb.RsyncClose{Success: true},
					},
				}
				stream.Send(closeReq)
				errChan <- nil
				return
			}
			if err != nil {
				errChan <- err
				return
			}

			dataReq := &pb.RsyncRequest{
				Message: &pb.RsyncRequest_Data{
					Data: &pb.RsyncData{
						Payload: buf[:n],
						Seq:     seq,
					},
				},
			}
			if err := stream.Send(dataReq); err != nil {
				errChan <- err
				return
			}
			seq++
		}
	}()

	// Read from stream, write to stdout
	go func() {
		for {
			resp, err := stream.Recv()
			if err == io.EOF {
				errChan <- nil
				return
			}
			if err != nil {
				errChan <- err
				return
			}

			if data := resp.GetData(); data != nil {
				// For rsync, write raw bytes
				os.Stdout.Write(data.Payload)
			} else if respError := resp.GetError(); respError != nil {
				outputError(respError.Code, respError.Message, 0)
				errChan <- fmt.Errorf("remote error: %s", respError.Message)
				return
			} else if resp.GetClose() != nil {
				errChan <- nil
				return
			}
		}
	}()

	return <-errChan
}

func outputData(dataType string, data []byte, seq uint64) {
	frame := OutputFrame{
		Type:      dataType,
		Seq:       seq,
		Data:      base64.StdEncoding.EncodeToString(data),
		Timestamp: time.Now().Format(time.RFC3339),
	}
	outputFrame(frame)
}

func outputError(code, message string, seq uint64) {
	frame := OutputFrame{
		Type:      "error",
		Seq:       seq,
		Code:      code,
		Message:   message,
		Timestamp: time.Now().Format(time.RFC3339),
	}
	outputFrame(frame)
}

func outputFrame(frame OutputFrame) {
	data, err := json.Marshal(frame)
	if err != nil {
		log.Printf("Failed to marshal frame: %v", err)
		return
	}
	fmt.Println(string(data))
}
