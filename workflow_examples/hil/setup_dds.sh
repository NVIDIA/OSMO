#!/bin/bash
# SPDX-FileCopyrightText: Copyright (c) 2025 NVIDIA CORPORATION. All rights reserved.
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

set -x +e
sudo apt update
# set noninteractive installation
export DEBIAN_FRONTEND=noninteractive
# install tzdata package
apt-get install -y tzdata
# set timezone
ln -fs /usr/share/zoneinfo/America/Los_Angeles /etc/localtime
dpkg-reconfigure --frontend noninteractive tzdata
sudo apt install -y net-tools netcat dnsutils

NAT_INTERFACE=eth0
NAT_IP=$(ifconfig "$NAT_INTERFACE" | grep -oP "inet \K\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}")

DISCOVERY_SERVER_IP=$(nslookup {{host:discovery-server}} | grep -oP \
    'Address: \K\d[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}')

while [[ $DISCOVERY_SERVER_IP == "" ]] ; do
    sleep 10
    DISCOVERY_SERVER_IP=$(nslookup {{host:discovery-server}} | grep -oP \
    'Address: \K\d[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}')
done

# Add in IP information in discovery server config
sudo cp /workspaces/config/mounted_discovery_server_config.xml \
    /workspaces/config/discovery_server_config.xml
DDS_CONFIG_XML_PATH=/workspaces/config/discovery_server_config.xml
sudo sed -i "s/DISCOVERY_SERVER_IP/$DISCOVERY_SERVER_IP/g" $DDS_CONFIG_XML_PATH
sudo sed -i "s/CURRENT_MACHINE_PUBLIC_IP/$NAT_IP/g" $DDS_CONFIG_XML_PATH

# Add env variables
export ROS_DISCOVERY_SERVER=$DISCOVERY_SERVER_IP:11811
export FASTRTPS_DEFAULT_PROFILES_FILE=$DDS_CONFIG_XML_PATH
