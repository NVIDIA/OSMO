// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

package operator

import (
	"sync"
	"testing"
	"time"

	operatorpb "github.com/nvidia/osmo/taskgroup/operator/proto"
)

func TestSessionRegistry_RegisterAndSend(t *testing.T) {
	r := NewSessionRegistry()
	sess := r.Register("cluster-a", 4)

	if !r.Connected("cluster-a") {
		t.Fatal("expected cluster-a to be Connected after Register")
	}

	if err := r.Send("cluster-a", &operatorpb.OperatorEnvelope{}); err != nil {
		t.Fatalf("Send failed: %v", err)
	}

	select {
	case <-sess.Drain():
	case <-time.After(time.Second):
		t.Fatal("expected envelope to arrive on drain")
	}
}

func TestSessionRegistry_SendNotConnected(t *testing.T) {
	r := NewSessionRegistry()
	err := r.Send("nonexistent", &operatorpb.OperatorEnvelope{})
	if err != ErrClusterNotConnected {
		t.Errorf("expected ErrClusterNotConnected, got %v", err)
	}
}

func TestSessionRegistry_RegisterReplacesPrevious(t *testing.T) {
	r := NewSessionRegistry()
	first := r.Register("cluster-a", 4)
	second := r.Register("cluster-a", 4)

	// First session's done should now be closed.
	select {
	case <-first.done:
	case <-time.After(time.Second):
		t.Fatal("expected first session's done channel to be closed by replacement")
	}

	// Sends to "cluster-a" now go to the second session.
	if err := r.Send("cluster-a", &operatorpb.OperatorEnvelope{}); err != nil {
		t.Fatalf("Send to replacement failed: %v", err)
	}
	select {
	case <-second.Drain():
	case <-time.After(time.Second):
		t.Fatal("envelope should arrive on the replacement's drain")
	}
}

func TestSessionRegistry_SendDoesNotPanicOnShutdown(t *testing.T) {
	// Race-test: many concurrent senders against a session that gets replaced. Without
	// the done-channel guard, the channel-close race would panic. The Go race detector
	// (-race) plus this test catches regressions.
	r := NewSessionRegistry()
	r.Register("c", 4)

	var wg sync.WaitGroup
	for i := 0; i < 20; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for j := 0; j < 50; j++ {
				_ = r.Send("c", &operatorpb.OperatorEnvelope{})
			}
		}()
	}

	// Continuously replace the session while senders are running. Each replacement closes
	// the previous session's done, so any send racing with it returns
	// ErrClusterNotConnected instead of panicking. We keep replacing until all senders
	// have finished — that guarantees no sender is left blocked on a full buffer.
	done := make(chan struct{})
	go func() {
		wg.Wait()
		close(done)
	}()
replaceLoop:
	for {
		select {
		case <-done:
			break replaceLoop
		default:
			r.Register("c", 4)
			time.Sleep(time.Microsecond * 50)
		}
	}
}

func TestSessionRegistry_UnregisterOnlyIfStillCurrent(t *testing.T) {
	r := NewSessionRegistry()
	first := r.Register("c", 1)
	second := r.Register("c", 1)

	// Stale Unregister with the first session — should NOT remove the second one.
	r.Unregister("c", first)

	if !r.Connected("c") {
		t.Fatal("stale Unregister should not remove the current session")
	}

	// Proper Unregister with the second session — should remove.
	r.Unregister("c", second)

	if r.Connected("c") {
		t.Fatal("Unregister with the current session should remove it")
	}
}
