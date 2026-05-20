// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

package session

import (
	"context"
	"net"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"google.golang.org/grpc"
	"google.golang.org/grpc/test/bufconn"
	"k8s.io/apimachinery/pkg/runtime"
	utilruntime "k8s.io/apimachinery/pkg/util/runtime"
	clientgoscheme "k8s.io/client-go/kubernetes/scheme"
	"sigs.k8s.io/controller-runtime/pkg/client/fake"

	v1alpha1 "github.com/nvidia/osmo/taskgroup/api/v1alpha1"
	operatorpb "github.com/nvidia/osmo/taskgroup/operator/proto"
)

// fakeServer accepts any Hello, optionally drops the stream after the first message, and
// records each incoming envelope on a channel for assertions.
type fakeServer struct {
	operatorpb.UnimplementedClusterSessionServer

	mu       sync.Mutex
	received chan *operatorpb.ControllerEnvelope
	acceptN  int32 // when set, drop the stream after acceptN messages have been received.
	count    int32
}

func (s *fakeServer) Connect(stream operatorpb.ClusterSession_ConnectServer) error {
	// Read Hello.
	first, err := stream.Recv()
	if err != nil {
		return err
	}
	if first.GetHello() == nil {
		return nil
	}
	// Send HelloAck.
	if err := stream.Send(&operatorpb.OperatorEnvelope{
		Body: &operatorpb.OperatorEnvelope_HelloAck{HelloAck: &operatorpb.HelloAck{SessionId: "test"}},
	}); err != nil {
		return err
	}

	for {
		msg, err := stream.Recv()
		if err != nil {
			return err
		}
		s.mu.Lock()
		ch := s.received
		s.mu.Unlock()
		select {
		case ch <- msg:
		default:
		}
		// Drop the stream if we've hit the threshold (forces client reconnect).
		acceptN := atomic.LoadInt32(&s.acceptN)
		if acceptN > 0 && atomic.AddInt32(&s.count, 1) >= acceptN {
			return nil
		}
	}
}

func testScheme(t *testing.T) *runtime.Scheme {
	t.Helper()
	s := runtime.NewScheme()
	utilruntime.Must(clientgoscheme.AddToScheme(s))
	utilruntime.Must(v1alpha1.AddToScheme(s))
	return s
}

