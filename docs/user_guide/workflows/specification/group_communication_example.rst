..
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

.. dropdown:: Example with ``{{host:<task_name>}}``
    :color: primary
    :icon: code
    :open:

    In this example, both tasks are part of a group and can communicate over the private network:

    .. code-block:: yaml

        workflow:
            name: server-client
            groups:
            - name: my_group
            tasks:
            - name: server
                image: busybox
                lead: true
                command: [sh]
                args: [/tmp/run.sh]
                files:
                - contents: |
                    nc -w 50 -l -p 24831 < /tmp/hello.txt # (1)
                path: /tmp/run.sh
                - contents: |-
                    hello
                path: /tmp/hello.txt
            - name: client
                image: busybox
                command: [sh]
                args: [/tmp/run.sh]
                files:
                - contents: |
                    retries=45
                    while ! nslookup {{host:server}} > /dev/null ; do # (2)
                        echo "Waiting for server pod, $retries retries left..."
                        if [ $retries -eq 0 ] ; then
                            echo "Server pod not started in time!"
                            exit 1
                        fi
                        retries=$(($retries - 1))
                        sleep 1
                    done

                    retries=20
                    while ! nc -w 30 {{host:server}} 24831 > tmp/tcp_echo.txt ; do # (3)
                        echo "Attempting to connect to server, $retries retries left..."
                        if [ $retries -eq 0 ] ; then
                            echo "Could not connect to server in time!"
                            exit 1
                        fi
                        retries=$(($retries - 1))
                        sleep 1
                    done

                    cat tmp/tcp_echo.txt > {{output}}/tcp_echo.txt # (4)
                path: /tmp/run.sh

    .. code-annotations::

        1. Opens a TCP server in listening mode using port 24831
        2. Waits for the server container to be created
        3. Attempts to read from the server for 20 seconds
        4. Writes the contents of the server to the output folder
