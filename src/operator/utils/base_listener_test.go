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

package utils

import (
	"context"
	"fmt"
	"testing"
	"time"

	pb "go.corp.nvidia.com/osmo/proto/operator"
)

func TestRun_WatchError(t *testing.T) {
	bl := NewBaseListener(
		ListenerArgs{
			ServiceURL:         "http://localhost:19999",
			Backend:            "test-backend",
			MaxUnackedMessages: 100,
			ProgressDir:        "/tmp/osmo/test/",
		},
		"test_progress",
		StreamNameNode,
		NewNoopInstruments(),
	)

	watchErr := fmt.Errorf("watch failed")
	watch := func(ctx context.Context, ch chan<- *pb.ListenerMessage) error {
		return watchErr
	}
	sendMessages := func(ctx context.Context, ch <-chan *pb.ListenerMessage) error {
		for range ch {
			// drain
		}
		return nil
	}

	ch := make(chan *pb.ListenerMessage, 10)
	err := bl.Run(context.Background(), "test", ch, watch, sendMessages)
	if err == nil {
		t.Fatal("expected error from Run, got nil")
	}
	if err.Error() != "listener error: watch failed" {
		t.Errorf("unexpected error: %v", err)
	}
}

func TestRun_ContextCancellation(t *testing.T) {
	bl := NewBaseListener(
		ListenerArgs{
			ServiceURL:         "http://localhost:19999",
			Backend:            "test-backend",
			MaxUnackedMessages: 100,
			ProgressDir:        "/tmp/osmo/test/",
		},
		"test_progress",
		StreamNameNode,
		NewNoopInstruments(),
	)

	ctx, cancel := context.WithCancel(context.Background())

	watch := func(ctx context.Context, ch chan<- *pb.ListenerMessage) error {
		<-ctx.Done()
		return nil
	}
	sendMessages := func(ctx context.Context, ch <-chan *pb.ListenerMessage) error {
		<-ctx.Done()
		return nil
	}

	errChan := make(chan error, 1)
	go func() {
		ch := make(chan *pb.ListenerMessage, 10)
		errChan <- bl.Run(ctx, "test", ch, watch, sendMessages)
	}()

	// Cancel after a short delay
	time.Sleep(50 * time.Millisecond)
	cancel()

	select {
	case err := <-errChan:
		if err != context.Canceled {
			t.Errorf("expected context.Canceled, got: %v", err)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("test timed out")
	}
}

func TestRun_SendMessagesError(t *testing.T) {
	bl := NewBaseListener(
		ListenerArgs{
			ServiceURL:         "http://localhost:19999",
			Backend:            "test-backend",
			MaxUnackedMessages: 100,
			ProgressDir:        "/tmp/osmo/test/",
		},
		"test_progress",
		StreamNameNode,
		NewNoopInstruments(),
	)

	sendErr := fmt.Errorf("send failed")
	watch := func(ctx context.Context, ch chan<- *pb.ListenerMessage) error {
		<-ctx.Done()
		return nil
	}
	sendMessages := func(ctx context.Context, ch <-chan *pb.ListenerMessage) error {
		return sendErr
	}

	ch := make(chan *pb.ListenerMessage, 10)
	err := bl.Run(context.Background(), "test", ch, watch, sendMessages)
	if err == nil {
		t.Fatal("expected error from Run, got nil")
	}
	if err.Error() != "listener error: send failed" {
		t.Errorf("unexpected error: %v", err)
	}
}

func TestBaseListener_Logf(t *testing.T) {
	bl := NewBaseListener(
		ListenerArgs{
			ServiceURL:         "http://localhost:19999",
			Backend:            "test-backend",
			MaxUnackedMessages: 100,
			ProgressDir:        "/tmp/osmo/test/",
		},
		"test_progress",
		StreamNameNode,
		NewNoopInstruments(),
	)

	// Should not panic
	bl.Logf("test message %s", "hello")
}

func TestBaseListener_GetStreamName(t *testing.T) {
	bl := NewBaseListener(
		ListenerArgs{
			ServiceURL:         "http://localhost:19999",
			Backend:            "test-backend",
			MaxUnackedMessages: 100,
			ProgressDir:        "/tmp/osmo/test/",
		},
		"test_progress",
		StreamNameNode,
		NewNoopInstruments(),
	)

	if bl.GetStreamName() != StreamNameNode {
		t.Errorf("expected %s, got %s", StreamNameNode, bl.GetStreamName())
	}
}
