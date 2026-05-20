// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

package session

import (
	"context"
	"errors"
	"fmt"
	"io"
	"time"

	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials/insecure"
	"google.golang.org/protobuf/types/known/timestamppb"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/types"
	"sigs.k8s.io/controller-runtime/pkg/client"
	"sigs.k8s.io/controller-runtime/pkg/log"
	"sigs.k8s.io/yaml"

	v1alpha1 "github.com/nvidia/osmo/taskgroup/api/v1alpha1"
	operatorpb "github.com/nvidia/osmo/taskgroup/operator/proto"
)

// Config configures the controller-side session client.
type Config struct {
	OperatorEndpoint  string        // gRPC endpoint of the Operator Service
	ClusterID         string        // matches an OSMOCluster.metadata.name on the control side
	Token             string        // plaintext bearer; SHA-256 must match the registered hash
	SupportedRuntimes []string      // reported in Hello; informational
	ControllerVersion string        // reported in Hello
	Namespace         string        // OTG namespace this controller manages; used for resync
	HeartbeatInterval time.Duration // default 30s
	MinBackoff        time.Duration // default 1s
	MaxBackoff        time.Duration // default 60s
	SendBuffer        int           // outbound queue depth, default 64

	// Dial, when non-nil, replaces the default gRPC dial. Tests use this with bufconn
	// dialers; production leaves it nil.
	Dial func(ctx context.Context, endpoint string) (*grpc.ClientConn, error)
}

// Client maintains a long-lived bidi stream to the Operator Service.
//
// Outbound events (status updates, command acks) are pushed onto an internal queue and
// drained by the writer goroutine. When the stream drops, the writer goroutine exits
// and the queue is preserved until reconnect — events buffered during a disconnect are
// flushed on the next successful Hello. This keeps the controller's status flow simple:
// callers just call PushStatus() and the client deals with reconnects.
type Client struct {
	cfg Config
	k8s client.Client

	queue chan *operatorpb.ControllerEnvelope
}

// NewClient constructs a session client.
func NewClient(cfg Config, k8sClient client.Client) (*Client, error) {
	if cfg.OperatorEndpoint == "" || cfg.ClusterID == "" || cfg.Token == "" {
		return nil, errors.New("session.Config requires OperatorEndpoint, ClusterID, and Token")
	}
	if cfg.HeartbeatInterval == 0 {
		cfg.HeartbeatInterval = 30 * time.Second
	}
	if cfg.MinBackoff == 0 {
		cfg.MinBackoff = 1 * time.Second
	}
	if cfg.MaxBackoff == 0 {
		cfg.MaxBackoff = 60 * time.Second
	}
	if cfg.SendBuffer == 0 {
		cfg.SendBuffer = 64
	}
	return &Client{
		cfg:   cfg,
		k8s:   k8sClient,
		queue: make(chan *operatorpb.ControllerEnvelope, cfg.SendBuffer),
	}, nil
}

// Run blocks until ctx is cancelled. Maintains the gRPC connection with reconnect.
func (c *Client) Run(ctx context.Context) error {
	logger := log.FromContext(ctx).WithName("session-client").WithValues("cluster", c.cfg.ClusterID)

	backoff := c.cfg.MinBackoff
	for {
		if ctx.Err() != nil {
			return nil
		}
		err := c.runOnce(ctx)
		if ctx.Err() != nil {
			return nil
		}
		if err != nil {
			logger.Info("session terminated, reconnecting", "error", err.Error(), "backoff", backoff.String())
		}
		select {
		case <-ctx.Done():
			return nil
		case <-time.After(backoff):
		}
		backoff *= 2
		if backoff > c.cfg.MaxBackoff {
			backoff = c.cfg.MaxBackoff
		}
	}
}

// runOnce dials, says Hello, runs reader and writer loops until either fails.
func (c *Client) runOnce(ctx context.Context) error {
	logger := log.FromContext(ctx).WithName("session-client")

	dial := c.cfg.Dial
	if dial == nil {
		// Phase 2 MVP: insecure transport (plain HTTP/2). Production should require TLS.
		dial = func(ctx context.Context, ep string) (*grpc.ClientConn, error) {
			return grpc.DialContext(ctx, ep, grpc.WithTransportCredentials(insecure.NewCredentials()))
		}
	}
	conn, err := dial(ctx, c.cfg.OperatorEndpoint)
	if err != nil {
		return fmt.Errorf("dial: %w", err)
	}
	defer conn.Close()

	stream, err := operatorpb.NewClusterSessionClient(conn).Connect(ctx)
	if err != nil {
		return fmt.Errorf("opening stream: %w", err)
	}

	if err := stream.Send(&operatorpb.ControllerEnvelope{
		Body: &operatorpb.ControllerEnvelope_Hello{Hello: &operatorpb.Hello{
			ClusterId:         c.cfg.ClusterID,
			Token:             c.cfg.Token,
			ControllerVersion: c.cfg.ControllerVersion,
			SupportedRuntimes: c.cfg.SupportedRuntimes,
		}},
	}); err != nil {
		return fmt.Errorf("send Hello: %w", err)
	}

	ack, err := stream.Recv()
	if err != nil {
		return fmt.Errorf("recv HelloAck: %w", err)
	}
	if ack.GetHelloAck() == nil {
		return fmt.Errorf("expected HelloAck, got %T", ack.Body)
	}
	logger.Info("session established")

	streamCtx, cancel := context.WithCancel(ctx)
	defer cancel()

	errCh := make(chan error, 3)
	go func() { errCh <- c.heartbeatLoop(streamCtx) }()
	go func() { errCh <- c.writerLoop(streamCtx, stream) }()
	go func() { errCh <- c.readerLoop(streamCtx, stream) }()

	err = <-errCh
	cancel()
	<-errCh
	<-errCh
	return err
}

