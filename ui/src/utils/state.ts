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
// Utils for working with Maps in react useState
export const getKeysFromMap = <TKey, TValue>(map: Map<TKey, TValue>) =>
  Array.from(map.keys()).reduce((acc, key) => {
    if (map.get(key)) acc.push(key);
    return acc;
  }, [] as TKey[]);

export const setEachValueInMap = <TKey, TValue>(map: Map<TKey, TValue>, value: TValue) => {
  const newMap = new Map<TKey, TValue>();
  map.forEach((_, key) => newMap.set(key, value));
  return newMap;
};

// See https://github.com/facebook/react/issues/10135#issuecomment-314441175
export const setNativeValue = (element: HTMLInputElement, value: unknown) => {
  // eslint-disable-next-line @typescript-eslint/unbound-method
  const valueSetter = Object.getOwnPropertyDescriptor(element, "value")?.set;
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
  const prototype = Object.getPrototypeOf(element);
  // eslint-disable-next-line @typescript-eslint/unbound-method
  const prototypeValueSetter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;

  if (valueSetter && prototypeValueSetter && valueSetter !== prototypeValueSetter) {
    prototypeValueSetter.call(element, value);
  } else if (valueSetter) {
    valueSetter.call(element, value);
  }
};
