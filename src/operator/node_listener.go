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

package main

import (
	"context"
	"fmt"
	"log"
	"strings"
	"time"

	"github.com/google/uuid"
	corev1 "k8s.io/api/core/v1"
	"k8s.io/client-go/informers"
	"k8s.io/client-go/tools/cache"

	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/metric"

	"go.corp.nvidia.com/osmo/operator/utils"
	pb "go.corp.nvidia.com/osmo/proto/operator"
)

// NodeListener manages the bidirectional gRPC stream for node events
type NodeListener struct {
	*utils.BaseListener
	args utils.ListenerArgs
	inst *utils.Instruments
}

// NewNodeListener creates a new node listener instance
func NewNodeListener(args utils.ListenerArgs, inst *utils.Instruments) *NodeListener {
	return &NodeListener{
		BaseListener: utils.NewBaseListener(
			args, "last_progress_node_listener", utils.StreamNameNode, inst),
		args: args,
		inst: inst,
	}
}

// Run manages the bidirectional streaming lifecycle
func (nl *NodeListener) Run(ctx context.Context) error {
	ch := make(chan *pb.ListenerMessage, nl.args.NodeUpdateChanSize)
	return nl.BaseListener.Run(
		ctx,
		"Connected to operator service, node stream established",
		ch,
		nl.watchNodes,
		nl.sendMessages,
	)
}

// sendMessages reads from the channel and sends messages to the server.
func (nl *NodeListener) sendMessages(
	ctx context.Context,
	cancel context.CancelCauseFunc,
	ch <-chan *pb.ListenerMessage,
) {
	progressTicker := time.NewTicker(
		time.Duration(nl.args.ProgressFrequencySec) * time.Second)
	defer progressTicker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-progressTicker.C:
			progressWriter := nl.GetProgressWriter()
			if progressWriter != nil {
				if err := progressWriter.ReportProgress(); err != nil {
					log.Printf("Warning: failed to report progress: %v", err)
				}
			}
		case msg, ok := <-ch:
			if !ok {
				if ctx.Err() != nil {
					log.Printf("node watcher stopped due to context cancellation")
					return
				}
				log.Printf("node watcher stopped unexpectedly...")
				nl.inst.MessageChannelClosedUnexpectedly.Add(ctx, 1,
					metric.WithAttributes(attribute.String("listener", "node")))
				cancel(fmt.Errorf("node watcher stopped"))
				return
			}
			if err := nl.BaseListener.SendMessage(ctx, msg); err != nil {
				cancel(fmt.Errorf("failed to send node message: %w", err))
				return
			}
		}
	}
}

// watchNodes starts node informer and processes node events
func (nl *NodeListener) watchNodes(
	ctx context.Context,
	cancel context.CancelCauseFunc,
	nodeChan chan<- *pb.ListenerMessage,
) {
	done := ctx.Done()

	clientset, err := utils.CreateKubernetesClient()
	if err != nil {
		log.Printf("Failed to create kubernetes client: %v", err)
		nl.inst.KubernetesClientCreationErrorTotal.Add(ctx, 1,
			metric.WithAttributes(attribute.String("listener", "node")))
		cancel(fmt.Errorf("failed to create kubernetes client: %w", err))
		return
	}

	log.Println("Starting node watcher")
	nodeStateTracker := utils.NewNodeStateTracker(
		time.Duration(nl.args.StateCacheTTLMin) * time.Minute)

	nodeInformerFactory := informers.NewSharedInformerFactory(
		clientset,
		0, // No automatic resync
	)
	nodeInformer := nodeInformerFactory.Core().V1().Nodes().Informer()

	handleNodeEvent := func(node *corev1.Node, isDelete bool) {
		nl.inst.KBEventWatchCount.Add(ctx, 1,
			metric.WithAttributes(attribute.String("type", "node")))

		msg := nl.buildResourceMessage(node, nodeStateTracker, isDelete)
		if msg != nil {
			select {
			case nodeChan <- msg:
				nl.inst.MessageQueuedTotal.Add(ctx, 1,
					metric.WithAttributes(attribute.String("listener", "node")))
				nl.inst.MessageChannelPending.Record(ctx, float64(len(nodeChan)),
					metric.WithAttributes(attribute.String("listener", "node")))
			case <-done:
				return
			}
		}
		if isDelete {
			nodeStateTracker.Remove(utils.GetNodeHostname(node))
		}
	}

	_, err = nodeInformer.AddEventHandler(cache.ResourceEventHandlerFuncs{
		AddFunc: func(obj interface{}) {
			node := obj.(*corev1.Node)
			handleNodeEvent(node, false)
		},
		UpdateFunc: func(oldObj, newObj interface{}) {
			node := newObj.(*corev1.Node)
			handleNodeEvent(node, false)
		},
		DeleteFunc: func(obj interface{}) {
			node, ok := obj.(*corev1.Node)
			if !ok {
				tombstone, ok := obj.(cache.DeletedFinalStateUnknown)
				if !ok {
					log.Printf("Error: unexpected object type in node DeleteFunc: %T", obj)
					return
				}
				node, ok = tombstone.Obj.(*corev1.Node)
				if !ok {
					log.Printf("Error: tombstone contained unexpected object: %T",
						tombstone.Obj)
					return
				}
			}
			handleNodeEvent(node, true)
		},
	})
	if err != nil {
		log.Printf("Failed to add node event handler: %v", err)
		return
	}

	nodeInformer.SetWatchErrorHandler(func(r *cache.Reflector, err error) {
		log.Printf("Node watch error, will rebuild from store: %v", err)
		nl.inst.EventWatchConnectionErrorCount.Add(ctx, 1,
			metric.WithAttributes(attribute.String("type", "node")))
		nl.rebuildNodesFromStore(ctx, nodeInformer, nodeStateTracker, nodeChan)
		log.Println("Sending NODE_INVENTORY after watch gap recovery")
		nl.sendNodeInventory(ctx, nodeInformer, nodeChan)
	})

	nodeInformerFactory.Start(done)

	log.Println("Waiting for node informer cache to sync...")
	if !cache.WaitForCacheSync(done, nodeInformer.HasSynced) {
		log.Println("Failed to sync node informer cache")
		nl.inst.InformerCacheSyncFailure.Add(ctx, 1,
			metric.WithAttributes(attribute.String("listener", "node")))
		return
	}
	log.Println("Node informer cache synced successfully")
	nl.inst.InformerCacheSyncSuccess.Add(ctx, 1,
		metric.WithAttributes(attribute.String("listener", "node")))

	nl.rebuildNodesFromStore(ctx, nodeInformer, nodeStateTracker, nodeChan)
	log.Println("Sending initial NODE_INVENTORY after cache sync")
	nl.sendNodeInventory(ctx, nodeInformer, nodeChan)

	<-done
	log.Println("Node resource watcher stopped")
}

