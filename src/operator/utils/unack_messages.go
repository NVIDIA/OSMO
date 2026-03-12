/*
SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION. All rights reserved.

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

package utils

import (
	"context"
	"fmt"
	"log"
	"sync"

	pb "go.corp.nvidia.com/osmo/proto/operator"
)

// UnackMessages tracks messages that have been sent but not yet delivered
// to the server. It provides a bounded buffer with oldest-eviction policy,
// and bulk resend for reconnection scenarios.
type UnackMessages struct {
	mu                 sync.Mutex
	messages           []*pb.ListenerMessage
	maxUnackedMessages int // 0 means unlimited
}

// NewUnackMessages creates a new unack messages tracker
func NewUnackMessages(maxUnackedMessages int) *UnackMessages {
	if maxUnackedMessages < 0 {
		maxUnackedMessages = 0
	}

	return &UnackMessages{
		maxUnackedMessages: maxUnackedMessages,
	}
}

// AddMessageDropOldest adds a message to the unacked queue, evicting the oldest
// message if at capacity. This is non-blocking and used for fire-and-forget
// listeners (e.g., events) where backpressure would cause memory leaks.
func (um *UnackMessages) AddMessageDropOldest(msg *pb.ListenerMessage) {
	um.mu.Lock()
	defer um.mu.Unlock()

	if um.maxUnackedMessages > 0 && len(um.messages) >= um.maxUnackedMessages {
		um.messages = um.messages[1:]
	}
	um.messages = append(um.messages, msg)
}

// Qsize returns the number of unacked messages
func (um *UnackMessages) Qsize() int {
	um.mu.Lock()
	defer um.mu.Unlock()
	return len(um.messages)
}

// ResendAll resends all unacked messages using a unary RPC callback.
// Successfully sent messages are removed from the queue. On failure, iteration
// stops immediately and remaining messages stay in the queue for the next attempt.
func (um *UnackMessages) ResendAll(
	ctx context.Context,
	send func(context.Context, *pb.ListenerMessage) error,
) error {
	um.mu.Lock()
	messages := make([]*pb.ListenerMessage, len(um.messages))
	copy(messages, um.messages)
	um.mu.Unlock()

	if len(messages) == 0 {
		return nil
	}

	log.Printf("Resending %d unacked messages via unary RPC", len(messages))
	for i, msg := range messages {
		if err := send(ctx, msg); err != nil {
			um.mu.Lock()
			um.messages = um.messages[i:]
			um.mu.Unlock()
			return fmt.Errorf("failed to resend unacked message %s: %w", msg.Uuid, err)
		}
	}

	um.mu.Lock()
	um.messages = um.messages[:0]
	um.mu.Unlock()
	return nil
}
