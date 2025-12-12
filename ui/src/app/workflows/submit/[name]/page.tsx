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
"use client";

import { Container } from "~/components/Container";
import { PageError } from "~/components/PageError";
import PageHeader from "~/components/PageHeader";
import { Spinner } from "~/components/Spinner";
import type { WorkflowSlugParams } from "~/models";
import { api } from "~/trpc/react";

import { mockCreatedWorkflowFile, WorkflowsSubmit } from "../../components/WorkflowsSubmit";

const WorkflowsSubmitPage = ({ params }: WorkflowSlugParams) => {
  const workflowName = params.name;

  // Fetches the previous spec that it was submitted through
  const {
    data: templatedSpec,
    error: templatedSpecError,
    isLoading: templatedSpecLoading,
  } = api.workflows.getWorkflowSpec.useQuery({
    name: workflowName,
    use_template: true,
  });

  const {
    data: renderedSpec,
    error: renderedSpecError,
    isLoading: renderedSpecLoading,
  } = api.workflows.getWorkflowSpec.useQuery({
    name: workflowName,
    use_template: false,
  });

  return (
    <>
      <PageHeader>
        <h2 className="grow">{workflowName}</h2>
      </PageHeader>
      {templatedSpecLoading || renderedSpecLoading ? (
        <Container className="h-full w-full items-center justify-center">
          <Spinner
            description="Loading Spec..."
            size="large"
          />
        </Container>
      ) : (templatedSpecError ?? renderedSpecError) ? (
        <PageError
          className="h-full w-full"
          title="Failed to load workflow spec"
          errorMessage={templatedSpecError?.message ?? renderedSpecError?.message}
          icon="error_outline"
        />
      ) : (
        <WorkflowsSubmit
          placeholderFile={templatedSpec ?? mockCreatedWorkflowFile}
          renderedSpec={renderedSpec ?? mockCreatedWorkflowFile}
        />
      )}
    </>
  );
};

export default WorkflowsSubmitPage;