// rebuildNodesFromStore rebuilds node state from informer cache
func (nl *NodeListener) rebuildNodesFromStore(
	ctx context.Context,
	nodeInformer cache.SharedIndexInformer,
	nodeStateTracker *utils.NodeStateTracker,
	nodeChan chan<- *pb.ListenerMessage,
) {
	log.Println("Rebuilding node resource state from informer store...")

	nl.inst.InformerRebuildTotal.Add(ctx, 1,
		metric.WithAttributes(attribute.String("listener", "node")))

	sent := 0
	skipped := 0
	nodes := nodeInformer.GetStore().List()
	for _, obj := range nodes {
		node, ok := obj.(*corev1.Node)
		if !ok {
			continue
		}

		msg := nl.buildResourceMessage(node, nodeStateTracker, false)
		if msg != nil {
			select {
			case nodeChan <- msg:
				sent++
				nl.inst.MessageQueuedTotal.Add(ctx, 1,
					metric.WithAttributes(attribute.String("listener", "node")))
				nl.inst.MessageChannelPending.Record(ctx, float64(len(nodeChan)),
					metric.WithAttributes(attribute.String("listener", "node")))
			case <-ctx.Done():
				log.Printf("Node rebuild interrupted: sent=%d, skipped=%d", sent, skipped)
				return
			}
		} else {
			skipped++
		}
	}

	log.Printf("Node rebuild complete: sent=%d, skipped=%d", sent, skipped)
}

// buildResourceMessage creates a ListenerMessage with UpdateNode body from a node
func (nl *NodeListener) buildResourceMessage(
	node *corev1.Node,
	tracker *utils.NodeStateTracker,
	isDelete bool,
) *pb.ListenerMessage {
	hostname := utils.GetNodeHostname(node)
	body := utils.BuildUpdateNodeBody(node, isDelete)

	if !isDelete && !tracker.HasChanged(hostname, body) {
		return nil
	}

	if !isDelete {
		tracker.Update(hostname, body)
	}

	messageUUID := strings.ReplaceAll(uuid.New().String(), "-", "")
	msg := &pb.ListenerMessage{
		Uuid:      messageUUID,
		Timestamp: time.Now().UTC().Format("2006-01-02T15:04:05.999999"),
		Body: &pb.ListenerMessage_UpdateNode{
			UpdateNode: body,
		},
	}

	action := "update"
	if isDelete {
		action = "delete"
	}
	log.Printf("Sent Node (%s): hostname=%s, available=%v", action, hostname, body.Available)

	return msg
}

// sendNodeInventory builds and sends a NODE_INVENTORY message with all node hostnames
func (nl *NodeListener) sendNodeInventory(
	ctx context.Context,
	nodeInformer cache.SharedIndexInformer,
	nodeChan chan<- *pb.ListenerMessage,
) {
	if nodeInformer == nil {
		log.Println("sendNodeInventory: informer is nil, skipping")
		return
	}

	nodes := nodeInformer.GetStore().List()
	hostnames := make([]string, 0, len(nodes))

	for _, obj := range nodes {
		node, ok := obj.(*corev1.Node)
		if !ok {
			continue
		}
		hostname := utils.GetNodeHostname(node)
		hostnames = append(hostnames, hostname)
	}

	nl.inst.NodeInventorySize.Record(ctx, float64(len(hostnames)))

	messageUUID := strings.ReplaceAll(uuid.New().String(), "-", "")
	msg := &pb.ListenerMessage{
		Uuid:      messageUUID,
		Timestamp: time.Now().UTC().Format("2006-01-02T15:04:05.999999"),
		Body: &pb.ListenerMessage_NodeInventory{
			NodeInventory: &pb.NodeInventoryBody{
				Hostnames: hostnames,
			},
		},
	}

	select {
	case nodeChan <- msg:
		nl.inst.MessageQueuedTotal.Add(ctx, 1,
			metric.WithAttributes(attribute.String("listener", "node")))
		nl.inst.MessageChannelPending.Record(ctx, float64(len(nodeChan)),
			metric.WithAttributes(attribute.String("listener", "node")))
		log.Printf("Sent NODE_INVENTORY with %d hostnames", len(hostnames))
	case <-ctx.Done():
		log.Println("sendNodeInventory: context cancelled while sending")
		return
	}
}
