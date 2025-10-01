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

import Image from "next/image";

import { env } from "~/env.mjs";

export const HomepageHero = () => {
  return (
    <div className="relative">
      <>
        <div className="absolute inset-0" />
        <Image
          style={{ objectFit: "cover" }}
          fill
          src="/hero.png"
          alt=""
        />
      </>
      <div className="bg-gradient-to-r from-black/75 to-black/25 text-white relative p-4 lg:px-16 lg:py-6">
        <div className="flex flex-col gap-4 justify-start">
          <h1>Welcome to {env.NEXT_PUBLIC_APP_NAME}</h1>
          <p>
            Run your workflows seamlessly on any cloud environment including AWS, Azure, GCP, NVIDIA Omniverse Cloud and
            On-premise Kubernetes clusters
          </p>
          <ul>
            <li>Build a Data factory to manage your synthetic and real data</li>
            <li>Train Deep Neural Networks with experiment tracking</li>
            <li>Evaluate your models and publish the results</li>
            <li>Test the robot in Simulation with Software-In-Loop (SIL) or Hardware-In-Loop (HIL)</li>
            <li>Automate your workflows with CI/CD systems</li>
          </ul>
          <a
            href="/docs/"
            target="_blank"
            className="btn btn-primary self-start"
          >
            Documentation
          </a>
        </div>
      </div>
    </div>
  );
};
