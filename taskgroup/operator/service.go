// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

package operator

import (
	"context"
	"errors"
	"io"
	"time"

	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/types"
	"sigs.k8s.io/controller-runtime/pkg/client"
	"sigs.k8s.io/controller-runtime/pkg/log"

	v1alpha1 "github.com/nvidia/osmo/taskgroup/api/v1alpha1"
	operatorpb "github.com/nvidia/osmo/taskgroup/operator/proto"
)

// SendBufferSize bounds how many OperatorEnvelopes can queue toward a single controller
// stream before backpressure kicks in. Set generously — these are small control messages
// (KB at most), not data.
const SendBufferSize = 64

// ClusterSessionServer implements operatorpb.ClusterSessionServer.
//
// One server instance handles all connected backend clusters. Streams are demultiplexed
// by cluster_id (registered after Hello). The server is the only thing that knows about
// per-stream state; the Workflow Controller never touches a stream directly — it goes
// through the SessionRegistry's Send() and the StatusBus's Subscribe().
type ClusterSessionServer struct {
	operatorpb.UnimplementedClusterSessionServer

	Client   client.Client      // K8s client to the control cluster (for OSMOCluster status)
	Auth     Authenticator
	Sessions *SessionRegistry
	Status   *StatusBus

	// ControllerVersion is reported back to the controller in HelloAck. Set at startup
	// from the operator binary's build version.
	ControllerVersion string
}

// Connect is the one bidi RPC. The server reads ControllerEnvelopes on one goroutine
// and writes OperatorEnvelopes on another, both gated by the stream's context.
func (s *ClusterSessionServer) Connect(stream operatorpb.ClusterSession_ConnectServer) error {
	ctx := stream.Context()
	logger := log.FromContext(ctx).WithName("cluster-session")

	// Phase 1 of a session: wait for Hello.
	first, err := stream.Recv()
	if err != nil {
		return status.Errorf(codes.Unauthenticated, "expected Hello: %v", err)
	}
	hello := first.GetHello()
	if hello == nil {
		return status.Error(codes.InvalidArgument, "first message must be Hello")
	}

	// Authenticate. Wrong token = treat as unauthenticated, log internally but don't
	// leak details to the caller.
	if err := s.Auth.Authenticate(ctx, hello.ClusterId, hello.Token); err != nil {
		logger.Info("hello rejected", "cluster", hello.ClusterId, "error", err.Error())
		return status.Error(codes.Unauthenticated, "unauthorized")
	}
	logger = logger.WithValues("cluster", hello.ClusterId)

	// Register this stream as THE session for this cluster. Replaces any prior session.
	sendCh := make(chan *operatorpb.OperatorEnvelope, SendBufferSize)
	cancelCh := s.Sessions.Register(hello.ClusterId, sendCh)
	defer s.Sessions.Unregister(hello.ClusterId, cancelCh)
	defer close(sendCh)

	// Update OSMOCluster.status.connection = Connected. Best-effort — if it fails we
	// keep the session alive (the status is informational, the registry is the truth).
	s.updateClusterConnection(ctx, hello, v1alpha1.ClusterConnected)
	defer s.updateClusterConnection(context.Background(), hello, v1alpha1.ClusterDisconnected)

	// Reply with HelloAck on the send channel (will go through the writer goroutine).
	sendCh <- &operatorpb.OperatorEnvelope{
		Body: &operatorpb.OperatorEnvelope_HelloAck{HelloAck: &operatorpb.HelloAck{
			SessionId: hello.ClusterId + ":" + time.Now().UTC().Format(time.RFC3339Nano),
		}},
	}

	// Writer goroutine: pulls envelopes off sendCh and writes to the stream. Returns on
	// channel close (deferred above) or context cancel.
	writerErr := make(chan error, 1)
	go func() {
		for env := range sendCh {
			if err := stream.Send(env); err != nil {
				writerErr <- err
				return
			}
		}
		writerErr <- nil
	}()

	// Reader loop: process ControllerEnvelopes. Runs until Recv error, cancel signal, or
	// context cancel.
	logger.Info("session established")
	for {
		select {
		case <-cancelCh:
			// Replaced by a newer Hello from the same cluster_id.
			return status.Error(codes.Aborted, "session superseded")
		case err := <-writerErr:
			if err != nil {
				logger.Error(err, "writer failed")
				return err
			}
			return nil
		default:
		}

		msg, err := stream.Recv()
		if errors.Is(err, io.EOF) {
			logger.Info("controller closed stream")
			return nil
		}
		if err != nil {
			logger.Error(err, "recv failed")
			return err
		}
		s.handleControllerEnvelope(ctx, hello.ClusterId, msg)
	}
}

// handleControllerEnvelope dispatches an incoming message to the right side-effect.
func (s *ClusterSessionServer) handleControllerEnvelope(ctx context.Context, clusterID string, env *operatorpb.ControllerEnvelope) {
	switch body := env.Body.(type) {
	case *operatorpb.ControllerEnvelope_Status:
		s.Status.Publish(ctx, StatusEvent{ClusterID: clusterID, Event: body.Status})
	case *operatorpb.ControllerEnvelope_Ack:
		// Command acks are informational — log and move on. A Workflow Controller can
		// be made ack-aware later; for Phase 2 MVP we treat the controller having
		// received the command as sufficient.
	case *operatorpb.ControllerEnvelope_LogChunk:
		// Phase 2+ when log streaming is wired through. No-op for now.
	case *operatorpb.ControllerEnvelope_Heartbeat:
		// Keepalive — nothing to do.
	default:
		// Unknown message type. Don't kill the stream over this; just ignore.
	}
}

// updateClusterConnection writes the connection state + lastSeen + supported runtimes
// onto the OSMOCluster status. Best-effort; failures here are non-fatal.
func (s *ClusterSessionServer) updateClusterConnection(ctx context.Context, hello *operatorpb.Hello, state v1alpha1.ClusterConnectionState) {
	if s.Client == nil {
		return
	}
	var cluster v1alpha1.OSMOCluster
	if err := s.Client.Get(ctx, types.NamespacedName{Name: hello.ClusterId}, &cluster); err != nil {
		return
	}
	now := metav1.Now()
	cluster.Status.Connection = state
	cluster.Status.LastSeen = &now
	cluster.Status.ControllerVersion = hello.ControllerVersion
	cluster.Status.SupportedRuntimes = stringsToRuntimeTypes(hello.SupportedRuntimes)
	_ = s.Client.Status().Update(ctx, &cluster)
}

func stringsToRuntimeTypes(in []string) []v1alpha1.RuntimeType {
	out := make([]v1alpha1.RuntimeType, len(in))
	for i, s := range in {
		out[i] = v1alpha1.RuntimeType(s)
	}
	return out
}
