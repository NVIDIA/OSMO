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
import { stripUrlParam } from '../common';

describe('stripUrlParam', () => {
  it('should remove a single parameter from a URL', () => {
    const url = 'https://example.com?param1=value1&param2=value2';
    const result = stripUrlParam(url, 'param1');
    expect(result).toBe('https://example.com/?param2=value2');
  });

  it('should remove the last parameter from a URL', () => {
    const url = 'https://example.com?param1=value1&param2=value2';
    const result = stripUrlParam(url, 'param2');
    expect(result).toBe('https://example.com/?param1=value1');
  });

  it('should return the same URL if parameter does not exist', () => {
    const url = 'https://example.com?param1=value1';
    const result = stripUrlParam(url, 'nonexistent');
    expect(result).toBe('https://example.com/?param1=value1');
  });

  it('should handle URLs without any parameters', () => {
    const url = 'https://example.com';
    const result = stripUrlParam(url, 'param1');
    expect(result).toBe('https://example.com/');
  });

  it('should handle invalid URLs by returning the original string', () => {
    const invalidUrl = 'not-a-valid-url';
    const result = stripUrlParam(invalidUrl, 'param1');
    expect(result).toBe(invalidUrl);
  });

  it('should handle URLs with multiple instances of the same parameter', () => {
    const url = 'https://example.com?param1=value1&param1=value2&param2=value3';
    const result = stripUrlParam(url, 'param1');
    expect(result).toBe('https://example.com/?param2=value3');
  });

  it('should preserve URL fragments', () => {
    const url = 'https://example.com?param1=value1#section1';
    const result = stripUrlParam(url, 'param1');
    expect(result).toBe('https://example.com/#section1');
  });
});
