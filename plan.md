# Topology-Aware Scheduling Unit Test Plan

## Overview

This document outlines the plan for creating comprehensive unit tests for the topology-aware scheduling feature introduced in PROJ-206. The feature allows users to specify topology requirements in workflow specifications to ensure tasks are scheduled with optimal network locality.

## Goals

1. **Validate PodGroup Generation**: Ensure that workflow specs with topology requirements correctly generate PodGroup CRDs with appropriate topology constraints
2. **Test Edge Cases**: Cover various edge cases and error conditions
3. **Enable Rapid Iteration**: Create a test harness that allows testing without a full Kubernetes cluster
4. **Regression Prevention**: Establish a baseline test suite to prevent regressions as the feature evolves

## Test Harness Design

### Approach

We will create a lightweight test harness that:
- Parses workflow YAML specifications with topology requirements
- Invokes the existing OSMO workflow processing pipeline to generate Kubernetes objects
- Validates the generated PodGroup specifications against expected outputs
- Does NOT require a live Kubernetes cluster or KAI scheduler

### Key Components

1. **Test Base Class** (`TopologyTestBase`)
   - Location: `src/utils/job/tests/test_topology.py`
   - Provides helper methods for:
     - Creating mock pool configurations with topology_keys
     - Parsing workflow YAML specs
     - Generating PodGroup specs via existing code paths
     - Asserting PodGroup structure and content

2. **Mock Configuration**
   - Mock `connectors.Pool` objects with `topology_keys` configuration
   - Mock `connectors.Backend` with KAI scheduler settings
   - Use existing test harness infrastructure where possible (similar to `test_harness.py`)

3. **Validation Utilities**
   - Helper functions to validate:
     - PodGroup metadata (labels, annotations)
     - PodGroup spec structure (subgroups, topology constraints, minMember counts)
     - Pod annotations and labels (pod-group-name, kai.scheduler/subgroup-name)
     - Topology level references (correct label mappings)
     - Workflow-level validation (all tasks in group have consistent topology keys)

### Integration Points

The test harness will leverage existing code:
- `src.utils.job.kb_objects.KaiK8sObjectFactory.create_group_k8s_resources()` - Main PodGroup generation
- `src.utils.job.workflow.WorkflowSpec` - Workflow spec parsing
- `src.utils.connectors.ResourceSpec` - Resource spec with topology requirements (needs enhancement)

## Test Cases

### Category 1: Basic Topology Requirements

