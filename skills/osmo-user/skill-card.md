# OSMO User

- Purpose: end-user OSMO CLI operations; excludes service and Kubernetes administration.
- Source: [NVIDIA OSMO](https://github.com/NVIDIA/OSMO). Release owner: unassigned.
- License: [Apache-2.0](LICENSE).
- Requires: a shell-capable agent, OSMO CLI, authenticated profile, and authorized resources.
- Deployment: the user's configured OSMO and storage endpoints; geography approval unspecified.
- Outputs: CLI operations, workflow specs, summaries, links, and requested local files.
- Risks: resource consumption, data changes, and credential exposure. Follow the
  authorization and credential rules in [SKILL.md](SKILL.md).
- Version: source commit; unreleased and unsigned.
- Evaluation: [offline harness](evals/EVAL.md); paired agent benchmark pending.
