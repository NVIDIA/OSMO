"""
SPDX-FileCopyrightText: Copyright (c) 2025-2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.

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
import dataclasses
import logging
import shutil
import subprocess
import sys
from pathlib import Path

from src.lib.utils import client, common

logger = logging.getLogger(__name__)

SKILL_PACKAGE_NAME = "osmo-agent"
SKILLS_REGISTRY_PACKAGE = "nvidia/osmo"


@dataclasses.dataclass
class AgentDirectory:
    """Represents a detected AI agent's skill directory."""
    name: str
    config_directory: Path
    skill_directory: Path
    is_universal: bool = False


def _get_known_agents() -> list[AgentDirectory]:
    """Build list of known AI agent directories. Called per-invocation, not at import time."""
    home = Path.home()
    return [
        AgentDirectory(
            name="Claude Code",
            config_directory=home / ".claude",
            skill_directory=home / ".claude" / "skills",
        ),
        AgentDirectory(
            name="Codex",
            config_directory=home / ".codex",
            skill_directory=home / ".codex" / "skills",
        ),
        AgentDirectory(
            name="Agent Skills",
            config_directory=home / ".agents",
            skill_directory=home / ".agents" / "skills",
            is_universal=True,
        ),
    ]


def detect_agents() -> list[AgentDirectory]:
    """Return agents whose config_directory exists on disk."""
    return [agent for agent in _get_known_agents() if agent.config_directory.is_dir()]


def is_skill_installed(agent_directory: AgentDirectory) -> bool:
    """Check if osmo-agent skill is installed in the given agent directory."""
    skill_path = agent_directory.skill_directory / SKILL_PACKAGE_NAME / "SKILL.md"
    return skill_path.exists()


def find_npx() -> str | None:
    """Find npx on PATH."""
    return shutil.which("npx")


def install_skill_via_registry(npx_path: str, timeout: int = 120) -> bool:
    """Install osmo-agent skill via skills.sh registry. Returns True on success."""
    try:
        result = subprocess.run(
            [npx_path, "skills", "add", SKILLS_REGISTRY_PACKAGE],
            capture_output=True,
            text=True,
            timeout=timeout,
        )
        if result.returncode != 0:
            logger.warning("skills add failed: %s", result.stderr)
            return False
        return True
    except (OSError, subprocess.TimeoutExpired) as error:
        logger.warning("Failed to run npx skills add: %s", error)
        return False


def _format_path(path: Path) -> str:
    """Format a path for display, using ~ for home directory when possible."""
    try:
        return f"~/{path.relative_to(Path.home())}"
    except ValueError:
        return str(path)


def install_symlinks(agents: list[AgentDirectory], universal_skill_path: Path) -> None:
    """Create symlinks from detected agent skill directories to the universal install path."""
    for agent in agents:
        target = agent.skill_directory / SKILL_PACKAGE_NAME
        if target.exists() or target.is_symlink():
            logger.info("  %s: already installed, skipping", agent.name)
            continue
        agent.skill_directory.mkdir(parents=True, exist_ok=True)
        target.symlink_to(universal_skill_path)
        print(f"  Symlinked {_format_path(target)} -> {_format_path(universal_skill_path)}")


def uninstall_skill(agents: list[AgentDirectory]) -> None:
    """Remove osmo-agent skill from all given agent directories."""
    for agent in agents:
        target = agent.skill_directory / SKILL_PACKAGE_NAME
        if target.is_symlink():
            target.unlink()
            print(f"  Removed {_format_path(target)} (symlink)")
        elif target.is_dir():
            shutil.rmtree(target)
            print(f"  Removed {_format_path(target)}")


def is_interactive_terminal() -> bool:
    """Return True if stdin and stdout are connected to a TTY."""
    return sys.stdin.isatty() and sys.stdout.isatty()


def _run_install(npx_path: str, agents: list[AgentDirectory], timeout: int = 120) -> None:
    """Shared install logic: registry install + symlink creation."""
    print("Installing osmo-agent skill via skills.sh registry...")
    if not install_skill_via_registry(npx_path, timeout=timeout):
        print("Installation failed. Try manually: npx skills add nvidia/osmo")
        return

    universal_skill_path = Path.home() / ".agents" / "skills" / SKILL_PACKAGE_NAME
    if universal_skill_path.is_dir():
        non_universal_agents = [a for a in agents if not a.is_universal]
        install_symlinks(non_universal_agents, universal_skill_path)

    print("\nDone! Restart your AI agent or start a new conversation to use the skill.")


