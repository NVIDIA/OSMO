<!--
SPDX-FileCopyrightText: Copyright (c) 2025 NVIDIA CORPORATION. All rights reserved.

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
-->


# Backend Operators Redesign

## Overview

This project aims to redesign the OSMO backend operator component to address critical scaling, reliability, and performance issues. The redesign will introduce horizontal scaling capabilities, improve multi-threading support, reduce memory footprint, and establish proper monitoring and testing infrastructure.

### Motivation

To prepare for future growth, OSMO's backend operators require architectural enhancements to support production workloads for Kubernetes backends at large scale. The current system provides a solid foundation, but can be optimized in several key areas: system stability under sustained load, event delivery consistency, and workflow status update latency.

This redesign will proactively strengthen OSMO's ability to support production-scale deployments reliably and efficiently as customer workloads continue to grow. Rewriting the backend listener using Golang will allow us to leverage native Kubernetes Go library for more performant operations and more built-in features (such as node/pod events caching).

### Problem

**Scaling**
- Agent Serice cannot scale horizontally to process backend messages

**Reliability**
- Backend Listener frequently restarts, impacting system availability

**Performance**
- Memory leaks in the listener component consume significant resources
- Workflow status update latency blocking user from exec and port forwarding
- Single-threaded listener design limits message throughput

**Observability**
- Lack of proper KPIs and logging infrastructure
- Insufficient test coverage makes it difficult to diagnose issues and measure system health

## Use Cases

| Use Case | Description |
|---|---|
| Large comupting backend | Backend operator needs to be able to handle a large computing backends, e.g. a k8s cluster with 2k nodes |
| User exec into their task | A user can exec into his task as soon as the task becomes running |

## Requirements

| Title | Description | Type |
|---|---|---|
| Scalability | Agent service shall handle multiple backend messages in parallel and be able to horizontally scale | Scalability |
| Event Caching | Backend operator shall cache Kubernetes events to reduce API server load and improve response times | Performance |
| Message Compacting | Agent server shall compact messages and deduplicate stale message to improve processing times | Performance |
| Data Accuracy | Backend operator shall provide accurate and up-to-date workflow and resource status information | Reliability |
| Low Latency | Backend operator shall update workflow status with minimal latency to enable timely user actions (exec, port forwarding) | Performance |
| Recoverability | Backend operator shall be able to recover from failures without data loss | Reliability |
| Traceability | Backend operator shall provide structured logging for debugging and auditing purposes | Observability |
| KPI Dashboard | Backend operator shall expose KPIs and metrics for monitoring system health and outage alarts| Observability |
| No Message Drop | Backend operator shall ensure no message drops | Reliability |
| Resource Efficiency | Backend operator shall utilize CPU efficiently and prevent memory leaks | Performance |
| System Robustness | Backend operator shall operate without frequent restarts and maintain stability under load | Reliability |

## Architectural Details

### Involved components
- Agent
- Backend Listener

_Provide a high-level technical overview of the proposed solution. Include block diagrams if applicable. How will we solve the problem? What is the general approach?_

This should expand on the "High-Level Approach" field from the project proposal. Include:

- Architecture overview
- Key components or modules
- How they fit together
- Static and dynamic components
- User-facing changes (if applicable)

## Detailed Design

_Provide the detailed technical design. This is the core of the document._

Include:

- API designs (new endpoints, function signatures, interfaces)
- Data models and schemas
- System architecture diagrams
- Component interactions and workflows
- Configuration changes
- User interface mockups or flows (if applicable)
- Examples of how the system will be used

Break this into subsections as needed for clarity.

### Alternatives Considered

_What other approaches did you consider? Why did you choose this design over the alternatives?_

For each alternative:

- Describe the approach
- List pros and cons
- Explain why it was not chosen

### Backwards Compatibility

_Does this change break existing APIs, configurations, or user workflows? If yes, how will we handle it?_

### Performance

_What are the performance implications? Will this impact latency, throughput, resource usage, etc.?_

### Operations

_How does this affect operations, deployment, monitoring, or maintenance?_

### Security

_Are there any security considerations or implications?_

### Documentation

_What documentation needs to be created or updated?_

### Testing

_What unit, integration, or end-to-end tests need to be created or updated? How will these tests be integrated in automation? What test metrics will be tracked and what are KPIs?_

### Dependencies

_Which other projects or components impact this work? Which other projects or components are impacted by this work?_

## Implementation Plan

_[Optional] For large projects, break the project into smaller pieces._

## Open Questions

_List any unresolved questions or decisions that need to be made._

- [ ] Question 1?
- [ ] Question 2?
