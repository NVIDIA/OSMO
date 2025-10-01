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
import { roundResources } from '../resources-model';

describe('roundResources', () => {
  it('should round up usage and round down allocatable', () => {
    const input = {
      allocatable: 10.7,
      usage: 5.3
    };
    const expected = {
      allocatable: 10,
      usage: 6
    };
    expect(roundResources(input)).toEqual(expected);
  });

  it('should ensure usage does not exceed allocatable', () => {
    const input = {
      allocatable: 5.7,
      usage: 6.3
    };
    const expected = {
      allocatable: 5,
      usage: 5
    };
    expect(roundResources(input)).toEqual(expected);
  });

  it('should handle integer values correctly', () => {
    const input = {
      allocatable: 10,
      usage: 5
    };
    const expected = {
      allocatable: 10,
      usage: 5
    };
    expect(roundResources(input)).toEqual(expected);
  });

  it('should handle zero values', () => {
    const input = {
      allocatable: 0,
      usage: 0
    };
    const expected = {
      allocatable: 0,
      usage: 0
    };
    expect(roundResources(input)).toEqual(expected);
  });

  it('should return zeros when both values are negative', () => {
    const input = {
      allocatable: -5.7,
      usage: -3.3
    };
    const expected = {
      allocatable: 0,
      usage: 0
    };
    expect(roundResources(input)).toEqual(expected);
  });

  it('should return zeros when only allocatable is negative', () => {
    const input = {
      allocatable: -5.7,
      usage: 3.3
    };
    const expected = {
      allocatable: 0,
      usage: 0
    };
    expect(roundResources(input)).toEqual(expected);
  });

  it('should return zeros when only usage is negative', () => {
    const input = {
      allocatable: 5.7,
      usage: -3.3
    };
    const expected = {
      allocatable: 0,
      usage: 0
    };
    expect(roundResources(input)).toEqual(expected);
  });
});
