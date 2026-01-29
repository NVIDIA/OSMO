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

	pb "go.corp.nvidia.com/osmo/proto/compute_connector"
)

// MessageSender defines the interface for sending messages
type MessageSender interface {
	Send(*pb.ListenerMessage) error
}

// UnackMessages provides flow control and reliability by tracking messages that have been sent
// but not yet acknowledged by the server. When the max limit is reached, sending is
// paused until ACKs are received, preventing unbounded memory growth.
//
// Key features:
// - Thread-safe message tracking using mutex
// - Flow control via readyToSend channel
// - Automatic backpressure when max unacked messages limit is reached
// - Message persistence for potential reconnection scenarios
type UnackMessages struct {
	mu                 sync.RWMutex
	messages           map[string]*pb.ListenerMessage // key: message UUID
	readyToSend        chan struct{}                  // buffered channel for flow control
	maxUnackedMessages int                            // 0 means unlimited
}

// NewUnackMessages creates a new unack messages tracker
func NewUnackMessages(maxUnackedMessages int) *UnackMessages {
	if maxUnackedMessages < 0 {
		maxUnackedMessages = 0
	}

	readyChan := make(chan struct{}, 1)
	readyChan <- struct{}{} // Start in ready state

	return &UnackMessages{
		messages:           make(map[string]*pb.ListenerMessage),
		readyToSend:        readyChan,
		maxUnackedMessages: maxUnackedMessages,
	}
}

// AddMessage adds a message to the unacked queue
func (um *UnackMessages) AddMessage(ctx context.Context, msg *pb.ListenerMessage) error {
	// Wait until ready to send
	select {
	case <-um.readyToSend:
		// Got the ready signal, proceed
	case <-ctx.Done():
		return ctx.Err()
	}

	um.mu.Lock()
	defer um.mu.Unlock()

	um.messages[msg.Uuid] = msg
	queueSize := len(um.messages)

	// Check if we've reached the limit
	if um.maxUnackedMessages > 0 && queueSize >= um.maxUnackedMessages {
		log.Printf("Warning: Reached max unacked message count of %d", um.maxUnackedMessages)
		// Don't put back the ready signal - we're at capacity
	} else {
		// Put the ready signal back
		select {
		case um.readyToSend <- struct{}{}:
		default:
			// Channel already has a signal
		}
	}

	return nil
}

// AddMessageForced adds a message bypassing flow control limits
// Used during channel draining to preserve all pending messages
func (um *UnackMessages) AddMessageForced(msg *pb.ListenerMessage) {
	um.mu.Lock()
	defer um.mu.Unlock()
	um.messages[msg.Uuid] = msg
}

// RemoveMessage removes a message from the unacked queue
func (um *UnackMessages) RemoveMessage(uuid string) {
	um.mu.Lock()
	defer um.mu.Unlock()

	if _, exists := um.messages[uuid]; exists {
		delete(um.messages, uuid)
		select {
		case um.readyToSend <- struct{}{}:
		default:
			// Channel already has a signal
		}
	}
}

// ListMessages returns a slice of all unacked messages in order
func (um *UnackMessages) ListMessages() []*pb.ListenerMessage {
	um.mu.RLock()
	defer um.mu.RUnlock()

	messages := make([]*pb.ListenerMessage, 0, len(um.messages))
	for _, msg := range um.messages {
		messages = append(messages, msg)
	}
	return messages
}

// Qsize returns the number of unacked messages
func (um *UnackMessages) Qsize() int {
	um.mu.RLock()
	defer um.mu.RUnlock()
	return len(um.messages)
}

// ResendAll resends all unacked messages using the provided sender
// This is typically used after reconnection to ensure no messages are lost
func (um *UnackMessages) ResendAll(sender MessageSender) error {
	messages := um.ListMessages()
	if len(messages) == 0 {
		return nil
	}

	log.Printf("Resending %d unacked messages from previous connection", len(messages))
	for _, msg := range messages {
		if err := sender.Send(msg); err != nil {
			return fmt.Errorf("failed to resend unacked message %s: %w", msg.Uuid, err)
		}
	}
	return nil
}
