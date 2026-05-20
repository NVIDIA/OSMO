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
	"google.golang.org/grpc/credentials/insecure"
	"google.golang.org/grpc/test/bufconn"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime"
	utilruntime "k8s.io/apimachinery/pkg/util/runtime"
	clientgoscheme "k8s.io/client-go/kubernetes/scheme"
	"sigs.k8s.io/controller-runtime/pkg/client/fake"

	v1alpha1 "github.com/nvidia/osmo/taskgroup/api/v1alpha1"
	operatorpb "github.com/nvidia/osmo/taskgroup/operator/proto"
)

func metaName(name, namespace string) metav1.ObjectMeta {
	return metav1.ObjectMeta{Name: name, Namespace: namespace}
}

// fakeServer accepts any Hello, optionally drops the stream after the first non-Hello
// message has been received, and records each incoming envelope on a channel.
type fakeServer struct {
	operatorpb.UnimplementedClusterSessionServer

	mu       sync.Mutex
	received chan *operatorpb.ControllerEnvelope
	acceptN  int32
	count    int32
}

func (s *fakeServer) Connect(stream operatorpb.ClusterSession_ConnectServer) error {
	first, err := stream.Recv()
	if err != nil {
		return err
	}
	if first.GetHello() == nil {
		return nil
	}
	if err := stream.Send(&operatorpb.OperatorEnvelope{
		Body: &operatorpb.OperatorEnvelope_HelloAck{HelloAck: &operatorpb.HelloAck{SessionId: "test"}},
	}); err != nil {
		return err
	}
	// dropAfter is the per-connection limit. 0 = never drop.
	dropAfter := atomic.LoadInt32(&s.acceptN)
	var perConn int32
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
		perConn++
		atomic.AddInt32(&s.count, 1)
		if dropAfter > 0 && perConn >= dropAfter {
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

// startFakeServer spins up a fakeServer over bufconn and returns the listener + a Dial
// function configured to route through it.
func startFakeServer(t *testing.T, srv *fakeServer) (*bufconn.Listener, func()) {
	t.Helper()
	listener := bufconn.Listen(1024 * 1024)
	gsrv := grpc.NewServer()
	operatorpb.RegisterClusterSessionServer(gsrv, srv)
	go func() { _ = gsrv.Serve(listener) }()
	return listener, gsrv.Stop
}

func bufconnDial(listener *bufconn.Listener) func(context.Context, string) (*grpc.ClientConn, error) {
	return func(ctx context.Context, _ string) (*grpc.ClientConn, error) {
		return grpc.DialContext(ctx, "bufnet",
			grpc.WithContextDialer(func(_ context.Context, _ string) (net.Conn, error) {
				return listener.Dial()
			}),
			grpc.WithTransportCredentials(insecure.NewCredentials()),
		)
	}
}

func TestClient_PushStatusReachesServer(t *testing.T) {
	srv := &fakeServer{received: make(chan *operatorpb.ControllerEnvelope, 16)}
	listener, stop := startFakeServer(t, srv)
	defer stop()

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	k8s := fake.NewClientBuilder().WithScheme(testScheme(t)).Build()
	c, err := NewClient(Config{
		OperatorEndpoint:  "bufnet",
		ClusterID:         "c1",
		Token:             "tok",
		HeartbeatInterval: time.Hour,
		MinBackoff:        10 * time.Millisecond,
		MaxBackoff:        20 * time.Millisecond,
		SendBuffer:        16,
		Dial:              bufconnDial(listener),
	}, k8s)
	if err != nil {
		t.Fatalf("NewClient: %v", err)
	}

	runErr := make(chan error, 1)
	go func() { runErr <- c.Run(ctx) }()
	defer cancel()

	c.PushStatus(&v1alpha1.OSMOTaskGroup{
		Spec: v1alpha1.OSMOTaskGroupSpec{WorkflowID: "wf-1"},
		Status: v1alpha1.OSMOTaskGroupStatus{
			Phase:   v1alpha1.PhaseRunning,
			Message: "go go go",
		},
	})

	select {
	case got := <-srv.received:
		ev := got.GetStatus()
		if ev == nil {
			t.Fatalf("expected status event, got %T", got.Body)
		}
		if ev.Status.Phase != "Running" || ev.Status.Message != "go go go" {
			t.Errorf("unexpected status: %+v", ev.Status)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("server never received the status event")
	}
}

// TestClient_ReconnectFlushesQueuedStatus actually exercises reconnect: the fakeServer
// drops the stream after one non-Hello message; the client's writer requeues and the
// next connect attempt sends the still-queued envelope to a second accepting session.
func TestClient_ReconnectFlushesQueuedStatus(t *testing.T) {
	srv := &fakeServer{received: make(chan *operatorpb.ControllerEnvelope, 16)}
	atomic.StoreInt32(&srv.acceptN, 1) // drop the first session after one message
	listener, stop := startFakeServer(t, srv)
	defer stop()

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	k8s := fake.NewClientBuilder().WithScheme(testScheme(t)).Build()
	c, err := NewClient(Config{
		OperatorEndpoint:  "bufnet",
		ClusterID:         "c1",
		Token:             "tok",
		HeartbeatInterval: time.Hour,
		MinBackoff:        10 * time.Millisecond,
		MaxBackoff:        20 * time.Millisecond,
		SendBuffer:        4,
		Dial:              bufconnDial(listener),
	}, k8s)
	if err != nil {
		t.Fatalf("NewClient: %v", err)
	}
	runErr := make(chan error, 1)
	go func() { runErr <- c.Run(ctx) }()

	// Push the first status event and wait for the server to receive it. The fakeServer
	// returns from Connect after this one (dropAfter=1), forcing a reconnect.
	c.PushStatus(&v1alpha1.OSMOTaskGroup{
		Status: v1alpha1.OSMOTaskGroupStatus{Phase: v1alpha1.PhaseRunning, Message: "first"},
	})
	if !waitStatusReceived(srv.received, "first", 2*time.Second) {
		t.Fatal("first status never reached server")
	}

	// Give the client a moment to notice the dropped stream and reconnect; the previous
	// Send may still be unwinding when the server returns from Connect.
	time.Sleep(200 * time.Millisecond)

	// Now push a second status. The client must reconnect (because the previous stream
	// was closed by the server) and deliver this event over the new session.
	c.PushStatus(&v1alpha1.OSMOTaskGroup{
		Status: v1alpha1.OSMOTaskGroupStatus{Phase: v1alpha1.PhaseRunning, Message: "second"},
	})
	if !waitStatusReceived(srv.received, "second", 3*time.Second) {
		t.Fatal("second status never reached server after reconnect")
	}
}

func waitStatusReceived(ch <-chan *operatorpb.ControllerEnvelope, message string, timeout time.Duration) bool {
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		select {
		case ev := <-ch:
			if s := ev.GetStatus(); s != nil && s.Status != nil && s.Status.Message == message {
				return true
			}
		case <-time.After(50 * time.Millisecond):
		}
	}
	return false
}

func TestClient_RespondsToResyncRequest(t *testing.T) {
	srv := &fakeServer{received: make(chan *operatorpb.ControllerEnvelope, 16)}
	listener, stop := startFakeServer(t, srv)
	defer stop()

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	// Seed the controller's K8s with two OSMOTaskGroups so the resync handler has work.
	k8s := fake.NewClientBuilder().WithScheme(testScheme(t)).
		WithObjects(
			&v1alpha1.OSMOTaskGroup{ObjectMeta: metaName("otg-a", "osmo-workflows"), Status: v1alpha1.OSMOTaskGroupStatus{Phase: v1alpha1.PhaseRunning}},
			&v1alpha1.OSMOTaskGroup{ObjectMeta: metaName("otg-b", "osmo-workflows"), Status: v1alpha1.OSMOTaskGroupStatus{Phase: v1alpha1.PhaseSucceeded}},
		).Build()

	c, err := NewClient(Config{
		OperatorEndpoint:  "bufnet",
		ClusterID:         "c1",
		Token:             "tok",
		Namespace:         "osmo-workflows",
		HeartbeatInterval: time.Hour,
		MinBackoff:        10 * time.Millisecond,
		MaxBackoff:        20 * time.Millisecond,
		SendBuffer:        16,
		Dial:              bufconnDial(listener),
	}, k8s)
	if err != nil {
		t.Fatalf("NewClient: %v", err)
	}
	go func() { _ = c.Run(ctx) }()

	// Directly invoke handleResync with a request — easier and more deterministic than
	// trying to coerce the server-side fake to send a ResyncRequest envelope.
	c.handleResync(ctx, &operatorpb.ResyncRequest{Namespace: "osmo-workflows"})

	phases := map[string]bool{}
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) && len(phases) < 2 {
		select {
		case ev := <-srv.received:
			if s := ev.GetStatus(); s != nil {
				phases[s.Name] = true
			}
		case <-time.After(200 * time.Millisecond):
		}
	}
	if len(phases) != 2 {
		t.Fatalf("resync did not push both OTGs; saw %d", len(phases))
	}
}
