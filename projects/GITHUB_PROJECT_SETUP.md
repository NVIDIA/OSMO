<!--
SPDX-FileCopyrightText: Copyright (c) 2025 NVIDIA CORPORATION. All rights reserved.

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
-->

# GitHub Project Setup: Projects

This document provides step-by-step instructions for setting up the **Projects** GitHub Project board to track project proposals.

## Overview

The Projects board provides visibility into all project proposals and their current status. It automatically includes issues with the `project-proposal` label and provides table and board views for tracking progress.

## Setup Steps

### 1. Create the Project

1. Navigate to the repository on GitHub.
2. Click the **Projects** tab.
3. Click **New project**.
4. Choose **Board** as the template (you can customize it later).
5. Name the project **Projects** or **Projects and Proposals**.
6. Click **Create project**.

### 2. Configure Automatic Issue Inclusion

Set up the project to automatically include issues with the `project-proposal` label:

1. In the project, click the **⋯** (three dots) menu in the top-right.
2. Select **Workflows**.
3. Enable the **Auto-add to project** workflow:
   - Click **Edit** next to "Item added to project".
   - Set the filter to: `is:issue label:project-proposal`
   - This will automatically add any issue with the `project-proposal` label to the project.
4. Save the workflow.

### 3. Add Custom Fields

Add custom fields to track proposal status and ownership:

#### Field 1: Stage

1. In the project, click **+ New field** (or the **+** icon in the table header).
2. Name the field **Stage**.
3. Choose **Single select** as the field type.
4. Add the following options (in order):
   - Idea
   - Proposed
   - In Review
   - Accepted
   - In Development
   - Shipped
   - Rejected
5. Set **Proposed** as the default value.
6. Save the field.

#### Field 2: PIC (Person in Charge)

1. Click **+ New field** again.
2. Name the field **PIC**.
3. Choose **Text** as the field type (or **People** if you want to assign GitHub users).
4. Save the field.

### 4. Create Views

#### View 1: Table View

This view provides a detailed list of all proposals.

1. The default view is usually a table. If not, click **+ New view** → **Table**.
2. Name the view **All Proposals** or **Table**.
3. Set the filter to: `is:issue label:project-proposal`
4. Configure the visible columns:
   - **Title** (always visible)
   - **Stage** (custom field)
   - **Status** (Open/Closed)
   - **Labels**
   - **Assignees**
   - **Milestone**
   - **Linked PRs**
   - **PIC** (custom field)
5. You can reorder columns by dragging them.
6. Save the view.

#### View 2: Board View

This view groups proposals by stage for easy visualization.

1. Click **+ New view** → **Board**.
2. Name the view **Board** or **By Stage**.
3. Set the filter to: `is:issue label:project-proposal`
4. Choose **Group by: Stage** (the custom field you created).
5. The board will now show columns for each stage: Idea, Proposed, In Review, Accepted, In Development, Shipped, Rejected.
6. Save the view.

### 5. Set Default View

1. Go to the view you want as the default (usually the Table view).
2. Click the **⋯** (three dots) menu in the top-right.
3. Select **Set as default**.

### 6. Configure Project Visibility

1. Ensure the project is **visible** to all contributors.
2. In the project settings (click the **⋯** menu → **Settings**), set the visibility to **Public** (if the repository is public) or appropriate for your organization.

## Usage Conventions

Once the project is set up, follow these conventions:

### New Proposals

- When a new project proposal issue is created with the `project-proposal` label, it will automatically be added to the project.
- The **Stage** field defaults to **Proposed**.
- The proposal author should specify a **PIC** (Person in Charge) in the issue.

### Moving Through Stages

**Note: Only OSMO team members can update the Stage field.** This ensures proper governance and tracking of proposals.

Update the **Stage** field as the proposal progresses:

- **Idea** → Early exploration, not yet a formal proposal (optional stage).
- **Proposed** → Formal proposal opened, under initial review.
- **In Review** → Actively being reviewed and refined.
- **Accepted** → Proposal is accepted; project design may be in progress.
- **In Development** → Implementation is underway.
- **Shipped** → Project is complete and released.
- **Rejected** → Proposal was declined.

### Closing Issues

- When a proposal is **Shipped** or **Rejected**, update the Stage field and close the issue.
- Closed issues remain visible in the project for historical tracking.

## Tips

- **Use filters** – Create additional views with custom filters (e.g., `Stage:In Development` to see only active projects).
- **Add milestones** – Link proposals to GitHub milestones for release planning.
- **Link PRs** – GitHub automatically links PRs that reference the proposal issue (e.g., "Closes #123").
- **Sort and group** – Use sorting and grouping options in the table view to organize proposals by priority, impact, or PIC.

## Maintenance

- **Review periodically** – Check for stale proposals in the "Proposed" or "In Review" stages and follow up.
- **Archive old projects** – Consider archiving the project board and creating a new one annually if it becomes too large.
- **Update workflows** – If the label changes, update the auto-add workflow filter accordingly.

## Troubleshooting

### Issues not appearing in the project

- Verify the issue has the `project-proposal` label.
- Check the auto-add workflow is enabled and configured correctly.
- Manually add the issue by clicking **+ Add item** in the project.

### Custom fields not showing

- Ensure you've created the custom fields as described above.
- Refresh the page or try a different browser.

### Unable to edit fields

- Ensure you have write access to the repository and project.
- Check that the field type is correct (single-select for Stage, text for PIC).
- Note: Only OSMO team members should be able to update the Stage field.

## Example Project

For reference, see how the Astro project manages their roadmap using GitHub Projects:

- [Astro Roadmap](https://github.com/withastro/roadmap)

While their process differs, the core principles of using GitHub Issues and Projects for async proposal tracking are similar.

## Questions?

If you encounter issues setting up the project board, consult the [GitHub Projects documentation](https://docs.github.com/en/issues/planning-and-tracking-with-projects) or reach out to a repository maintainer.
