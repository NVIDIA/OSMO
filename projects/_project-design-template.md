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

---
title: "Project Title"
author: "@username"
pic: "@username"
related_issues:
  - "#123"
---

# \<Project Title\>

## Overview

_The Overview section should be largely identical to the project proposal issue._

_Provide a concise 2-3 sentence summary of what this project does and why it matters._

### Motivation

_Why should we do this project? What are the key goals we're trying to achieve?_

### Problem

_Describe the problem this project solves. What is the current situation?_

## Use Cases

| Use Case | Description |
|---|---|
| _name_ | _description_ |
| Upload a dataset | A user with an existing dataset on their workstation can upload... |

## Requirements

| Title | Description | Type |
|---|---|---|
| _title_ | _\<entity\> shall \<do thing\>_ | _type_ |
| _title_ | _\<pre-condition\> \<entity\> shall \<do thing\>_ | _type_ |
| Upload a new dataset version | A user shall be able to upload a new version... | Functional |
| Support dataset versions up to 100 TiB in size | OSMO shall support uploading a dataset of up to 100 TiB... | KPI |
| Datasets cannot be accessed by users without sufficient roles | If the user does not have sufficient roles, a user shall not be able to... | Security |

## Architectural Details

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
