"""
SPDX-FileCopyrightText: Copyright (c) 2025 NVIDIA CORPORATION & AFFILIATES. All rights reserved.

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.

SPDX-License-Identifier: Apache-2.0
"""
import argparse
import base64
import json
import math
import os
import random
import signal
import subprocess
from typing import Tuple
import time

from PIL import Image

Vector3 = Tuple[float, float ,float]
Quaterion = Tuple[float, float, float, float]

ENTITY_LIST = [
    'Hatchback-0',
    'Hatchback-1',
    'Hatchback-2',
    'Pickup-0',
    'Pickup-1',
    'Pickup-2',
    'Suv-0',
    'Suv-1',
    'Suv-2',
    'Tree-0',
    'Tree-1',
    'Tree-2',
    'Cone-0',
    'Cone-1',
    'Cone-2',
]

# Move objects where they wont be renered when we aren't using them
STANDBY_POSE = (10000, 10000, 10000)
STANDBY_ORIENTATION = (0, 0, 0, 1)

class Frustrum:
    def __init__(self, near_x: float, near_y: Tuple[float, float], near_z: Tuple[float, float],
                 far_x: float, far_y: Tuple[float, float], far_z: Tuple[float, float]):
        self.near_x = near_x
        self.near_y = near_y
        self.near_z = near_z
        self.far_x = far_x
        self.far_y = far_y
        self.far_z = far_z

    def random_point(self) -> Vector3:
        ''' Get a random point in the frustrum (Note: The probability desnity is lower towards the
        "big" end of the frustrum) '''

        # How "towards the back" we are, 0 at the front, 1 at the back
        d = random.random()

        y_range = (self.near_y[0]*(1 - d) + self.far_y[0]*d, self.near_y[1]*(1 - d) + self.far_y[1]*d)
        z_range = (self.near_z[0]*(1 - d) + self.far_z[0]*d, self.near_z[1]*(1 - d) + self.far_z[1]*d)

        x = self.near_x*(1 - d) + self.far_x*d
        y = random.uniform(*y_range)
        z = random.uniform(*z_range)
        return (x, y, z)


    def random_orientation(self) -> Quaterion:
        d = 0
        while d < 0.001:
            x = random.uniform(-1, 1)
            y = random.uniform(-1, 1)
            z = random.uniform(-1, 1)
            w = random.uniform(-1, 1)
            d = sum(i**2 for i in (x, y, z, w))**(1/2)
        return x/d, y/d, z/d, w/d


class Simulator:
    def __init__(self, map: str):
        self._map = map
        self._sim_process = None

    def start(self, wait: int = 10):
        os.setpgrp()
        # Start the simulator
        print('Starting simulator process ...')
        self._sim_process = subprocess.Popen(['gz', 'sim', '--headless-rendering', '-s', self._map])
        # Wait for it to start
        print('Waiting for first stats message from simulator ...')
        self._sim_process = subprocess.run(['gz', 'topic', '-e', '--topic', '/stats', '-e', '-n', '1'], check=True)
        # Wait an additional amount of time to make sure its really started
        print(f'Waiting {wait}s for initialization to finish ...')
        time.sleep(wait)

    def move_entity(self, name: str, pos: Vector3, orientation: Quaterion):
        pos_message = f'x: {pos[0]}, y: {pos[1]}, z: {pos[2]}'
        orientation_message = f'x: {orientation[0]}, y: {orientation[1]}, z: {orientation[2]}, w: {orientation[3]}'
        message = 'pose: [{name: "' + name + '", position: {' + pos_message + '}, orientation: {' + orientation_message + '}]'

        subprocess.run(['gz', 'service', '-s', '/world/shapes/set_pose_vector',
            '--reqtype', 'gz.msgs.Pose_V', '--reptype', 'gz.msgs.Boolean', '--req', message, '--timeout', '1000'], check=True)

    def reset_entity(self, name: str):
        self.move_entity(name, STANDBY_POSE, STANDBY_ORIENTATION)

    def capture_frame(self, output_dir: str, index: int):
        subprocess.run(['gz', 'service', '-s', '/world/shapes/control', '--reqtype', 'gz.msgs.WorldControl', '--reptype', 'gz.msgs.Boolean', '--req', 'step: true', '--timeout', '1000'], check=True)
        subprocess.run('gz topic -e --topic /semantic/labels_map -n 1 --json-output > /tmp/labels.json', shell=True, check=True)
        subprocess.run('gz topic -e --topic /camera -n 1 --json-output > /tmp/camera.json', shell=True, check=True)
        subprocess.run(['gz', 'service', '-s', '/world/shapes/control', '--reqtype', 'gz.msgs.WorldControl', '--reptype', 'gz.msgs.Boolean', '--req', 'pause: true', '--timeout', '1000'], check=True)
        self.json_to_png('/tmp/labels.json', f'{output_dir}/labels_{index}.png')
        self.json_to_png('/tmp/camera.json', f'{output_dir}/camera_{index}.png')

    def json_to_png(self, input: str, output: str):
        with open(input) as file:
            data = json.load(file)
        image_data = base64.b64decode(data['data'])
        image = Image.frombytes('RGB', (data['width'], data['height']), image_data)
        image.save(output)

    def stop(self):
        os.killpg(0, signal.SIGKILL)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--map', default='/app/segmentation_world.sdf', help='The sdf file to load into gazebo')
    parser.add_argument('--images', '-n', type=int, default=10, help='The number of images to generate')
    parser.add_argument('--out', default='/out', help='The location to output the generated images')
    args = parser.parse_args()

    frustrum = Frustrum(near_x=3, near_y=(-3, 3), near_z=(0, 4), far_x=-10, far_y=(-15, 15), far_z=(0, 12))
    simulator = Simulator(map=args.map)
    simulator.start()

    print('Resetting all entities')
    for entity in ENTITY_LIST:
        simulator.reset_entity(entity)

    for i in range(0, args.images):
        print(f'Image {i}/{args.images-1}')
        # Select a random subset of entities
        entities = []
        while not entities:
            entities = [entity for entity in ENTITY_LIST if random.random() > 0.5]

        # Move them into random positions
        for entity in entities:
            pos = frustrum.random_point()
            orientation = frustrum.random_orientation()
            simulator.move_entity(entity, pos, orientation)

        # Capture a frame
        simulator.capture_frame(args.out, i)

        # Reset the entities
        for entity in entities:
            simulator.reset_entity(entity)

    simulator.stop()

if __name__ == '__main__':
    main()
