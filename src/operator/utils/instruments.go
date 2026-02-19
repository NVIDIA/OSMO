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
	"fmt"

	"go.opentelemetry.io/otel/metric"
	"go.opentelemetry.io/otel/metric/noop"
)

// Instruments holds pre-created, typed OTEL metric instrument handles for all
// operator listeners. All fields are safe for concurrent use by multiple goroutines
// per the OpenTelemetry Go SDK specification.
//
// A single *Instruments is shared across all four listener goroutines — this is
// correct because the SDK instruments are goroutine-safe and the SDK deduplicates
// instruments by name internally.
type Instruments struct {
	// BaseListener — shared by all listeners via base_listener.go
	GRPCDisconnectCount      metric.Int64Counter
	MessageAckReceivedTotal  metric.Int64Counter
	UnackedMessageQueueDepth metric.Float64Histogram
	GoroutinePanicTotal      metric.Int64Counter
	GRPCStreamSendErrorTotal metric.Int64Counter
	GRPCMessageSendDuration  metric.Float64Histogram
	MessageSentTotal         metric.Int64Counter

	// Cross-listener informer / channel metrics
	KubeEventWatchCount              metric.Int64Counter
	MessageQueuedTotal               metric.Int64Counter
	MessageChannelPending            metric.Float64Histogram
	MessageChannelClosedUnexpectedly metric.Int64Counter
	EventWatchConnectionErrorCount   metric.Int64Counter
	InformerCacheSyncFailure         metric.Int64Counter
	InformerCacheSyncSuccess         metric.Int64Counter
	InformerRebuildTotal             metric.Int64Counter

	// listener.go retry metrics
	ListenerRetryTotal          metric.Int64Counter
	ListenerRetryBackoffSeconds metric.Float64Histogram
	BackendInitRetryTotal       metric.Int64Counter

	// WorkflowListener-specific
	WorkflowPodStateChangeTotal metric.Int64Counter
	EventProcessingTimes        metric.Float64Histogram

	// NodeListener-specific
	NodeInventorySize metric.Float64Histogram

	// NodeUsageListener-specific
	NodeUsageFlushDuration   metric.Float64Histogram
	NodeUsageFlushNodesCount metric.Float64Histogram

	// EventListener-specific
	EventDeduplicatedTotal metric.Int64Counter
	EventTrackerSize       metric.Float64Histogram
}