def prompt_skill_installation() -> None:
    """Detect AI agents and prompt user to install osmo-agent skill.

    Silently returns if: not a TTY, no agents detected, skill already
    installed everywhere, or npx not found.
    """
    if not is_interactive_terminal():
        return

    agents = detect_agents()
    if not agents:
        return

    agents_needing_install = [a for a in agents if not is_skill_installed(a)]
    if not agents_needing_install:
        return

    npx_path = find_npx()
    if npx_path is None:
        print("\n  To install the OSMO agent skill for your AI coding agents, run:")
        print("    npm install -g skills && skills add nvidia/osmo\n")
        return

    agent_names = ", ".join(a.name for a in agents)
    print(f"\n   AI Agent Integration\n")
    print(f"   We detected AI coding agents on your system: {agent_names}")
    print("   Would you like to install the OSMO agent skill?\n")
    print('   This enables natural language commands like:')
    print('     "Check available GPU resources"')
    print('     "Submit a training workflow"')
    print('     "Show me my recent workflow logs"\n')

    if not common.prompt_user("Install?"):
        return

    _run_install(npx_path, agents_needing_install, timeout=30)


def setup_parser(parser: argparse._SubParsersAction) -> None:
    """Register the agent-skill command with install/uninstall/status subcommands."""
    agent_skill_parser = parser.add_parser(
        "agent-skill",
        help="Manage AI agent skill installation for OSMO.",
    )
    agent_skill_subparsers = agent_skill_parser.add_subparsers(dest="agent_skill_command")

    install_parser = agent_skill_subparsers.add_parser("install", help="Install the OSMO agent skill.")
    install_parser.add_argument("--force", action="store_true", help="Overwrite existing installation.")
    install_parser.set_defaults(func=_install_command)

    uninstall_parser = agent_skill_subparsers.add_parser("uninstall", help="Remove the OSMO agent skill.")
    uninstall_parser.set_defaults(func=_uninstall_command)

    status_parser = agent_skill_subparsers.add_parser("status", help="Show agent detection and skill install status.")
    status_parser.set_defaults(func=_status_command)


def _install_command(service_client: client.ServiceClient, args: argparse.Namespace) -> None:  # pylint: disable=unused-argument
    """Handler for 'osmo agent-skill install'."""
    agents = detect_agents()
    if not agents:
        print("No AI coding agents detected on this system.")
        print("Checked: ~/.claude, ~/.codex, ~/.agents")
        return

    if not args.force:
        agents_needing_install = [a for a in agents if not is_skill_installed(a)]
        if not agents_needing_install:
            print("OSMO agent skill is already installed in all detected agents.")
            return
    else:
        uninstall_skill(agents)
        agents_needing_install = agents

    npx_path = find_npx()
    if npx_path is None:
        print("npx not found. Install Node.js or run manually:")
        print("  npm install -g skills && skills add nvidia/osmo")
        return

    _run_install(npx_path, agents_needing_install)


def _uninstall_command(service_client: client.ServiceClient, args: argparse.Namespace) -> None:  # pylint: disable=unused-argument
    """Handler for 'osmo agent-skill uninstall'."""
    agents = detect_agents()
    installed = [a for a in agents if is_skill_installed(a)]
    if not installed:
        print("OSMO agent skill is not installed in any detected agent.")
        return

    print("Removing osmo-agent skill...")
    uninstall_skill(installed)
    print("Done!")


def _status_command(service_client: client.ServiceClient, args: argparse.Namespace) -> None:  # pylint: disable=unused-argument
    """Handler for 'osmo agent-skill status'."""
    agents = detect_agents()
    if not agents:
        print("No AI coding agents detected.")
        print("Checked: ~/.claude, ~/.codex, ~/.agents")
        return

    print("Detected agents:")
    for agent in agents:
        installed = is_skill_installed(agent)
        skill_path = agent.skill_directory / SKILL_PACKAGE_NAME
        if installed and skill_path.is_symlink():
            status = "installed (symlink)"
        elif installed:
            status = "installed"
        else:
            status = "not installed"
        print(f"  {agent.name:<15} ({_format_path(agent.config_directory)})  skill: {status}")

    npx_path = find_npx()
    print(f"\nnpx available: {'yes (' + npx_path + ')' if npx_path else 'no'}")