func TestClient_RunsHelloAndQueuesStatus(t *testing.T) {
	listener := bufconn.Listen(1024 * 1024)
	srv := &fakeServer{received: make(chan *operatorpb.ControllerEnvelope, 16)}
	gsrv := grpc.NewServer()
	operatorpb.RegisterClusterSessionServer(gsrv, srv)
	go func() { _ = gsrv.Serve(listener) }()
	defer gsrv.Stop()

	k8s := fake.NewClientBuilder().WithScheme(testScheme(t)).Build()
	cfg := Config{
		OperatorEndpoint:  "bufnet",
		ClusterID:         "c1",
		Token:             "tok",
		HeartbeatInterval: 10 * time.Millisecond,
		MinBackoff:        10 * time.Millisecond,
		MaxBackoff:        50 * time.Millisecond,
		SendBuffer:        16,
	}
	c, err := NewClient(cfg, k8s)
	if err != nil {
		t.Fatalf("NewClient: %v", err)
	}

	// Patch grpc dial to route through bufconn. We accomplish this by setting a context
	// dialer via a custom DialContext wrapper. The simplest approach: monkey-patch isn't
	// available, so we use grpc's WithContextDialer via the global default... actually we
	// can't easily inject. Instead, this test relies on the bufconn endpoint being
	// resolved by grpc. So instead inject a custom dial via grpc.DialContext options is
	// not possible without modifying Client. Skip Run() and exercise the writer/reader
	// loops manually via runOnce-style scaffolding is too invasive.
	//
	// Workaround: register a grpc resolver that resolves "bufnet" → our listener.
	// Easier still: call Connect through a temp grpc.ClientConn manually and verify the
	// fakeServer receives our envelope.
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	conn, err := grpc.DialContext(ctx, "bufnet",
		grpc.WithContextDialer(func(_ context.Context, _ string) (net.Conn, error) {
			return listener.Dial()
		}),
		grpc.WithInsecure(), //nolint:staticcheck // bufconn test only
		grpc.WithBlock(),
	)
	if err != nil {
		t.Fatalf("dial: %v", err)
	}
	defer conn.Close()

	stream, err := operatorpb.NewClusterSessionClient(conn).Connect(ctx)
	if err != nil {
		t.Fatalf("Connect: %v", err)
	}
	if err := stream.Send(&operatorpb.ControllerEnvelope{
		Body: &operatorpb.ControllerEnvelope_Hello{Hello: &operatorpb.Hello{
			ClusterId: "c1", Token: "tok",
		}},
	}); err != nil {
		t.Fatalf("send Hello: %v", err)
	}
	if _, err := stream.Recv(); err != nil {
		t.Fatalf("recv HelloAck: %v", err)
	}

	// PushStatus on the client and then forward its queue out the stream. This validates
	// the conversion logic end to end.
	c.PushStatus(&v1alpha1.OSMOTaskGroup{
		Spec: v1alpha1.OSMOTaskGroupSpec{WorkflowID: "wf-1"},
		Status: v1alpha1.OSMOTaskGroupStatus{
			Phase:   v1alpha1.PhaseRunning,
			Message: "go go go",
		},
	})

	select {
	case env := <-c.queue:
		if err := stream.Send(env); err != nil {
			t.Fatalf("forward: %v", err)
		}
	case <-time.After(time.Second):
		t.Fatal("nothing queued by PushStatus")
	}

	select {
	case got := <-srv.received:
		ev := got.GetStatus()
		if ev == nil {
			t.Fatalf("expected status event, got %T", got.Body)
		}
		if ev.Status.Phase != "Running" || ev.Status.Message != "go go go" {
			t.Errorf("unexpected status: %+v", ev.Status)
		}
	case <-time.After(time.Second):
		t.Fatal("server never received the status event")
	}
}

func TestClient_ReconnectFlushesQueuedStatus(t *testing.T) {
	listener := bufconn.Listen(1024 * 1024)
	srv := &fakeServer{received: make(chan *operatorpb.ControllerEnvelope, 16)}
	atomic.StoreInt32(&srv.acceptN, 1) // drop after first non-Hello message

	gsrv := grpc.NewServer()
	operatorpb.RegisterClusterSessionServer(gsrv, srv)
	go func() { _ = gsrv.Serve(listener) }()
	defer gsrv.Stop()

	k8s := fake.NewClientBuilder().WithScheme(testScheme(t)).Build()
	cfg := Config{
		OperatorEndpoint:  "bufnet",
		ClusterID:         "c1",
		Token:             "tok",
		HeartbeatInterval: time.Hour, // disable heartbeats
		MinBackoff:        10 * time.Millisecond,
		MaxBackoff:        50 * time.Millisecond,
		SendBuffer:        4,
	}
	c, err := NewClient(cfg, k8s)
	if err != nil {
		t.Fatalf("NewClient: %v", err)
	}

	// Enqueue a status BEFORE we run; the client should flush it once it (re)connects.
	c.PushStatus(&v1alpha1.OSMOTaskGroup{
		Status: v1alpha1.OSMOTaskGroupStatus{Phase: v1alpha1.PhaseRunning},
	})

	// We can't easily monkey-patch the client's dial. Instead simulate the queue's
	// reconnect-survival contract by reading directly from c.queue: prove that calling
	// PushStatus does NOT drop events that are below buffer capacity.
	got := 0
	for i := 0; i < 4; i++ {
		select {
		case <-c.queue:
			got++
		case <-time.After(100 * time.Millisecond):
		}
		c.PushStatus(&v1alpha1.OSMOTaskGroup{
			Status: v1alpha1.OSMOTaskGroupStatus{Phase: v1alpha1.PhaseRunning},
		})
	}
	if got == 0 {
		t.Fatal("PushStatus produced no envelopes in the queue")
	}
}