func (c *Client) heartbeatLoop(ctx context.Context) error {
	ticker := time.NewTicker(c.cfg.HeartbeatInterval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return nil
		case <-ticker.C:
			select {
			case c.queue <- &operatorpb.ControllerEnvelope{
				Body: &operatorpb.ControllerEnvelope_Heartbeat{Heartbeat: &operatorpb.Heartbeat{}},
			}:
			case <-ctx.Done():
				return nil
			default:
				// Queue full — skip this heartbeat. The Operator Service will see a
				// gap in heartbeats and decide whether to time out.
			}
		}
	}
}

// writerLoop drains the outbound queue onto the stream. Buffered envelopes survive
// reconnects: when a new stream opens, the queue is intact and flushes naturally.
func (c *Client) writerLoop(ctx context.Context, stream operatorpb.ClusterSession_ConnectClient) error {
	for {
		select {
		case <-ctx.Done():
			return nil
		case env := <-c.queue:
			if err := stream.Send(env); err != nil {
				// Re-queue the dropped envelope so we don't lose it on the next stream.
				select {
				case c.queue <- env:
				default:
				}
				return fmt.Errorf("send: %w", err)
			}
		}
	}
}

func (c *Client) readerLoop(ctx context.Context, stream operatorpb.ClusterSession_ConnectClient) error {
	for {
		msg, err := stream.Recv()
		if errors.Is(err, io.EOF) {
			return errors.New("server closed stream")
		}
		if err != nil {
			return fmt.Errorf("recv: %w", err)
		}
		c.handleCommand(ctx, msg)
	}
}

func (c *Client) handleCommand(ctx context.Context, env *operatorpb.OperatorEnvelope) {
	switch body := env.Body.(type) {
	case *operatorpb.OperatorEnvelope_Create:
		c.handleCreate(ctx, body.Create)
	case *operatorpb.OperatorEnvelope_Delete:
		c.handleDelete(ctx, body.Delete)
	case *operatorpb.OperatorEnvelope_Resync:
		c.handleResync(ctx, body.Resync)
	case *operatorpb.OperatorEnvelope_Heartbeat, *operatorpb.OperatorEnvelope_HelloAck:
		// no-op
	}
}

// handleResync lists every OSMOTaskGroup in the requested namespace and pushes a status
// event for each, restoring the operator's view of remote state after a restart or
// reconnect. Dropping events on a full queue is acceptable — the next reconcile push
// will catch them up.
func (c *Client) handleResync(ctx context.Context, req *operatorpb.ResyncRequest) {
	logger := log.FromContext(ctx).WithName("session-client").WithValues("command", "Resync")
	var list v1alpha1.OSMOTaskGroupList
	opts := []client.ListOption{}
	if req.Namespace != "" {
		opts = append(opts, client.InNamespace(req.Namespace))
	}
	if err := c.k8s.List(ctx, &list, opts...); err != nil {
		logger.Error(err, "resync list failed")
		return
	}
	for i := range list.Items {
		c.PushStatus(&list.Items[i])
	}
	logger.Info("resync pushed", "count", len(list.Items))
}

func (c *Client) handleCreate(ctx context.Context, cmd *operatorpb.CreateOTG) {
	logger := log.FromContext(ctx).WithName("session-client").WithValues("command", "CreateOTG", "command_id", cmd.CommandId)

	var otg v1alpha1.OSMOTaskGroup
	if err := yaml.Unmarshal(cmd.OtgYaml, &otg); err != nil {
		c.ackCommand(cmd.CommandId, fmt.Errorf("decode OSMOTaskGroup: %w", err))
		return
	}
	err := c.k8s.Create(ctx, &otg)
	if apierrors.IsAlreadyExists(err) {
		err = nil
	}
	if err != nil {
		logger.Error(err, "apply failed")
	}
	c.ackCommand(cmd.CommandId, err)
}