// NewInstruments creates all instrument handles from the given meter.
// Must be called after otel.SetMeterProvider so instruments are backed by a
// real exporter rather than the default no-op provider.
//
// Returns an error if any instrument fails to create, which typically indicates
// a programming error such as duplicate instrument names with different types/units.
func NewInstruments(meter metric.Meter) (*Instruments, error) {
	inst := &Instruments{}
	var err error

	inst.GRPCDisconnectCount, err = meter.Int64Counter(
		"grpc_disconnect_count",
		metric.WithDescription("Count of gRPC stream disconnections"),
		metric.WithUnit("1"),
	)
	if err != nil {
		return nil, fmt.Errorf("failed to create instrument grpc_disconnect_count: %w", err)
	}

	inst.MessageAckReceivedTotal, err = meter.Int64Counter(
		"message_ack_received_total",
		metric.WithDescription("Total ACK messages received from the server"),
		metric.WithUnit("1"),
	)
	if err != nil {
		return nil, fmt.Errorf("failed to create instrument message_ack_received_total: %w", err)
	}

	inst.UnackedMessageQueueDepth, err = meter.Float64Histogram(
		"unacked_message_queue_depth",
		metric.WithDescription("Number of messages awaiting ACK from the server"),
		metric.WithUnit("1"),
	)
	if err != nil {
		return nil, fmt.Errorf("failed to create instrument unacked_message_queue_depth: %w", err)
	}

	inst.GoroutinePanicTotal, err = meter.Int64Counter(
		"goroutine_panic_total",
		metric.WithDescription("Panics caught in listener goroutines"),
		metric.WithUnit("1"),
	)
	if err != nil {
		return nil, fmt.Errorf("failed to create instrument goroutine_panic_total: %w", err)
	}

	inst.GRPCStreamSendErrorTotal, err = meter.Int64Counter(
		"grpc_stream_send_error_total",
		metric.WithDescription("Count of errors sending messages over gRPC stream"),
		metric.WithUnit("1"),
	)
	if err != nil {
		return nil, fmt.Errorf("failed to create instrument grpc_stream_send_error_total: %w", err)
	}

	inst.GRPCMessageSendDuration, err = meter.Float64Histogram(
		"grpc_message_send_duration_seconds",
		metric.WithDescription("Duration of gRPC stream Send call"),
		metric.WithUnit("s"),
	)
	if err != nil {
		return nil, fmt.Errorf("failed to create instrument grpc_message_send_duration_seconds: %w", err)
	}

	inst.MessageSentTotal, err = meter.Int64Counter(
		"message_sent_total",
		metric.WithDescription("Total messages successfully sent over gRPC stream"),
		metric.WithUnit("1"),
	)
	if err != nil {
		return nil, fmt.Errorf("failed to create instrument message_sent_total: %w", err)
	}

	inst.KubeEventWatchCount, err = meter.Int64Counter(
		"kube_event_watch_count",
		metric.WithDescription("Number of Kubernetes events received from informer watches"),
		metric.WithUnit("1"),
	)
	if err != nil {
		return nil, fmt.Errorf("failed to create instrument kube_event_watch_count: %w", err)
	}

	inst.MessageQueuedTotal, err = meter.Int64Counter(
		"message_queued_total",
		metric.WithDescription("Total messages added to listener channel buffer"),
		metric.WithUnit("1"),
	)
	if err != nil {
		return nil, fmt.Errorf("failed to create instrument message_queued_total: %w", err)
	}

	inst.MessageChannelPending, err = meter.Float64Histogram(
		"message_channel_pending",
		metric.WithDescription("Number of messages pending in the listener channel buffer"),
		metric.WithUnit("1"),
	)
	if err != nil {
		return nil, fmt.Errorf("failed to create instrument message_channel_pending: %w", err)
	}

	inst.MessageChannelClosedUnexpectedly, err = meter.Int64Counter(
		"message_channel_closed_unexpectedly_total",
		metric.WithDescription("Message channel closed without context cancellation"),
		metric.WithUnit("1"),
	)
	if err != nil {
		return nil, fmt.Errorf("failed to create instrument message_channel_closed_unexpectedly_total: %w", err)
	}

	inst.EventWatchConnectionErrorCount, err = meter.Int64Counter(
		"event_watch_connection_error_count",
		metric.WithDescription("Count of connection errors when watching Kubernetes resources"),
		metric.WithUnit("1"),
	)
	if err != nil {
		return nil, fmt.Errorf("failed to create instrument event_watch_connection_error_count: %w", err)
	}

	inst.InformerCacheSyncFailure, err = meter.Int64Counter(
		"informer_cache_sync_failure",
		metric.WithDescription("Failed informer cache synchronizations"),
		metric.WithUnit("1"),
	)
	if err != nil {
		return nil, fmt.Errorf("failed to create instrument informer_cache_sync_failure: %w", err)
	}

	inst.InformerCacheSyncSuccess, err = meter.Int64Counter(
		"informer_cache_sync_success",
		metric.WithDescription("Successful informer cache synchronizations"),
		metric.WithUnit("1"),
	)
	if err != nil {
		return nil, fmt.Errorf("failed to create instrument informer_cache_sync_success: %w", err)
	}

	inst.InformerRebuildTotal, err = meter.Int64Counter(
		"informer_rebuild_total",
		metric.WithDescription("Number of full state rebuilds from informer store"),
		metric.WithUnit("1"),
	)
	if err != nil {
		return nil, fmt.Errorf("failed to create instrument informer_rebuild_total: %w", err)
	}

	inst.ListenerRetryTotal, err = meter.Int64Counter(
		"listener_retry_total",
		metric.WithDescription("Total number of listener retry attempts after connection failure"),
		metric.WithUnit("1"),
	)
	if err != nil {
		return nil, fmt.Errorf("failed to create instrument listener_retry_total: %w", err)
	}

	inst.ListenerRetryBackoffSeconds, err = meter.Float64Histogram(
		"listener_retry_backoff_seconds",
		metric.WithDescription("Backoff duration between listener retry attempts"),
		metric.WithUnit("s"),
	)
	if err != nil {
		return nil, fmt.Errorf("failed to create instrument listener_retry_backoff_seconds: %w", err)
	}

	inst.BackendInitRetryTotal, err = meter.Int64Counter(
		"backend_init_retry_total",
		metric.WithDescription("Retry attempts during backend initialization"),
		metric.WithUnit("1"),
	)
	if err != nil {
		return nil, fmt.Errorf("failed to create instrument backend_init_retry_total: %w", err)
	}

	inst.WorkflowPodStateChangeTotal, err = meter.Int64Counter(
		"workflow_pod_state_change_total",
		metric.WithDescription("Workflow pod state changes sent to the service"),
		metric.WithUnit("1"),
	)
	if err != nil {
		return nil, fmt.Errorf("failed to create instrument workflow_pod_state_change_total: %w", err)
	}

	inst.EventProcessingTimes, err = meter.Float64Histogram(
		"event_processing_times",
		metric.WithDescription("Time elapsed between event occurrence and processing"),
		metric.WithUnit("s"),
	)
	if err != nil {
		return nil, fmt.Errorf("failed to create instrument event_processing_times: %w", err)
	}

	inst.NodeInventorySize, err = meter.Float64Histogram(
		"node_inventory_size",
		metric.WithDescription("Number of hostnames in NODE_INVENTORY messages"),
		metric.WithUnit("1"),
	)
	if err != nil {
		return nil, fmt.Errorf("failed to create instrument node_inventory_size: %w", err)
	}

	inst.NodeUsageFlushDuration, err = meter.Float64Histogram(
		"node_usage_flush_duration_seconds",
		metric.WithDescription("Duration of dirty node usage flush cycle"),
		metric.WithUnit("s"),
	)
	if err != nil {
		return nil, fmt.Errorf("failed to create instrument node_usage_flush_duration_seconds: %w", err)
	}

	inst.NodeUsageFlushNodesCount, err = meter.Float64Histogram(
		"node_usage_flush_nodes_count",
		metric.WithDescription("Number of dirty nodes flushed per usage update cycle"),
		metric.WithUnit("1"),
	)
	if err != nil {
		return nil, fmt.Errorf("failed to create instrument node_usage_flush_nodes_count: %w", err)
	}

	inst.EventDeduplicatedTotal, err = meter.Int64Counter(
		"event_deduplicated_total",
		metric.WithDescription("Events skipped due to deduplication"),
		metric.WithUnit("1"),
	)
	if err != nil {
		return nil, fmt.Errorf("failed to create instrument event_deduplicated_total: %w", err)
	}

	inst.EventTrackerSize, err = meter.Float64Histogram(
		"event_tracker_size",
		metric.WithDescription("Number of entries in event deduplication tracker after cleanup"),
		metric.WithUnit("1"),
	)
	if err != nil {
		return nil, fmt.Errorf("failed to create instrument event_tracker_size: %w", err)
	}

	return inst, nil
}

// NewNoopInstruments returns an Instruments backed by OTEL's built-in no-op provider.
// Use when metrics are disabled or InitOTEL fails. All Add()/Record() calls are
// zero-cost no-ops; no nil checks are needed at call sites.
//
// The noop provider never returns errors, so this function ignores the error return.
func NewNoopInstruments() *Instruments {
	inst, _ := NewInstruments(noop.NewMeterProvider().Meter("noop"))
	return inst
}
