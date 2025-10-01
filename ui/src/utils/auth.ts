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
export const updateALBCookies = (cookie: string, domain?: string): void => {
  const parts = cookie.split(`, `);

  // Set the cookies to expire in 30 seconds so that they will not be sent for subsequent requests of port forward/exec
  if (parts.length === 2 && typeof document !== 'undefined') {
    document.cookie = `${parts[0]}${domain ? `; domain=.${domain}` : ""}; max-age=10`;
    document.cookie = `${parts[1]}${domain ? `; domain=.${domain}` : ""}; max-age=10`;
  }
};
