// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

// Command operator is the gRPC Operator Service.
//
// Phase 1: skeleton only. The proto contract is fixed (operator/proto/operator.proto), but
// the server handlers return Unimplemented. The point of having this binary now is so the
// build system, CI, and deployment manifests already know about it; filling in the handlers
// is incremental.
package main

import (
	"flag"
	"fmt"
	"os"

	osmolog "github.com/nvidia/osmo/taskgroup/internal/log"
)

func main() {
	var bind string
	flag.StringVar(&bind, "bind", ":9000", "Address to bind the gRPC server on.")
	flag.Parse()

	logger := osmolog.New().WithName("taskgroup-operator")
	logger.Info("Operator Service starting", "bind", bind)

	// TODO(phase-2): start a gRPC server here.
	// Implementation outline:
	//   1. listener, err := net.Listen("tcp", bind)
	//   2. s := grpc.NewServer()
	//   3. operatorpb.RegisterOperatorServiceServer(s, &server{client: k8sClient})
	//   4. operatorpb.RegisterBarrierServiceServer(s, &barrierServer{store: barrierStore})
	//   5. s.Serve(listener)
	//
	// The k8sClient is constructed from internal/k8s.Config + the controller-runtime
	// dynamic client (so the server can write CRs without typed bindings).
	//
	// Phase 4 wires in the barrier.Store implementation (Postgres-backed).
	//
	// For Phase 1, exit cleanly so callers don't think the binary is broken.

	fmt.Fprintln(os.Stderr, "operator service is a Phase 1 skeleton — handlers not yet implemented.")
	fmt.Fprintln(os.Stderr, "see cmd/operator/main.go for the implementation outline.")
	os.Exit(0)
}
