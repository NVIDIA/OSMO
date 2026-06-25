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

<a id="authentication-authorization"></a>

# AuthN/AuthZ

This section provides comprehensive information about authentication and authorization in OSMO, including how to configure identity providers, manage roles, and control access to resources.

## Overview

OSMO provides a flexible authentication and authorization system that supports authentication through Keycloak (with an optional external IdP), and flexible authorization through role-based access control (RBAC).

It can be configured a few different ways:

**1. No Authentication (Development Only)**
: Deploy OSMO without authentication for testing and development purposes. Not recommended for production.

**2. Keycloak**
: Use Keycloak to manage users and allow login directly through Keycloak.
  Use keycloak to control RBAC permissions by maintaining a mapping of users to groups and groups to roles.

**3. Keycloak with External Identity Provider**
: Use Keycloak as an identity broker that integrates with your organization’s identity provider (Azure AD, Google Workspace, etc.).
  Use keycloak to control RBAC permissions by maintaining a mapping of users to groups and groups to roles.
  This is recommended for production deployments.

## Major concepts

There are a few concepts that are important to understand when configuring authentication and authorization in OSMO:

- **User:** A human user or service account that accesses OSMO by logging in through Keycloak. Users can be added manually through Keycloak, or automatically when they log in through an external identity provider.
- **Action:** A specific action that a user might attempt to perform in OSMO (e.g., an HTTP method and path like `GET /api/workflows`, submitting workflows to a specific pool, etc.).
- **Policy:** A list of actions and whether they are allowed or denied.
- **Role:** A collection of policies that grant access to specific API endpoints and resources. If a user has a specific role, they are granted access to the actions in the policies of the role.
- **Group:** A group of users maintained in Keycloak. Groups can be assigned roles, and all users in the group inherit the roles of the group.

The below diagram illustrates how these concepts are all related when a user tries to perform an action in OSMO.

<style>
    .authz-flow {
        text-align: center;
        margin: 0.5em 0;
        padding: 0.8em;
        background: #2d2d2d;
        border: 2px solid #76B900;
        border-radius: 8px;
    }

    /\* Light mode overrides - system preference \*/
    @media (prefers-color-scheme: light) {
        .authz-flow {
            background: white;
        }
    }

    /\* Light mode overrides - theme toggle \*/
    [data-theme="light"] .authz-flow,
    html[data-theme="light"] .authz-flow,
    body[data-theme="light"] .authz-flow,
    .theme-light .authz-flow {
        background: white;
    }

    /\* Dark mode overrides - theme toggle (explicit) \*/
    [data-theme="dark"] .authz-flow,
    html[data-theme="dark"] .authz-flow,
    body[data-theme="dark"] .authz-flow,
    .theme-dark .authz-flow {
        background: #2d2d2d;
    }

    .authz-step {
        background: rgba(118, 185, 0, 0.1);
        border: 2px solid #76B900;
        padding: 0.4em 0.6em;
        border-radius: 6px;
        margin: 0.3em auto;
        max-width: 450px;
        box-shadow: 0 2px 4px rgba(118, 185, 0, 0.2);
        opacity: 0;
        animation: fadeInUp 0.6s ease-out forwards;
    }

    .authz-step.step1 { animation-delay: 0.1s; }
    .authz-step.step2 { animation-delay: 0.3s; }
    .authz-step.step3 { animation-delay: 0.5s; }
    .authz-step.step4 { animation-delay: 0.7s; }
    .authz-step.step5 { animation-delay: 0.9s; }
    .authz-step.step6 { animation-delay: 1.1s; }

    .authz-section {
        border: 2px dashed rgba(118, 185, 0, 0.5);
        border-radius: 6px;
        padding: 0.5em 0.6em 0.3em 0.6em;
        margin: 0.3em auto;
        max-width: 500px;
        position: relative;
        opacity: 0;
        animation: fadeIn 0.8s ease-out forwards;
    }

    .authz-section.keycloak { animation-delay: 0.2s; }
    .authz-section.osmo { animation-delay: 0.6s; }

    .authz-section-label {
        position: absolute;
        top: -0.6em;
        left: 1em;
        background: #2d2d2d;
        padding: 0.1em 0.6em;
        border-radius: 4px;
        font-weight: bold;
        color: #76B900;
        font-size: 0.85em;
    }

    /\* Light mode section labels \*/
    @media (prefers-color-scheme: light) {
        .authz-section-label {
            background: white;
        }
    }

    [data-theme="light"] .authz-section-label,
    html[data-theme="light"] .authz-section-label,
    body[data-theme="light"] .authz-section-label,
    .theme-light .authz-section-label {
        background: white;
    }

    [data-theme="dark"] .authz-section-label,
    html[data-theme="dark"] .authz-section-label,
    body[data-theme="dark"] .authz-section-label,
    .theme-dark .authz-section-label {
        background: #2d2d2d;
    }

    .step-number {
        display: inline-block;
        background: #76B900;
        color: #1a1a1a;
        width: 1.5em;
        height: 1.5em;
        line-height: 1.5em;
        border-radius: 50%;
        margin-right: 0.4em;
        font-weight: bold;
        font-size: 0.85em;
    }

    .step-text {
        font-size: 0.9em;
    }

    .authz-arrow {
        text-align: center;
        color: #76B900;
        font-size: 1.2em;
        margin: 0;
        opacity: 0;
        animation: fadeIn 0.4s ease-out forwards;
    }

    .authz-arrow.a1 { animation-delay: 0.2s; }
    .authz-arrow.a2 { animation-delay: 0.4s; }
    .authz-arrow.a3 { animation-delay: 0.6s; }
    .authz-arrow.a4 { animation-delay: 0.8s; }
    .authz-arrow.a5 { animation-delay: 1.0s; }

    .arrow-with-label {
        text-align: center;
        margin: 0.2em 0;
        opacity: 0;
        animation: fadeIn 0.4s ease-out forwards;
        animation-delay: 0.6s;
    }

    .arrow-label {
        display: inline-block;
        background: rgba(118, 185, 0, 0.2);
        border: 1px solid #76B900;
        color: #76B900;
        padding: 0.2em 0.6em;
        border-radius: 4px;
        font-size: 0.75em;
        font-weight: bold;
        margin-bottom: 0.1em;
    }

    @keyframes fadeInUp {
        from {
            opacity: 0;
            transform: translateY(20px);
        }
        to {
            opacity: 1;
            transform: translateY(0);
        }
    }

    @keyframes fadeIn {
        from { opacity: 0; }
        to { opacity: 1; }
    }
