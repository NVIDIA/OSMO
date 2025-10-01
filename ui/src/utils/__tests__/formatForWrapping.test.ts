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
import { formatForWrapping } from '../string';

describe('formatForWrapping', () => {
  it('should handle empty string', () => {
    expect(formatForWrapping('')).toBe('');
  });

  it('should add zero-width spaces after underscores and @ symbols', () => {
    const input = 'test_underscore@symbol';
    const expected = 'test_\u200Bunderscore@\u200Bsymbol';
    expect(formatForWrapping(input)).toBe(expected);
  });

  it('should break long strings into 20-character chunks', () => {
    const input = 'a'.repeat(25);
    const expected = 'a'.repeat(20) + '\u200B' + 'a'.repeat(5);
    expect(formatForWrapping(input)).toBe(expected);
  });

  it('should handle strings with multiple breaking characters', () => {
    const input = 'test-string with_spaces@symbol';
    const expected = 'test-string with_\u200Bspaces@\u200Bsymbol';
    expect(formatForWrapping(input)).toBe(expected);
  });

  it('should handle strings with multiple underscores and @ symbols', () => {
    const input = 'test_underscore_here@and@here';
    const expected = 'test_\u200Bunderscore_\u200Bhere@\u200Band@\u200Bhere';
    expect(formatForWrapping(input)).toBe(expected);
  });

  it('should handle strings with breaking characters and long sections', () => {
    const input = 'test_' + 'a'.repeat(25) + '@symbol';
    const expected = 'test_\u200B' + 'a'.repeat(19) + '\u200B' + 'a'.repeat(6) + '@\u200Bsymbol';
    expect(formatForWrapping(input)).toBe(expected);
  });

  it('should preserve original string if no wrapping is needed', () => {
    const input = 'short string';
    expect(formatForWrapping(input)).toBe(input);
  });

  it('should handle strings with consecutive breaking characters', () => {
    const input = 'test__double@_mixed';
    const expected = 'test_\u200B_\u200Bdouble@\u200B_\u200Bmixed';
    expect(formatForWrapping(input)).toBe(expected);
  });

  it('should handle strings with breaking characters at the start and end', () => {
    const input = '_start@middle_end@';
    const expected = '_\u200Bstart@\u200Bmiddle_\u200Bend@\u200B';
    expect(formatForWrapping(input)).toBe(expected);
  });

  it('should handle strings with existing zero-width spaces', () => {
    const input = 'test_\u200B_underscore@\u200B@symbol';
    const expected = 'test_\u200B_\u200Bunderscore@\u200B@\u200Bsymbol';
    expect(formatForWrapping(input)).toBe(expected);
  });
  it('should not add zero-width spaces if the string has enough _ already', () => {
    const input = 'test_underscore17chars@symbol';
    const expected = 'test_\u200Bunderscore17chars@\u200Bsymbol';
    expect(formatForWrapping(input)).toBe(expected);
  });
  it('should add zero-width spaces if the string has enough _ already', () => {
    const input = 'test_underscore23characters@symbol';
    const expected = 'test_\u200Bunderscore23charact\u200Bers@\u200Bsymbol';
    expect(formatForWrapping(input)).toBe(expected);
  });
});
