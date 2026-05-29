// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

package workflow

import (
	"sync"

	operatorpb "github.com/nvidia/osmo/taskgroup/operator/proto"
)

// RemoteStatusCache holds the latest known status for every remote OSMOTaskGroup,
// keyed by (clusterID, namespace, otgName). The cache is the bridge between the
// operator-service StatusBus (publishers) and the Workflow Controller reconciler (sole
// consumer / sole writer of OSMOWorkflow.Status.Groups for remote groups).
//
// Single-writer rule: only the Workflow Controller writes Status.Groups. The bridge
// goroutine writes to this cache and enqueues a reconcile.Request; the reconciler reads
// the cache. That removes the conflict-on-Status.Update race the old direct-write bridge
// suffered when the workflow controller and the bridge raced to update the same CR.
type RemoteStatusCache struct {
	mu    sync.RWMutex
	cache map[string]*operatorpb.OTGStatusEvent
}

// NewRemoteStatusCache returns an empty cache.
func NewRemoteStatusCache() *RemoteStatusCache {
	return &RemoteStatusCache{cache: make(map[string]*operatorpb.OTGStatusEvent)}
}

// Put records the latest event for a remote OTG. Overwrites previous entries.
func (c *RemoteStatusCache) Put(clusterID string, ev *operatorpb.OTGStatusEvent) {
	if ev == nil || ev.GetName() == "" {
		return
	}
	c.mu.Lock()
	c.cache[remoteKey(clusterID, ev.GetNamespace(), ev.GetName())] = ev
	c.mu.Unlock()
}

// Get returns the latest known event for (cluster, namespace, otgName), or nil if no
// event has been received yet.
func (c *RemoteStatusCache) Get(clusterID, namespace, otgName string) *operatorpb.OTGStatusEvent {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return c.cache[remoteKey(clusterID, namespace, otgName)]
}

// Forget drops the cache entry for an OTG. Called when a workflow is deleted so the
// cache doesn't grow without bound.
func (c *RemoteStatusCache) Forget(clusterID, namespace, otgName string) {
	c.mu.Lock()
	delete(c.cache, remoteKey(clusterID, namespace, otgName))
	c.mu.Unlock()
}

func remoteKey(clusterID, namespace, name string) string {
	return clusterID + "\x00" + namespace + "\x00" + name
}