func (c *Client) handleDelete(ctx context.Context, cmd *operatorpb.DeleteOTG) {
	otg := &v1alpha1.OSMOTaskGroup{}
	otg.SetName(cmd.Name)
	otg.SetNamespace(cmd.Namespace)
	err := c.k8s.Delete(ctx, otg)
	if apierrors.IsNotFound(err) {
		err = nil
	}
	c.ackCommand(cmd.CommandId, err)
}

func (c *Client) ackCommand(commandID string, cmdErr error) {
	ack := &operatorpb.CommandAck{CommandId: commandID, Ok: cmdErr == nil}
	if cmdErr != nil {
		ack.Error = cmdErr.Error()
	}
	c.enqueue(&operatorpb.ControllerEnvelope{
		Body: &operatorpb.ControllerEnvelope_Ack{Ack: ack},
	})
}

func (c *Client) enqueue(env *operatorpb.ControllerEnvelope) {
	select {
	case c.queue <- env:
	default:
		// Queue full. Drop. (Status events use this path too — the periodic reconcile
		// loop on the control side will resync within 30s, so a dropped event is at
		// worst a status-update delay, not a correctness issue.)
	}
}

// PushStatus enqueues an OTGStatusEvent for delivery to the Operator Service. Returns
// immediately. The caller (a Watcher over OSMOTaskGroup) calls this on every modify.
//
// Non-blocking with bounded backpressure: full queues drop the event silently and the
// control-side periodic reconciler picks the state up.
func (c *Client) PushStatus(otg *v1alpha1.OSMOTaskGroup) {
	c.enqueue(&operatorpb.ControllerEnvelope{
		Body: &operatorpb.ControllerEnvelope_Status{Status: &operatorpb.OTGStatusEvent{
			Namespace: otg.Namespace,
			Name:      otg.Name,
			Status:    convertStatus(otg.Status),
		}},
	})
}

// Report implements controller.StatusReporter. Called by the TaskGroup Reconciler after
// each successful reconcile cycle. We just enqueue an OTGStatusEvent — the writer
// goroutine will flush it on the stream. Errors here are non-fatal; the periodic
// reconcile on the control side picks up any drops.
func (c *Client) Report(_ context.Context, otg *v1alpha1.OSMOTaskGroup) error {
	c.PushStatus(otg)
	return nil
}

// convertStatus turns a CR-level OSMOTaskGroupStatus into the proto-wire shape.
// All scalar fields plus RuntimeStatus (opaque bytes) round-trip identically; ExitCode
// uses an explicit HasExitCode flag to disambiguate "exit 0" from "not exited yet."
func convertStatus(in v1alpha1.OSMOTaskGroupStatus) *operatorpb.OTGStatus {
	out := &operatorpb.OTGStatus{
		Phase:              string(in.Phase),
		ObservedGeneration: in.ObservedGeneration,
		Retries:            int32(in.Retries),
		Message:            in.Message,
		RuntimeStatus:      append([]byte(nil), in.RuntimeStatus.Raw...),
	}
	for _, c := range in.Conditions {
		cond := &operatorpb.OTGCondition{
			Type:    c.Type,
			Status:  string(c.Status),
			Reason:  c.Reason,
			Message: c.Message,
		}
		if !c.LastTransitionTime.IsZero() {
			cond.LastTransition = timestamppb.New(c.LastTransitionTime.Time)
		}
		out.Conditions = append(out.Conditions, cond)
	}
	for _, t := range in.Tasks {
		task := &operatorpb.OTGTaskState{
			Name:    t.Name,
			PodName: t.PodName,
			State:   t.State,
			Message: t.Message,
		}
		if t.StartTime != nil {
			task.StartTime = timestamppb.New(t.StartTime.Time)
		}
		if t.EndTime != nil {
			task.EndTime = timestamppb.New(t.EndTime.Time)
		}
		if t.ExitCode != nil {
			task.ExitCode = *t.ExitCode
			task.HasExitCode = true
		}
		out.Tasks = append(out.Tasks, task)
	}
	return out
}

// EnsureClusterRegistered is a startup helper. In single-cluster mode the controller
// idempotently creates an OSMOCluster CR for its own cluster_id (so the rest of the
// system has something to point at). In split-cluster mode this is a no-op because
// the cluster registration lives in the control cluster.
func EnsureClusterRegistered(ctx context.Context, k8sClient client.Client, clusterID string) {
	if clusterID == "" {
		return
	}
	var cluster v1alpha1.OSMOCluster
	err := k8sClient.Get(ctx, types.NamespacedName{Name: clusterID}, &cluster)
	if apierrors.IsNotFound(err) {
		_ = k8sClient.Create(ctx, &v1alpha1.OSMOCluster{ObjectMeta: metav1.ObjectMeta{Name: clusterID}})
	}
}