</style>

<div class="authz-flow">
    <div class="authz-step step1">
        <span class="step-number">1</span>
        <span class="step-text">A <strong>USER</strong> attempts to perform an <strong>ACTION</strong> in OSMO</span>
    </div>

    <div class="authz-arrow a1">↓</div>

    <div class="authz-section keycloak">
        <div class="authz-section-label">KEYCLOAK</div>
        <div class="authz-step step2">
            <span class="step-number">2</span>
            <span class="step-text">Get all <strong>GROUPS</strong> the <strong>USER</strong> is in</span>
        </div>
        <div class="authz-arrow a2">↓</div>
        <div class="authz-step step3">
            <span class="step-number">3</span>
            <span class="step-text">Get all <strong>ROLES</strong> that those <strong>GROUPS</strong> have</span>
        </div>
    </div>

    <div class="arrow-with-label">
        <div class="arrow-label">ROLES in JWT</div>
        <div style="color: #76B900; font-size: 1.2em;">↓</div>
    </div>

    <div class="authz-section osmo">
        <div class="authz-section-label">OSMO</div>
        <div class="authz-step step4">
            <span class="step-number">4</span>
            <span class="step-text">Get all <strong>POLICIES</strong> that those <strong>ROLES</strong> have</span>
        </div>
        <div class="authz-arrow a4">↓</div>
        <div class="authz-step step5">
            <span class="step-number">5</span>
            <span class="step-text">Check if any <strong>POLICY</strong> allows the <strong>ACTION</strong></span>
        </div>
    </div>

    <div class="authz-arrow a5">↓</div>

    <div class="authz-step step6">
        <span class="step-text"><strong>Allow</strong> or <strong>Deny ACTION</strong></span>
    </div>
</div>

## Quick Navigation

- **Setting up authentication?** → Start with [Authentication Flow](authentication_flow.md)
- **Managing roles and permissions?** → See [Roles and Policies](roles_policies.md)
- **Configuring Keycloak roles and groups?** → Follow [Keycloak Group and Role Management](keycloak_setup.md)

#### SEE ALSO
- [Deploy Service](../../getting_started/deploy_service.md) for service deployment with authentication
- [Create Resource Pools](../../install_backend/configure_pool.md) for pool configuration
- [/api/configs/role](../../references/configs_definitions/roles.md#roles-config) for role configuration reference