#### Test 1.1: Single Topology Level - Required
**Use Case**: [Use Case 1](#usecase-1) from design doc (Single NVL72 Rack)

**Workflow Spec**:
```yaml
workflow:
  name: single-nvl72-rack
  groups:
  - name: group1
    tasks:
    - name: model1-shard1
    - name: model1-shard2
    - name: model1-shard3
    - name: model1-shard4
resources:
  default:
    topology:
    - key: gpu-clique
```

**Pool Config**:
```yaml
topology_keys:
- key: gpu-clique
  label: nvidia.com/gpu-clique
- key: zone
  label: topology.kubernetes.io/zone
```

**Expected PodGroup**:
- `spec.minMember`: 4
- No `spec.topologyConstraint` at top level (only one level)
- `spec.subgroups`: Single subgroup with:
  - `minMember`: 4
  - `topologyConstraint.requiredTopologyLevel`: "nvidia.com/gpu-clique"
  - `topologyConstraint.topology`: "<pool-name>-topology"

**Expected Pod Labels/Annotations**:
- All pods: `annotations["pod-group-name"]` = group UUID
- All pods: `labels["kai.scheduler/subgroup-name"]` = default subgroup name

#### Test 1.2: Single Topology Level - Preferred
**Variation**: Same as 1.1 but with `requirementType: preferred`

**Expected Difference**:
- PodGroup should use `preferredTopologyLevel` instead of `requiredTopologyLevel`

#### Test 1.3: No Topology Requirements
**Workflow Spec**: Simple workflow without any topology configuration

**Expected PodGroup**:
- Standard PodGroup without topology constraints
- No `topologyConstraint` field
- No `subgroups` field

### Category 2: Multiple Subgroups (Same Topology Level)

#### Test 2.1: Multiple Groups - Required
**Use Case**: [Use Case 2](#usecase-2) from design doc (Multiple NVL72 Racks)

**Workflow Spec**:
```yaml
workflow:
  name: multiple-nvl72-racks
  groups:
  - name: group1
    tasks:
    - name: model1-shard1
      resource: model-1
    - name: model1-shard2
      resource: model-1
    - name: model1-shard3
      resource: model-1
    - name: model1-shard4
      resource: model-1
    - name: model2-shard1
      resource: model-2
    - name: model2-shard2
      resource: model-2
    - name: model2-shard3
      resource: model-2
    - name: model2-shard4
      resource: model-2
resources:
  model-1:
    topology:
    - key: gpu-clique
      group: model-1-group
  model-2:
    topology:
    - key: gpu-clique
      group: model-2-group
```

**Expected PodGroup**:
- `spec.minMember`: 8
- `spec.subgroups`: Two subgroups:
  - Subgroup 1 (model-1-group): minMember=4, topologyConstraint for gpu-clique
  - Subgroup 2 (model-2-group): minMember=4, topologyConstraint for gpu-clique

**Expected Pod Labels**:
- Tasks with resource=model-1: `kai.scheduler/subgroup-name` = model-1-group subgroup
- Tasks with resource=model-2: `kai.scheduler/subgroup-name` = model-2-group subgroup

### Category 3: Hierarchical Topology Requirements

#### Test 3.1: Two-Level Hierarchy - Required
**Use Case**: [Use Case 3](#usecase-3) from design doc (Multiple NVL72 Racks in Same Zone)

**Workflow Spec**:
```yaml
workflow:
  name: multiple-nvl72-same-zone
  groups:
  - name: group1
    tasks:
    - name: model1-shard1
      resource: model-1
    - name: model1-shard2
      resource: model-1
    - name: model1-shard3
      resource: model-1
    - name: model1-shard4
      resource: model-1
    - name: model2-shard1
      resource: model-2
    - name: model2-shard2
      resource: model-2
    - name: model2-shard3
      resource: model-2
    - name: model2-shard4
      resource: model-2
resources:
  model-1:
    topology:
    - key: gpu-clique
      group: model-1-group
    - key: zone
      group: workflow-group
  model-2:
    topology:
    - key: gpu-clique
      group: model-2-group
    - key: zone
      group: workflow-group
```

**Expected PodGroup**:
- `spec.topologyConstraint`:
  - `topology`: "<pool-name>-topology"
  - `requiredTopologyLevel`: "topology.kubernetes.io/zone"
- `spec.subgroups`: Two subgroups with parent-child relationships:
  - Subgroup 1: minMember=4, topologyConstraint for gpu-clique
  - Subgroup 2: minMember=4, topologyConstraint for gpu-clique

#### Test 3.2: Three-Level Hierarchy
**Workflow Spec**: Extends 3.1 with rack, spine, and zone levels

**Pool Config**:
```yaml
topology_keys:
- key: rack
  label: topology.kubernetes.io/rack
- key: spine
  label: topology.kubernetes.io/spine
- key: zone
  label: topology.kubernetes.io/zone
```

**Expected PodGroup**:
- Top-level `topologyConstraint` for zone
- Multiple levels of nested subgroups with parent references

#### Test 3.3: Mixed Required and Preferred
**Use Case**: [Use Case 4](#usecase-4) from design doc (Best Effort Topology Awareness)

**Workflow Spec**:
```yaml
resources:
  model-1:
    topology:
    - key: rack
      group: model-1-group
      requirementType: preferred
    - key: spine
      group: workflow-group
      requirementType: preferred
```

**Expected PodGroup**:
- Uses `preferredTopologyLevel` instead of `requiredTopologyLevel`

### Category 4: Edge Cases and Error Conditions

#### Test 4.1: Empty Topology List
**Workflow Spec**: `topology: []`

**Expected**: Same as no topology (no topology constraints in PodGroup)

#### Test 4.2: Invalid Topology Key
**Workflow Spec**: References a topology key not in pool config

**Expected**: Validation error during workflow submission

#### Test 4.3: Single Task with Topology
**Workflow Spec**: One task with topology requirement

**Expected PodGroup**:
- Single subgroup with minMember=1

#### Test 4.4: All Tasks Same Topology Group
**Workflow Spec**: All tasks use the same topology group and key

**Expected PodGroup**:
- Top-level `topologyConstraint` for that key
- Single subgroup (or no subgroups if coarsest level)

#### Test 4.5: Topology Keys Out of Order
**Workflow Spec**: Topology requirements listed in wrong order (coarse before fine)

**Expected**: Should still work correctly (implementation should handle ordering)

#### Test 4.6: Non-KAI Scheduler
**Pool Config**: Backend not using KAI scheduler

**Expected**: Error when trying to configure topology_keys

### Category 5: Complex Scenarios

#### Test 5.1: Multiple Task Groups
**Workflow Spec**: Multiple groups in workflow, each with different topology requirements

**Expected**: PodGroup per task group, each with appropriate topology constraints

#### Test 5.2: Mixed Resources Across Different Groups
**Workflow Spec**:
```yaml
workflow:
  groups:
  - name: group1  # Has topology
    tasks:
    - name: model1-shard1
      resource: model-1
    - name: model1-shard2
      resource: model-1
  - name: group2  # No topology
    tasks:
    - name: cpu-task1
      resource: model-2
    - name: cpu-task2
      resource: model-2
resources:
  model-1:
    topology:
    - key: gpu-clique
      group: model-1-group
  model-2:
    cpu: 4
    # No topology
```

**Expected**:
- Two separate PodGroups (one per task group)
- group1's PodGroup: Has topology constraints
- group2's PodGroup: No topology constraints (standard PodGroup)

#### Test 5.3: Default Topology Group
**Workflow Spec**: Multiple tasks using default topology group

**Expected PodGroup**:
- All tasks with same group value should be in same subgroup

#### Test 5.4: Large Scale (Many Subgroups)
**Workflow Spec**: 10+ different topology groups

**Expected PodGroup**:
- Correctly handles many subgroups
- Subgroup naming is unique and consistent

### Category 6: Validation and Error Handling

#### Test 6.1: Topology Key Not in Pool Config
**Workflow Spec**: References topology key "invalid-key" not in pool's topology_keys

**Expected**: Validation error at workflow parse time with clear message about invalid key

#### Test 6.2: Inconsistent Topology Keys Within Group
**Workflow Spec**:
```yaml
workflow:
  groups:
  - name: group1
    tasks:
    - name: task1
      resource: model-1
    - name: task2
      resource: model-2
resources:
  model-1:
    topology:
    - key: gpu-clique
      group: subgroup-1
  model-2:
    topology:
    - key: zone  # Different topology key!
      group: subgroup-2
```

**Expected**: Validation error at workflow parse time - all tasks in a group must have the same topology keys

#### Test 6.3: Mixed Topology and Non-Topology Within Same Group
**Workflow Spec**:
```yaml
workflow:
  groups:
  - name: group1
    tasks:
    - name: task1
      resource: model-1
    - name: task2
      resource: model-2
resources:
  model-1:
    topology:
    - key: gpu-clique
      group: subgroup-1
  model-2:
    cpu: 4
    # No topology
```

**Expected**: Validation error at workflow parse time - all tasks in a group must have the same topology keys (including the case where some have topology and others don't)

#### Test 6.4: Conflicting Topology Groups
**Workflow Spec**: Same task with conflicting group assignments in topology hierarchy

**Expected**: Validation error at workflow parse time

#### Test 6.5: Pool Without Topology Support
**Expected**: Validation error if workflow with topology requirements is submitted to pool without topology_keys configured

## Implementation Plan

### Phase 1: Infrastructure Setup
1. **Enhance ResourceSpec** (if needed)
   - Add `topology` field to `connectors.ResourceSpec`
   - Add validation for topology requirements at workflow parse time:
     - All topology keys must exist in pool's topology_keys
     - All tasks within a task group must have identical topology keys
     - Either all tasks in a group have topology or none do
   - File: `src/utils/connectors/postgres.py`

2. **Create Test Base Class**
   - File: `src/utils/job/tests/test_topology.py`
   - Implement `TopologyTestBase` with helper methods
   - Create mock configurations

3. **Create Validation Utilities**
   - Helper functions for asserting PodGroup structure
   - Helper functions for asserting Pod labels/annotations

### Phase 2: Basic Test Cases
1. Implement Category 1 tests (Basic Topology Requirements)
2. Implement Category 4.1-4.3 tests (Simple edge cases)
3. Validate test harness works correctly

### Phase 3: Advanced Test Cases
1. Implement Category 2 tests (Multiple Subgroups)
2. Implement Category 3 tests (Hierarchical Topology)
3. Implement remaining Category 4 tests (Complex edge cases)

### Phase 4: Complex Scenarios
1. Implement Category 5 tests (Complex Scenarios)
2. Implement Category 6 tests (Validation and Error Handling)

### Phase 5: Documentation and Cleanup
1. Document test harness usage
2. Add inline comments explaining complex test scenarios
3. Create examples for future test additions

## File Structure

```
src/utils/job/tests/
├── test_topology.py              # Main test file
│   ├── TopologyTestBase          # Base class with utilities
│   ├── BasicTopologyTests        # Category 1 tests
│   ├── MultipleSubgroupTests     # Category 2 tests
│   ├── HierarchicalTopologyTests # Category 3 tests
│   ├── EdgeCaseTests             # Category 4 tests
│   ├── ComplexScenarioTests      # Category 5 tests
│   └── ValidationTests           # Category 6 tests
├── fixtures/
│   └── topology_workflows/       # YAML workflow specs for tests
│       ├── single_nvl72_rack.yaml
│       ├── multiple_nvl72_racks.yaml
│       ├── hierarchical_zone.yaml
│       └── ...
```

## Testing Strategy

### Unit Test Focus
- **Input**: Workflow YAML + Pool Config
- **Process**: Call existing code to generate PodGroup
- **Output**: Validate PodGroup spec structure

### What We're NOT Testing
- Actual Kubernetes scheduling behavior
- KAI scheduler interpretation of PodGroups
- Real cluster topology
- Network performance

### Success Criteria
1. All test cases pass
2. Test coverage of PodGroup generation code ≥ 90%
3. Tests run in < 10 seconds total
4. Clear error messages for test failures
5. Easy to add new test cases

## Dependencies

### Code Changes Required
1. **Implement topology support in ResourceSpec** (if not already done)
   - Location: `src/utils/connectors/postgres.py`
   - Add `topology: List[TopologyRequirement]` field

2. **Implement topology-aware PodGroup generation** (if not already done)
   - Location: `src/utils/job/kb_objects.py`
   - Update `KaiK8sObjectFactory.create_group_k8s_resources()`
   - Implement the algorithm from design doc section "Implementation"

3. **Add topology_keys to Pool config** (if not already done)
   - Location: `src/utils/connectors/postgres.py`
   - Add `topology_keys: List[TopologyKey]` to `Pool` model

### External Dependencies
- unittest (Python standard library)
- yaml (for parsing workflow specs)
- Existing OSMO test infrastructure

## Design Decisions

1. **Subgroup Naming Convention**: Names must be collision-free and human-readable. Implementation can use any approach (e.g., "model-1-group" → "model-1-subgroup", hash-based, UUID-based) as long as it meets these criteria.

2. **Validation Timing**: Topology requirement validation happens at **workflow parse time**. Invalid topology configurations should raise errors before the workflow is submitted to the backend.

3. **Backwards Compatibility**: Not a concern for initial implementation. Topology-aware scheduling is a new feature and doesn't need to maintain compatibility with older backend versions.

4. **Default Behavior**: **All tasks within a task group MUST have the same topology keys**. Partial topology requirements (some tasks with topology, some without) within a group are NOT allowed and should be rejected during validation. This simplifies the implementation and ensures consistent scheduling behavior.

5. **Priority vs Topology**: These are independent concerns. Topology constraints do not interact with workflow priority settings. Priority is handled separately in the PodGroup spec via `priorityClassName`.

## References

- [PROJ-206 Topology-Aware Scheduling Design Doc](projects/PROJ-206-nvlink-support/PROJ-206-topology-aware-scheduling.md)
- [KAI Scheduler Topology Documentation](https://docs.run.ai/) (external)
- [Existing Test Infrastructure](src/utils/job/tests/test_harness.py)
- [PodGroup Generation Code](src/utils/job/kb_objects.py)
