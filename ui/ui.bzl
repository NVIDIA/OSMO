# SPDX-FileCopyrightText: Copyright (c) 2025 NVIDIA CORPORATION & AFFILIATES. All rights reserved.

# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at

# http://www.apache.org/licenses/LICENSE-2.0

# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

# SPDX-License-Identifier: Apache-2.0


def ui_runfiles_dir():
    """
    Returns the runfiles directory for the ui package.

    This is used to allow the UI to be buildable across Bazel workspaces.
    """
    r = native.repo_name()
    p = native.package_name()
    if r:
        return "{}/{}".format(r, p)
    return p

def ui_standalone_pkg():
    """
    The subdirectory under `.next/standalone/` where Next places the standalone output.

    This ensures that `/public`, `node_modules`, `package.json` and `server.js`
    are in the same directory.

    - When built within the main repo: `bin/<pkg>`
    - When built as an external repository: `<repo>/<pkg>`
    """
    r = native.repo_name()
    p = native.package_name()
    if r:
        return "{}/{}".format(r, p)
    return "bin/{}".format(p)
