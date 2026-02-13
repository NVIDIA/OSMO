<!-- SPDX-FileCopyrightText: Copyright (c) 2025 NVIDIA CORPORATION & AFFILIATES. All rights reserved.

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.

SPDX-License-Identifier: Apache-2.0 -->

# Networking

> **Warning**
>
> Setting up networking for OSMO requires cloud networking experience, including:

> - Creating and managing SSL/TLS certificates
> - Configuring DNS records and CNAMEs
> - Associating certificates with load balancers

> Please work with IT admins and DevOps team or refer to the cloud provider guides below.

## Requirements

![image](deployment_guide/requirements/network_components.svg)

#### SEE ALSO
**CSP (Cloud Service Provider) Networking Guides:**

| CSP       | DNS Management                                                                             | Certificate Management                                                                              | Load Balancer                                                                                                                |
|-----------|--------------------------------------------------------------------------------------------|-----------------------------------------------------------------------------------------------------|------------------------------------------------------------------------------------------------------------------------------|
| **AWS**   | [Route 53 for DNS](https://docs.aws.amazon.com/Route53/latest/DeveloperGuide/Welcome.html) | [AWS Certificate Manager](https://docs.aws.amazon.com/acm/latest/userguide/gs.html)                 | [ELB Certificate Management](https://docs.aws.amazon.com/elasticloadbalancing/latest/application/create-https-listener.html) |
| **Azure** | [Azure DNS](https://learn.microsoft.com/en-us/azure/dns/dns-overview)                      | [Azure Certificates](https://learn.microsoft.com/en-us/azure/app-service/configure-ssl-certificate) | [Application Gateway SSL](https://learn.microsoft.com/en-us/azure/application-gateway/ssl-overview)                          |
| **GCP**   | [Cloud DNS](https://docs.cloud.google.com/dns/docs/overview)                               | [Certificate Manager](https://docs.cloud.google.com/certificate-manager/docs/overview)              | [Load Balancer SSL](https://cloud.google.com/load-balancing/docs/ssl-certificates)                                           |
