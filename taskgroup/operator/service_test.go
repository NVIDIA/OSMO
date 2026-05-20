// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

package operator

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"net"
	"testing"
	"time"

	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/credentials/insecure"
	"google.golang.org/grpc/status"
	"google.golang.org/grpc/test/bufconn"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"sigs.k8s.io/controller-runtime/pkg/client/fake"

	v1alpha1 "github.com/nvidia/osmo/taskgroup/api/v1alpha1"
	operatorpb "github.com/nvidia/osmo/taskgroup/operator/proto"
)

// startService spins up a ClusterSessionServer over bufconn and returns a dial function
// + cleanup. Returns the registry so tests can inspect connection state.
func startService(t *testing.T, token string) (dial func(ctx context.Context) (*grpc.ClientConn, error), reg *SessionRegistry, stop func()) {
	t.Helper()

	hash := sha256.Sum256([]byte(token))
	hashHex := hex.EncodeToString(hash[:])
	cluster := &v1alpha1.OSMOCluster{
		ObjectMeta: metav1.ObjectMeta{Name: "c1"},
		Spec: v1alpha1.OSMOClusterSpec{
			TokenSecretRef: &v1alpha1.SecretRef{Name: "tok", Namespace: "osmo-system"},
		},
	}
	secret := &corev1.Secret{
		ObjectMeta: metav1.ObjectMeta{Name: "tok", Namespace: "osmo-system"},
		Data:       map[string][]byte{SecretKeyTokenHash: []byte(hashHex)},
	}
	k8s := fake.NewClientBuilder().WithScheme(testScheme(t)).
		WithObjects(cluster, secret).
		WithStatusSubresource(&v1alpha1.OSMOCluster{}).
		Build()

	reg = NewSessionRegistry()
	srv := &ClusterSessionServer{
		Client:   k8s,
		Auth:     &ClusterAuthenticator{Client: k8s},
		Sessions: reg,
		Status:   NewStatusBus(),
	}

	listener := bufconn.Listen(1024 * 1024)
	gsrv := grpc.NewServer()
	operatorpb.RegisterClusterSessionServer(gsrv, srv)

	go func() {
		_ = gsrv.Serve(listener)
	}()

	dial = func(ctx context.Context) (*grpc.ClientConn, error) {
		return grpc.DialContext(ctx, "bufnet",
			grpc.WithContextDialer(func(_ context.Context, _ string) (net.Conn, error) {
				return listener.Dial()
			}),
			grpc.WithTransportCredentials(insecure.NewCredentials()),
			grpc.WithBlock(),
		)
	}
	stop = func() {
		gsrv.Stop()
	}
	return dial, reg, stop
}

func TestClusterSessionServer_HelloWrongToken(t *testing.T) {
	dial, _, stop := startService(t, "right")
	defer stop()

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	conn, err := dial(ctx)
	if err != nil {
		t.Fatalf("dial: %v", err)
	}
	defer conn.Close()

	stream, err := operatorpb.NewClusterSessionClient(conn).Connect(ctx)
	if err != nil {
		t.Fatalf("open stream: %v", err)
	}
	if err := stream.Send(&operatorpb.ControllerEnvelope{
		Body: &operatorpb.ControllerEnvelope_Hello{Hello: &operatorpb.Hello{
			ClusterId: "c1", Token: "wrong",
		}},
	}); err != nil {
		t.Fatalf("send Hello: %v", err)
	}
	_, err = stream.Recv()
	if err == nil {
		t.Fatal("expected error from server, got nil")
	}
	if got, want := status.Code(err), codes.Unauthenticated; got != want {
		t.Errorf("status code = %v, want %v (err=%v)", got, want, err)
	}
}

func TestClusterSessionServer_HelloHappyAndReplacement(t *testing.T) {
	dial, reg, stop := startService(t, "supersecret")
	defer stop()

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	openStream := func() operatorpb.ClusterSession_ConnectClient {
		conn, err := dial(ctx)
		if err != nil {
			t.Fatalf("dial: %v", err)
		}
		t.Cleanup(func() { _ = conn.Close() })
		stream, err := operatorpb.NewClusterSessionClient(conn).Connect(ctx)
		if err != nil {
			t.Fatalf("open stream: %v", err)
		}
		if err := stream.Send(&operatorpb.ControllerEnvelope{
			Body: &operatorpb.ControllerEnvelope_Hello{Hello: &operatorpb.Hello{
				ClusterId: "c1", Token: "supersecret",
			}},
		}); err != nil {
			t.Fatalf("send Hello: %v", err)
		}
		// Receive HelloAck to confirm the server accepted us.
		ack, err := stream.Recv()
		if err != nil {
			t.Fatalf("recv HelloAck: %v", err)
		}
		if ack.GetHelloAck() == nil {
			t.Fatalf("expected HelloAck, got %T", ack.Body)
		}
		return stream
	}

	first := openStream()
	// Wait for the registry to see the session.
	deadline := time.Now().Add(time.Second)
	for !reg.Connected("c1") && time.Now().Before(deadline) {
		time.Sleep(10 * time.Millisecond)
	}
	if !reg.Connected("c1") {
		t.Fatal("expected c1 to be registered after Hello")
	}

	// Open a second stream from the same cluster_id — the server should replace the
	// session. The first stream's Recv should error out.
	second := openStream()
	_ = second
	_, err := first.Recv()
	if err == nil {
		t.Fatal("expected first stream to be terminated after replacement")
	}
}
