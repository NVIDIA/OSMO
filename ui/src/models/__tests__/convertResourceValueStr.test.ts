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
import { convertResourceValueStr } from '../resources-model';

describe('convertResourceValueStr', () => {
  it('should convert to GiB by default', () => {
    expect(convertResourceValueStr('10Gi')).toBe(10);
    expect(convertResourceValueStr('10G')).toBe(10);
    expect(convertResourceValueStr('10GiB')).toBe(10);
  });

  it('should handle different target units', () => {
    expect(convertResourceValueStr('10Gi', 'MiB')).toBe(10 * 1024);
    expect(convertResourceValueStr('10MiB', 'KiB')).toBe(10 * 1024);
    expect(convertResourceValueStr('10TiB', 'GiB')).toBe(10 * 1024);
  });

  it('should handle decimal values', () => {
    expect(convertResourceValueStr('10.5Gi')).toBe(10.5);
    expect(convertResourceValueStr('10.5MiB', 'KiB')).toBe(10.5 * 1024);
  });

  it('should handle empty unit (defaults to B)', () => {
    expect(convertResourceValueStr('1024')).toBe(1024 / Math.pow(2, 30)); // 1024B to GiB
    expect(convertResourceValueStr('1024', 'MiB')).toBe(1024 / Math.pow(2, 20)); // 1024B to MiB
  });

  it('should handle number inputs', () => {
    expect(convertResourceValueStr(10)).toBe(10 / Math.pow(2, 30)); // 10B to GiB
    expect(convertResourceValueStr(10.5)).toBe(10.5 / Math.pow(2, 30)); // 10.5B to GiB
  });

  it('should handle millicores (m)', () => {
    // 1000m = 1 core, which is converted to GiB (very small number)
    const expectedValue = 1000 / Math.pow(2, 40); // 1000m to GiB
    expect(convertResourceValueStr('1000m', 'GiB')).toBe(expectedValue);
    expect(convertResourceValueStr('1000m')).toBe(expectedValue);
  });

  it('should return 0 for invalid inputs', () => {
    expect(convertResourceValueStr('invalid')).toBe(0);
    expect(convertResourceValueStr('10Invalid')).toBe(0);
    expect(convertResourceValueStr('10Gi', 'Invalid')).toBe(0);
  });

  it('should handle large unit conversions', () => {
    expect(convertResourceValueStr('1TiB', 'B')).toBe(Math.pow(2, 40));
    expect(convertResourceValueStr('1KiB', 'B')).toBe(Math.pow(2, 10));
  });

  it('should handle small unit conversions', () => {
    expect(convertResourceValueStr('1B', 'KiB')).toBe(1 / Math.pow(2, 10));
    expect(convertResourceValueStr('1B', 'MiB')).toBe(1 / Math.pow(2, 20));
  });
});
