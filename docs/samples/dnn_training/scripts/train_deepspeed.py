# SPDX-FileCopyrightText: Copyright (c) 2025 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
# http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.
#
# SPDX-License-Identifier: Apache-2.0

import argparse

import torch.nn as nn
import torch.nn.functional as F

from torchvision import datasets, transforms

import deepspeed


class Net(nn.Module):
    ''' Network architecture. '''

    def __init__(self):
        super(Net, self).__init__()
        self.conv1 = nn.Conv2d(1, 10, kernel_size=5)
        self.conv2 = nn.Conv2d(10, 20, kernel_size=5)
        self.conv2_drop = nn.Dropout2d()
        self.fc1 = nn.Linear(320, 50)
        self.fc2 = nn.Linear(50, 10)

    def forward(self, x):
        x = F.relu(F.max_pool2d(self.conv1(x), 2))
        x = F.relu(F.max_pool2d(self.conv2_drop(self.conv2(x)), 2))
        x = x.view(-1, 320)
        x = F.relu(self.fc1(x))
        x = F.dropout(x, training=self.training)
        x = self.fc2(x)
        return F.log_softmax(x)


def main(args: argparse.Namespace):
    deepspeed.init_distributed()
    local_rank = deepspeed.comm.get_local_rank()

    dataset = datasets.MNIST(f'/tmp/rank_{local_rank}/', train=True, download=True, transform=transforms.ToTensor())
    model = Net()

    # Initialize DeepSpeed model, optimizer, and training
    model_engine, optimizer, train_loader, _ = deepspeed.initialize(
        args=args, model=model, model_parameters=model.parameters(), training_data=dataset)

    # Training loop
    for epoch in range(args.total_epochs):
        total_loss = 0
        for batch_idx, (data, target) in enumerate(train_loader):
            data = data.to(model_engine.local_rank)
            target = target.to(model_engine.local_rank)

            output = model_engine(data)
            loss = F.nll_loss(output, target)
            total_loss += loss.item()

            model_engine.backward(loss)
            model_engine.step()

        print('Rank {}: Epoch [{}/{}], average loss: {:.4f}'.format(
                local_rank,
                epoch + 1,
                args.total_epochs,
                total_loss / (batch_idx + 1)))

        # Save checkpoint at the end of each epoch (for all ranks)
        checkpoint_path = f'{args.snapshot_path}/rank_{local_rank}'
        model_engine.save_checkpoint(checkpoint_path, epoch)
        print(f'Saved checkpoint for rank {local_rank} at {checkpoint_path}')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description='DeepSpeed distributed training job')
    parser.add_argument('--total_epochs', type=int, default=10, help='Total epochs to train the model')
    parser.add_argument('--snapshot_path', default='./checkpoints', help='Path to save snapshots')
    parser.add_argument('--local_rank', type=int, default=-1, help='Local rank for distributed training')
    parser = deepspeed.add_config_arguments(parser)

    args = parser.parse_args()

    main(args)
