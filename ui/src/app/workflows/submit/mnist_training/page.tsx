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
import PageHeader from "~/components/PageHeader";
import { MNIST_TRAINING_WORKFLOW_FILE } from "~/models/workflows-model";

import { WorkflowsSubmit } from "../../components/WorkflowsSubmit";

export default function WorkflowsSubmitPage() {
  return (
    <>
      <PageHeader>
        <h2 className="grow">MNIST Training</h2>
      </PageHeader>
      <WorkflowsSubmit placeholderFile={MNIST_TRAINING_WORKFLOW_FILE} />
    </>
  );
}
