//SPDX-FileCopyrightText: Copyright (c) 2025 NVIDIA CORPORATION & AFFILIATES. All rights reserved.

//Licensed under the Apache License, Version 2.0 (the "License");
//you may not use this file except in compliance with the License.
//You may obtain a copy of the License at

//http://www.apache.org/licenses/LICENSE-2.0

//Unless required by applicable law or agreed to in writing, software
//distributed under the License is distributed on an "AS IS" BASIS,
//WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
//See the License for the specific language governing permissions and
//limitations under the License.

//SPDX-License-Identifier: Apache-2.0
import { convertFields } from '../resources-model';
import type { ResourcesEntry, PlatformAllocatableResourceFields } from '../resources-model';

describe('convertFields', () => {
  const baseResource: Partial<ResourcesEntry> = {
    allocatable_fields: {
      'cpu': '8',
      'gpu': '2',
      'memory': '32Gi',
      'storage': '100Gi',
    },
    usage_fields: {
      'cpu': '4',
      'gpu': '1',
      'memory': '16Gi',
      'storage': '50Gi',
    },
    platform_allocatable_fields: {},
  };

  it('should use default allocatable_fields and usage_fields for CPU', () => {
    const result = convertFields('cpu', baseResource as ResourcesEntry, 'poolA', 'platformA');
    expect(result).toEqual({ allocatable: 8, usage: 4 });
  });

  it('should use default allocatable_fields and usage_fields for GPU', () => {
    const result = convertFields('gpu', baseResource as ResourcesEntry, 'poolA', 'platformA');
    expect(result).toEqual({ allocatable: 2, usage: 1 });
  });

  it('should use convertResourceValueStr for Memory', () => {
    const result = convertFields('memory', baseResource as ResourcesEntry, 'poolA', 'platformA');
    expect(result.allocatable).toBe(32);
    expect(result.usage).toBe(16);
  });

  it('should use convertResourceValueStr for Storage', () => {
    const result = convertFields('storage', baseResource as ResourcesEntry, 'poolA', 'platformA');
    expect(result.allocatable).toBe(100);
    expect(result.usage).toBe(50);
  });

  it('should use platform-specific allocatable fields if present', () => {
    const resourceWithPlatform: Partial<ResourcesEntry> = {
      ...baseResource,
      platform_allocatable_fields: {
        poolA: {
          platformA: {
            'cpu': 6,
            'gpu': 1,
            'memory': '24Gi',
            'storage': 80,
          },
        },
      },
    };
    const cpu = convertFields('cpu', resourceWithPlatform as ResourcesEntry, 'poolA', 'platformA');
    expect(cpu).toEqual({ allocatable: 6, usage: 4 });
    const mem = convertFields('memory', resourceWithPlatform as ResourcesEntry, 'poolA', 'platformA');
    expect(mem.allocatable).toBe(24);
    expect(mem.usage).toBe(16);
  });

  it('should return 0 for missing fields', () => {
    const resourceMissing: Partial<ResourcesEntry> = {
      allocatable_fields: {},
      usage_fields: {},
      platform_allocatable_fields: {},
    };
    const result = convertFields('cpu', resourceMissing as ResourcesEntry, 'poolA', 'platformA');
    expect(result).toEqual({ allocatable: 0, usage: 0 });
  });

  it('should handle different memory unit formats', () => {
    const resourceWithDifferentUnits: Partial<ResourcesEntry> = {
      allocatable_fields: {
        'memory': '32Mi',
        'storage': '100Ki',
      },
      usage_fields: {
        'memory': '16Mi',
        'storage': '50Ki',
      },
      platform_allocatable_fields: {},
    };
    const mem = convertFields('memory', resourceWithDifferentUnits as ResourcesEntry, 'poolA', 'platformA');
    expect(mem.allocatable).toBe(32 / 1024); // 32Mi to Gi
    expect(mem.usage).toBe(16 / 1024); // 16Mi to Gi

    const storage = convertFields('storage', resourceWithDifferentUnits as ResourcesEntry, 'poolA', 'platformA');
    expect(storage.allocatable).toBe(100 / (1024 * 1024)); // 100Ki to Gi
    expect(storage.usage).toBe(50 / (1024 * 1024)); // 50Ki to Gi
  });

  it('should handle null/undefined values in fields', () => {
    const resourceWithNulls: Partial<ResourcesEntry> = {
      allocatable_fields: {
        'cpu': null,
        'gpu': undefined,
        'memory': null,
        'storage': undefined,
      },
      usage_fields: {
        'cpu': null,
        'gpu': undefined,
        'memory': null,
        'storage': undefined,
      },
      platform_allocatable_fields: {},
    };
    const cpu = convertFields('cpu', resourceWithNulls as ResourcesEntry, 'poolA', 'platformA');
    expect(cpu).toEqual({ allocatable: 0, usage: 0 });

    const mem = convertFields('memory', resourceWithNulls as ResourcesEntry, 'poolA', 'platformA');
    expect(mem).toEqual({ allocatable: 0, usage: 0 });
  });

  it('should handle different platform/pool combinations', () => {
    const resourceWithMultiplePlatforms: Partial<ResourcesEntry> = {
      ...baseResource,
      platform_allocatable_fields: {
        poolA: {
          platformA: {
            'cpu': 6,
            'memory': '24Gi',
          },
          platformB: {
            'cpu': 4,
            'memory': '16Gi',
          },
        },
        poolB: {
          platformA: {
            'cpu': 8,
            'memory': '32Gi',
          },
        },
      },
    };

    // Test different pool/platform combinations
    const cpu1 = convertFields('cpu', resourceWithMultiplePlatforms as ResourcesEntry, 'poolA', 'platformA');
    expect(cpu1).toEqual({ allocatable: 6, usage: 4 });

    const cpu2 = convertFields('cpu', resourceWithMultiplePlatforms as ResourcesEntry, 'poolA', 'platformB');
    expect(cpu2).toEqual({ allocatable: 4, usage: 4 });

    const cpu3 = convertFields('cpu', resourceWithMultiplePlatforms as ResourcesEntry, 'poolB', 'platformA');
    expect(cpu3).toEqual({ allocatable: 8, usage: 4 });

    // Test non-existent platform (should fall back to default)
    const cpu4 = convertFields('cpu', resourceWithMultiplePlatforms as ResourcesEntry, 'poolB', 'platformB');
    expect(cpu4).toEqual({ allocatable: 8, usage: 4 });
  });

  it('should handle mixed number/string types in platform fields', () => {
    const resourceWithMixedTypes: Partial<ResourcesEntry> = {
      ...baseResource,
      platform_allocatable_fields: {
        poolA: {
          platformA: {
            'cpu': 6,
            'gpu': 1,
            'memory': '24Gi',
            'storage': 80,
          } as PlatformAllocatableResourceFields,
        },
      },
    };

    const cpu = convertFields('cpu', resourceWithMixedTypes as ResourcesEntry, 'poolA', 'platformA');
    expect(cpu).toEqual({ allocatable: 6, usage: 4 });

    const mem = convertFields('memory', resourceWithMixedTypes as ResourcesEntry, 'poolA', 'platformA');
    expect(mem.allocatable).toBe(24);
    expect(mem.usage).toBe(16);
  });
});
