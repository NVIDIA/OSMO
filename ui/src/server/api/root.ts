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
import { versionRouter } from "~/server/api/routers/version-router";
import { workflowsRouter } from "~/server/api/routers/workflows-router";
import { createTRPCRouter } from "~/server/api/trpc";

import { credentialsRouter } from "./routers/credentials-router";
import { datasetsRouter } from "./routers/datasets-router";
import { profileRouter } from "./routers/profile-router";
import { resourcesRouter } from "./routers/resources-router";
import { routerRouter } from "./routers/router-router";
import { tagsRouter } from "./routers/tags-router";
import { tasksRouter } from "./routers/tasks-router";
import { usersRouter } from "./routers/users-router";

/**
 * This is the primary router for your server.
 *
 * All routers added in /api/routers should be manually added here.
 */
export const appRouter = createTRPCRouter({
  workflows: workflowsRouter,
  version: versionRouter,
  credentials: credentialsRouter,
  profile: profileRouter,
  users: usersRouter,
  datasets: datasetsRouter,
  resources: resourcesRouter,
  tags: tagsRouter,
  tasks: tasksRouter,
  router: routerRouter,
});

// export type definition of API
export type AppRouter = typeof appRouter;
