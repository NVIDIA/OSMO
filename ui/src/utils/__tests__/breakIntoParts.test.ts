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
import { breakIntoParts } from '../string';

describe('breakIntoParts', () => {
  it('should handle empty string', () => {
    expect(breakIntoParts('')).toEqual([]);
  });

  it('should handle string without breaking characters', () => {
    expect(breakIntoParts('hello')).toEqual(['hello']);
  });

  it('should break string on spaces', () => {
    expect(breakIntoParts('hello world')).toEqual(['hello', ' ', 'world']);
  });

  it('should break string on hyphens', () => {
    expect(breakIntoParts('hello-world')).toEqual(['hello', '-', 'world']);
  });

  it('should break string on question marks', () => {
    expect(breakIntoParts('hello?world')).toEqual(['hello', '?', 'world']);
  });

  it('should handle multiple breaking characters', () => {
    expect(breakIntoParts('hello-world test?')).toEqual(['hello', '-', 'world', ' ', 'test', '?']);
  });

  it('should handle consecutive breaking characters', () => {
    expect(breakIntoParts('hello--world')).toEqual(['hello', '-', '-', 'world']);
  });

  it('should handle breaking characters at start and end', () => {
    expect(breakIntoParts('-hello world-')).toEqual(['-', 'hello', ' ', 'world', '-']);
  });

  it('should handle mixed breaking characters', () => {
    expect(breakIntoParts('hello-world test?final')).toEqual(['hello', '-', 'world', ' ', 'test', '?', 'final']);
  });
});
