#####################################################################################
# Copyright (c) 2023, NVIDIA CORPORATION. All rights reserved.
# NVIDIA CORPORATION and its licensors retain all intellectual property
# and proprietary rights in and to this software, related documentation
# and any modifications thereto. Any use, reproduction, disclosure or
# distribution of this software and related documentation without an express
# license agreement from NVIDIA CORPORATION is strictly prohibited.
#####################################################################################
set -ex
# Open a TCP server in listening mode using port 24831
# Wait for 50 seconds before closing the connection
nc -w 50 -l -p 24831 < /tmp/hello.txt
