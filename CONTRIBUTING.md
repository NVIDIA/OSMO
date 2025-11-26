# Contributing to OSMO

If you are interested in contributing to OSMO, your contributions will fall into three categories:

1. You want to report a bug, feature request, or documentation issue
   - File an [issue](https://github.com/NVIDIA/OSMO/issues/new/choose) describing what you
     encountered or what you want to see changed.
   - The OSMO team will evaluate the issues and triage them, scheduling them for a release. If you
     believe the issue needs priority attention comment on the issue to notify the team.
2. You want to propose a new Feature and implement it
   - Post about your intended feature, and we shall discuss the design and implementation.
   - Once we agree that the plan looks good, go ahead and implement it, using the
     [code contributions](#code-contributions) guide below.
3. You want to implement a feature or bug-fix for an
   [outstanding issue](https://github.com/NVIDIA/OSMO/issues)
   - Follow the [code contributions](#code-contributions) guide below.
   - If you need more context on a particular issue, please ask and we shall provide.

## Code Contributions

### System Requirements

- Ubuntu 22.04+ (x86_64)
- MacOS (arm64)

### Install Prerequisites

- **[Git LFS](https://git-lfs.com/)** - Source control for large files (>=3.7.1)
- **[Bazel](https://bazel.build/install/bazelisk)** - Build tool (>=8.1.1)
- **[Docker](https://docs.docker.com/get-started/get-docker/)** - Container runtime (>=28.3.2)
- **[Helm](https://helm.sh/docs/intro/install/)** - Package manager for Kubernetes (>=3.17.1)
- **[KIND](https://kind.sigs.k8s.io/docs/user/quick-start/#installation)** - Kubernetes in Docker
  (>=0.29.0)
- **[kubectl](https://kubernetes.io/docs/tasks/tools/)** - Kubernetes command-line tool (>=1.32.2)
- **[aws-cli](https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html)** - AWS
  command-line tool (>=2.24.7)
- **[npm](https://docs.npmjs.com/downloading-and-installing-node-js-and-npm)** - Package manager for
  Node.js (>=11.6.2)

### Fork the Repository

1. [Fork](https://help.github.com/en/articles/fork-a-repo) the
   [NVIDIA/OSMO repository](https://github.com/NVIDIA/OSMO)
2. Clone the forked repository:

```bash
git clone https://github.com/YOUR_USERNAME/YOUR_FORK.git osmo
```

### Develop

As you develop your fix or feature, follow this workflow:

1. **Iterate on your changes** - Follow the [Dev Guide](DEV.md) to develop and test your changes
   following [coding guidelines](#coding-guidelines)
2. **Build and test container images** - Follow the [Build and Test Guide](BUILD_AND_TEST.md) to
   create containers with your changes and validate that they work
3. **Test your changes** - Add or update any unit or functional tests for coverage over your changes
4. **Open a pull request** - Follow [Pull Requests](#pull-requests) to propose a change to be merged
   into OSMO

### Coding Guidelines

- Follow the existing conventions in the relevant file, submodule, module, and project when you add
  new code or when you extend/fix existing functionality
- Avoid introducing unnecessary complexity into existing code so that maintainability and
  readability are preserved
- Avoid committing commented-out code
- Write commit titles using imperative mood and
  [these rules](https://chris.beams.io/posts/git-commit/), and reference the Issue number
  corresponding to the PR. Following is the format for commit texts:

```
#<Issue Number> - <Commit Title>

<Commit Body>
```

- Make sure that you can contribute your work to open source (no license and/or patent conflict is
  introduced by your code)

### Pull Requests

1. Push your changes to your fork:

```bash
git push origin <local-branch>
```

2. [Create a Pull Request](https://help.github.com/en/articles/creating-a-pull-request-from-a-fork)
   (PR) to merge the changes from the branch of your fork into the `main` branch of the
   `NVIDIA/OSMO` repository
   - Try to keep PRs as concise as possible and address a single concern. Consider multiple PRs if
     you need to address multiple concerns.
   - Exercise caution when selecting the source and target branches for the PR.
   - Creation of a PR kicks off the code review process.
3. Your PR will be reviewed by the OSMO engineering team:
   - The OSMO engineering team will automatically be assigned for the review.
   - Two OSMO engineers must approve your PR before it can be merged.
   - [Status Checks](https://help.github.com/en/articles/about-status-checks) will be manually
     triggered by an OSMO engineer and must pass before the PR can be merged.
   - Merge conflicts must be resolved before the PR can be merged.
4. [Merge your PR](https://help.github.com/en/articles/merging-a-pull-request)!

Your changes will be included in the next release of OSMO.

### Developer Certificate of Origin

All contributions are made according to the Developer Certificate of Origin:

```
  Developer Certificate of Origin
  Version 1.1

  Copyright (C) 2004, 2006 The Linux Foundation and its contributors.
  1 Letterman Drive
  Suite D4700
  San Francisco, CA, 94129

  Everyone is permitted to copy and distribute verbatim copies of this license document, but changing it is not allowed.

  Developer's Certificate of Origin 1.1

  By making a contribution to this project, I certify that:

  (a) The contribution was created in whole or in part by me and I have the right to submit it under the open source license indicated in the file; or

  (b) The contribution is based upon previous work that, to the best of my knowledge, is covered under an appropriate open source license and I have the right under that license to submit that work with modifications, whether created in whole or in part by me, under the same open source license (unless I am permitted to submit under a different license), as indicated in the file; or

  (c) The contribution was provided directly to me by some other person who certified (a), (b) or (c) and I have not modified it.

  (d) I understand and agree that this project and the contribution are public and that a record of the contribution (including all personal information I submit with it, including my sign-off) is maintained indefinitely and may be redistributed consistent with this project or the open source license(s) involved.
```
