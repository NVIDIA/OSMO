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
import Link from "next/link";

import { OutlinedIcon } from "~/components/Icon";

export const PoolActions = ({ name }: { name: string }) => {
  return (
    <>
      <Link
        href={`/workflows?allPools=false&pools=${name}`}
        className="btn btn-link no-underline"
        role="listitem"
      >
        <OutlinedIcon name="work_outline" />
        My Workflows
      </Link>
      <Link
        href={`/tasks?allPools=false&pools=${name}`}
        className="btn btn-link no-underline"
        role="listitem"
      >
        <OutlinedIcon name="task" />
        My Tasks
      </Link>
      <Link
        href={`/workflows?allPools=false&pools=${name}&allUsers=true`}
        className="btn btn-link no-underline"
        role="listitem"
      >
        <OutlinedIcon name="work_outline" />
        All Workflows
      </Link>
      <Link
        href={`/tasks?allPools=false&pools=${name}&allUsers=true`}
        className="btn btn-link no-underline"
        role="listitem"
      >
        <OutlinedIcon name="task" />
        All Tasks
      </Link>
      <Link
        href={`/resources?allPools=false&pools=${name}`}
        className="btn btn-link no-underline"
        role="listitem"
      >
        <OutlinedIcon name="cloud" />
        View Resources
      </Link>
    </>
  );
};
