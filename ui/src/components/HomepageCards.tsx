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
import Link from "next/link";

interface HomepageCardProps {
  title: string;
  imageUrl: string;
  imageAlt: string;
  body: React.ReactNode;
  tutorialLink: string;
  workflowLink: string;
}

export const HomepageCard: React.FC<HomepageCardProps> = ({
  title,
  imageUrl,
  imageAlt,
  body,
  tutorialLink,
  workflowLink,
}) => {
  return (
    <div className="card flex flex-col">
      <div className="relative h-50">
        <Image
          fill
          className="object-cover"
          src={imageUrl}
          alt={imageAlt}
          sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 25vw"
        />
      </div>
      <div className="flex flex-col justify-between flex-grow bg-white">
        <div className="p-4 flex flex-col">
          <h4>{title}</h4>
          <p>{body}</p>
        </div>
        <div className="modal-footer">
          <a
            className="btn btn-secondary bg-white"
            href={tutorialLink}
            target="_blank"
            rel="noopener noreferrer"
          >
            View Tutorial
          </a>
          <Link
            className="btn btn-primary"
            href={workflowLink}
          >
            Launch Workflow
          </Link>
        </div>
      </div>
    </div>
  );
};

export const HomepageCards = () => {
  return (
    <div className="flex flex-col gap-3 p-3">
      <h2 className="text-center">Getting Started</h2>
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-4 lg:grid-cols-3 md:grid-cols-2">
        <HomepageCard
          title="Generate Synthetic Data Using Isaac Sim"
          imageUrl="/sdg.png"
          imageAlt="Synthetic Data Generation"
          body={
            <p>
              In this tutorial, you will generate synthetic data of warehouse scenes using NVIDIA’s robotics simulator,{" "}
              <a
                href="https://developer.nvidia.com/isaac-sim"
                target="_blank"
                rel="noopener noreferrer"
                className="link-inline"
              >
                Isaac Sim
              </a>
              .
            </p>
          }
          tutorialLink="/docs/tutorials/sdg.html"
          workflowLink="/workflows/submit/isaac_sim_sdg"
        />
        <HomepageCard
          title="Training Deep Learning Networks"
          imageUrl="/train.jpg"
          imageAlt="Training"
          body={
            <p>
              In this tutorial, you will train a basic image classification (MNIST) DNN model using{" "}
              <a
                href="https://github.com/pytorch/examples/tree/main/mnist"
                target="_blank"
                rel="noopener noreferrer"
                className="link-inline"
              >
                Pytorch examples
              </a>
              .
            </p>
          }
          tutorialLink="/docs/tutorials/training.html"
          workflowLink="/workflows/submit/mnist_training"
        />
        <HomepageCard
          title="Hardware-in-the-Loop Simulation"
          imageUrl="/robot.png"
          imageAlt="Humanoid in Isaac Lab"
          body={
            <p>
              In this tutorial, you will run a humanoid robot policy on a <strong>Jetson</strong> device, and stream the
              actions to control the robot via the{" "}
              <a
                href="https://developer.nvidia.com/isaac/lab"
                target="_blank"
                rel="noopener noreferrer"
                className="link-inline"
              >
                Isaac Lab
              </a>{" "}
              simulation environment, focusing on robot learning.
            </p>
          }
          tutorialLink="/docs/tutorials/hil.html"
          workflowLink="/workflows/submit/hil"
        />
        <HomepageCard
          title="Inference and Fine-tuning with Isaac Groot"
          imageUrl="/groot.png"
          imageAlt="Groot N1.5"
          body={
            <p>
              In this tutorial, you will run inference and fine-tuning with{" "}
              <a
                href="https://research.nvidia.com/labs/gear/gr00t-n1_5/"
                target="_blank"
                rel="noopener noreferrer"
                className="link-inline"
              >
                Isaac Groot
              </a>{" "}
              (a foundation model for robotics) using a <strong>Jupyter notebook</strong>.
            </p>
          }
          tutorialLink="/docs/tutorials/groot.html"
          workflowLink="/workflows/submit/groot"
        />
      </div>
    </div>
  );
};
