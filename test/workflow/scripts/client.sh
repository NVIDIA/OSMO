#####################################################################################
# Copyright (c) 2023, NVIDIA CORPORATION. All rights reserved.
# NVIDIA CORPORATION and its licensors retain all intellectual property
# and proprietary rights in and to this software, related documentation
# and any modifications thereto. Any use, reproduction, disclosure or
# distribution of this software and related documentation without an express
# license agreement from NVIDIA CORPORATION is strictly prohibited.
#####################################################################################
set -ex
# Wait for the server container to be created
retries=45
while ! nslookup {{host:server}} > /dev/null ; do
  echo "Waiting for server pod, $retries retries left..."
  if [ $retries -eq 0 ] ; then
    echo "Server pod not started in time!"
    exit 1
  fi
  retries=$(($retries - 1))
  sleep 1
done

# Attempt to read from the server for 20 seconds
# (The first few attempts may fail if the data phase is still running)
retries=20
while ! nc -w 30 {{host:server}} 24831 > tmp/tcp_echo.txt ; do
  echo "Attempting to connect to server, $retries retries left..."
  if [ $retries -eq 0 ] ; then
    echo "Could not connect to server in time!"
    exit 1
  fi
  retries=$(($retries - 1))
  sleep 1
done

cat tmp/tcp_echo.txt
sleep 1000
