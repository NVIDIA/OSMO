"""
SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.

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

Pure-function rendering of Kubernetes objects for an OSMOTaskGroup (KAI runtime).

This module is the Phase 0 contract for the OSMOTaskGroup CRD project
(`projects/PROJ-taskgroup-crd/PROJ-taskgroup-crd.md`).

Rendering must be deterministic: given the same RenderInput, the output must be
byte-identical to a golden fixture. This is what the Go KAI reconciler diffs
against during the dual-write Phase 1 to verify zero divergence from the legacy
Python pod-rendering path.

The renderer is intentionally a thin wrapper over KaiK8sObjectFactory rather
than a reimplementation: it freezes the *observable* behavior of the existing
renderer behind a typed, side-effect-free entrypoint. As task.py's rendering is
incrementally extracted in later phases, more of the input space (per-task
container spec construction, init/control container synthesis) will move
behind this same RenderInput contract.
"""

import dataclasses
from typing import Any, Dict, List, Optional

from src.lib.utils import priority as wf_priority
from src.utils.job import kb_objects, topology


@dataclasses.dataclass(frozen=True)
class PoolQuota:
    """Resource quota for a pool's KAI Queue.

    Values of -1 mean "unbounded". Mirrors connectors.PoolResourceCountable so
    we can build queue specs without importing connector code at render time.
    """
    gpu_guarantee: int = -1
    gpu_maximum: int = -1
    gpu_weight: int = 1


@dataclasses.dataclass(frozen=True)
class PoolInput:
    """Pool definition needed for KAI Queue + Topology rendering."""
    name: str
    quota: PoolQuota
    topology_keys: List[topology.TopologyKey] = dataclasses.field(default_factory=list)


@dataclasses.dataclass(frozen=True)
class RenderInput:
    """All inputs required to render a KAI task group into Kubernetes objects.

    This is the contract the Go controller must accept. Anything not in this
    struct is either cluster-local policy (security context, base volume mounts,
    image pull secrets) or comes from the controller's own runtime config.
    """
    group_uuid: str
    pool_name: str
    pool_namespace: str
    priority: wf_priority.WorkflowPriority
    labels: Dict[str, str]
    pods: List[Dict[str, Any]]
    topology_keys: List[topology.TopologyKey] = dataclasses.field(default_factory=list)
    task_infos: List[topology.TaskTopology] = dataclasses.field(default_factory=list)


@dataclasses.dataclass(frozen=True)
class RenderOutput:
    """Kubernetes objects produced by render_kai_task_group.

    Resources are returned in apply order: PodGroup first (so KAI sees the
    gang-scheduling constraint before pod admission), then pods. Queue and
    Topology CRDs are returned separately because they are pool-scoped, not
    group-scoped, and are applied at backend-init time.
    """
    pod_group: Dict[str, Any]
    pods: List[Dict[str, Any]]


def render_kai_task_group(spec: RenderInput) -> RenderOutput:
    """Render a KAI task group's PodGroup + final-shape Pods.

    Args:
        spec: Fully resolved render input. Pre-built pod dicts must already
            contain the user's container spec, init/ctrl containers, volumes,
            and OSMO labels. This function adds only the KAI-specific bits
            (scheduler name, queue label, pod-group annotation, subgroup label).

    Returns:
        RenderOutput with the PodGroup as the first resource the caller should
        apply.
    """
    factory = _kai_factory(
        scheduler_name='kai-scheduler',
        namespace=spec.pool_namespace,
    )

    # KaiK8sObjectFactory.create_group_k8s_resources both mutates pods in place
    # and returns [pod_group, ...pods]. We split that here so the Go side can
    # consume the two resources separately.
    resources = factory.create_group_k8s_resources(
        group_uuid=spec.group_uuid,
        pods=spec.pods,
        labels=dict(spec.labels),
        pool_name=spec.pool_name,
        priority=spec.priority,
        topology_keys=list(spec.topology_keys),
        task_infos=list(spec.task_infos),
    )

    pod_group, *pods = resources
    return RenderOutput(pod_group=pod_group, pods=pods)


def render_pool_scheduler_resources(
    namespace: str,
    pools: List[PoolInput],
) -> List[Dict[str, Any]]:
    """Render the KAI Queue + Topology resources for a backend's pools.

    These are pool-scoped, not group-scoped: they live for the lifetime of the
    backend cluster registration, not for the lifetime of a single
    OSMOTaskGroup. The controller applies them at startup; the Go side will use
    this golden output to verify its own queue-rendering matches Python.
    """
    factory = _kai_factory(scheduler_name='kai-scheduler', namespace=namespace)
    backend = _BackendStub(k8s_namespace=namespace)
    pool_objs = [
        _PoolStub(
            name=p.name,
            resources=_PoolResourcesStub(gpu=_QuotaStub(
                guarantee=p.quota.gpu_guarantee,
                maximum=p.quota.gpu_maximum,
                weight=p.quota.gpu_weight,
            )),
            topology_keys=list(p.topology_keys),
        )
        for p in pools
    ]
    # KaiK8sObjectFactory only reads .k8s_namespace on the backend and .name /
    # .resources.gpu / .topology_keys on each pool. Structural typing keeps the
    # rendering module free of the heavy connectors imports while satisfying
    # the same call site that production connectors.Backend / Pool satisfy.
    return factory.get_scheduler_resources_spec(backend, pool_objs)  # type: ignore[arg-type]


def _kai_factory(
    scheduler_name: str,
    namespace: str,
) -> kb_objects.KaiK8sObjectFactory:
    """Build a KaiK8sObjectFactory without touching the connectors package.

    KaiK8sObjectFactory's __init__ reads backend.scheduler_settings and
    backend.k8s_namespace. To keep rendering a pure function we hand it a
    minimal stub.
    """
    factory = kb_objects.KaiK8sObjectFactory.__new__(kb_objects.KaiK8sObjectFactory)
    factory._scheduler_name = scheduler_name  # pylint: disable=protected-access
    factory._namespace = namespace  # pylint: disable=protected-access
    return factory


@dataclasses.dataclass
class _QuotaStub:
    guarantee: int
    maximum: int
    weight: int = 1


@dataclasses.dataclass
class _PoolResourcesStub:
    gpu: Optional[_QuotaStub] = None


@dataclasses.dataclass
class _PoolStub:
    name: str
    resources: _PoolResourcesStub
    topology_keys: List[topology.TopologyKey]


@dataclasses.dataclass
class _BackendStub:
    k8s_namespace: str
