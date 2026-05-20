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

// Connect is the one bidi RPC. The server reads ControllerEnvelopes and writes
// OperatorEnvelopes on background goroutines, returning as soon as any of three
// conditions occur: the gRPC stream errors, the session is replaced/unregistered, or
// the parent context is cancelled. Returning from Connect closes the underlying gRPC
// stream, which unblocks the client's Recv with an error.
func (s *ClusterSessionServer) Connect(stream operatorpb.ClusterSession_ConnectServer) error {
	ctx := stream.Context()
	logger := log.FromContext(ctx).WithName("cluster-session")

	first, err := stream.Recv()
	if err != nil {
		return status.Errorf(codes.Unauthenticated, "expected Hello: %v", err)
	}
	hello := first.GetHello()
	if hello == nil {
		return status.Error(codes.InvalidArgument, "first message must be Hello")
	}

	if err := s.Auth.Authenticate(ctx, hello.ClusterId, hello.Token); err != nil {
		logger.Info("hello rejected", "cluster", hello.ClusterId, "error", err.Error())
		return status.Error(codes.Unauthenticated, "unauthorized")
	}
	logger = logger.WithValues("cluster", hello.ClusterId)

	sess := s.Sessions.Register(hello.ClusterId, SendBufferSize)
	defer s.Sessions.Unregister(hello.ClusterId, sess)

	s.updateClusterConnection(ctx, hello, v1alpha1.ClusterConnected)
	defer func() {
		// Only the session that is still the current registration writes Disconnected.
		// A session that has been replaced must not clobber the new session's
		// Connected state on its way out.
		if s.Sessions.isCurrent(hello.ClusterId, sess) {
			s.updateClusterConnection(context.Background(), hello, v1alpha1.ClusterDisconnected)
		}
	}()

	if err := sess.sendEnvelope(&operatorpb.OperatorEnvelope{
		Body: &operatorpb.OperatorEnvelope_HelloAck{HelloAck: &operatorpb.HelloAck{
			SessionId: hello.ClusterId + ":" + time.Now().UTC().Format(time.RFC3339Nano),
		}},
	}); err != nil {
		return status.Error(codes.Aborted, "session terminated before HelloAck")
	}

	// Ask the controller to push the current status of every OSMOTaskGroup it owns so a
	// freshly started or restarted operator recovers cross-cluster status without
	// waiting for the next event. Failure to enqueue is non-fatal.
	_ = sess.sendEnvelope(&operatorpb.OperatorEnvelope{
		Body: &operatorpb.OperatorEnvelope_Resync{Resync: &operatorpb.ResyncRequest{}},
	})

	writerErr := make(chan error, 1)
	readerErr := make(chan error, 1)

	go func() {
		for {
			select {
			case env, ok := <-sess.Drain():
				if !ok {
					writerErr <- nil
					return
				}
				if err := stream.Send(env); err != nil {
					writerErr <- err
					return
				}
			case <-ctx.Done():
				writerErr <- nil
				return
			}
		}
	}()

	go func() {
		for {
			msg, err := stream.Recv()
			if errors.Is(err, io.EOF) {
				readerErr <- nil
				return
			}
			if err != nil {
				readerErr <- err
				return
			}
			s.handleControllerEnvelope(ctx, hello.ClusterId, msg)
		}
	}()

	logger.Info("session established")
	select {
	case err := <-writerErr:
		return err
	case err := <-readerErr:
		return err
	case <-sess.done:
		// Replaced or explicitly unregistered. Return to close the underlying stream.
		return nil
	case <-ctx.Done():
		return nil
	}
}

// handleControllerEnvelope dispatches an incoming message to the right side-effect.
func (s *ClusterSessionServer) handleControllerEnvelope(ctx context.Context, clusterID string, env *operatorpb.ControllerEnvelope) {
	switch body := env.Body.(type) {
	case *operatorpb.ControllerEnvelope_Status:
		s.Status.Publish(ctx, StatusEvent{ClusterID: clusterID, Event: body.Status})
	case *operatorpb.ControllerEnvelope_Ack:
		// Command acks are informational; the workflow controller is not currently
		// ack-aware. The Send/recv path treats a controller receiving the command as
		// sufficient.
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
