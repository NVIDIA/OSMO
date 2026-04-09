"""
SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.  # pylint: disable=line-too-long

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

try:
    import termios
    import tty
    _HAS_TERMIOS = True
except ImportError:
    _HAS_TERMIOS = False

from src.lib.utils import client, client_configs

logger = logging.getLogger(__name__)

SKILL_PACKAGE_NAME = "osmo-agent"
SKILLS_REGISTRY_PACKAGE = "nvidia/osmo"
DECLINE_MARKER_FILE = "agent_skill_declined"


@dataclasses.dataclass
class AgentDirectory:
    """Represents a detected AI agent's skill directory."""
    name: str
    config_directory: Path
    skill_directory: Path


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
        ),
    ]


def detect_agents() -> list[AgentDirectory]:
    """Return agents whose config_directory exists on disk."""
    return [agent for agent in _get_known_agents() if agent.config_directory.is_dir()]


def is_skill_installed(agent_directory: AgentDirectory) -> bool:
    """Check if osmo-agent skill is installed globally or in the current project."""
    global_path = agent_directory.skill_directory / SKILL_PACKAGE_NAME / "SKILL.md"
    if global_path.exists():
        return True
    # Check project-scope: <cwd>/<agent_config_dir_name>/skills/
    project_skills = Path.cwd() / agent_directory.config_directory.name / "skills"
    return (project_skills / SKILL_PACKAGE_NAME / "SKILL.md").exists()


def find_npx() -> str | None:
    """Find npx on PATH."""
    return shutil.which("npx")


def _is_prompt_declined() -> bool:
    """Check if user previously declined the agent skill installation prompt."""
    config_directory = Path(client_configs.get_client_config_dir(create=False))
    return (config_directory / DECLINE_MARKER_FILE).exists()


def _save_prompt_declined() -> None:
    """Persist user's decision to decline agent skill installation."""
    config_directory = Path(client_configs.get_client_config_dir(create=True))
    (config_directory / DECLINE_MARKER_FILE).touch()


def _read_key() -> str:
    """Returns arrow keys as 'up'/'down', enter as 'enter', others as the character."""
    file_descriptor = sys.stdin.fileno()
    old_settings = termios.tcgetattr(file_descriptor)
    try:
        tty.setraw(file_descriptor)
        char = sys.stdin.read(1)
        if char == "\x1b":
            seq = sys.stdin.read(2)
            if seq == "[A":
                return "up"
            if seq == "[B":
                return "down"
            return "escape"
        if char in ("\r", "\n"):
            return "enter"
        return char
    finally:
        termios.tcsetattr(file_descriptor, termios.TCSADRAIN, old_settings)


def _interactive_select(options: list[str], default: int = 0) -> int:
    """Arrow-key menu selector. Returns the selected index."""
    selected = default
    total = len(options)

    def render():
        for i, option in enumerate(options):
            sys.stdout.write("\033[2K")  # Clear line to prevent ghosting
            if i == selected:
                sys.stdout.write(f"  \033[36m>\033[0m \033[1m{option}\033[0m\n")
            else:
                sys.stdout.write(f"    {option}\n")
        sys.stdout.flush()

    sys.stdout.write("\033[?25l")  # Hide cursor
    try:
        render()
        while True:
            key = _read_key()
            if key == "up":
                selected = (selected - 1) % total
            elif key == "down":
                selected = (selected + 1) % total
            elif key == "enter":
                break
            sys.stdout.write(f"\033[{total}A")  # Move cursor up to redraw
            render()
    finally:
        sys.stdout.write("\033[?25h")  # Restore cursor visibility
        sys.stdout.flush()

    return selected


INSTALL_YES = 0
INSTALL_NOT_NOW = 1
INSTALL_NEVER = 2


def _prompt_install_choice() -> int:
    """Three-choice install prompt. Falls back to text input if termios unavailable."""
    options = [
        "Yes, install now",
        "Not now",
        "Don't ask again",
    ]
    if _HAS_TERMIOS:
        return _interactive_select(options, default=INSTALL_YES)
    # Fallback for non-Unix (no arrow key support)
    for i, option in enumerate(options):
        print(f"  {i + 1}. {option}")
    while True:
        value = input("Choose [1/2/3]: ").strip()
        if value in ("1", ""):
            return INSTALL_YES
        if value == "2":
            return INSTALL_NOT_NOW
        if value == "3":
            return INSTALL_NEVER
        print("Invalid input")


def _print_npx_install_instructions() -> None:
    """Print platform-specific instructions to install Node.js/npx."""
    print("\nnpx not found. Install Node.js to continue:\n")
    if shutil.which("brew"):
        print("  brew install node\n")
    else:
        print("  https://nodejs.org/en/download\n")
    print("Then run:\n")
    print("  osmo skills install\n")


def is_interactive_terminal() -> bool:
    """Return True if stdin and stdout are connected to a TTY."""
    return sys.stdin.isatty() and sys.stdout.isatty()


def prompt_skill_installation() -> None:
    """Prompt user to install the osmo-agent skill for detected AI coding agents.

    Silently returns if: not a TTY, no agents detected, skill already
    installed in any agent, or user previously chose "Don't ask again".
    """
    if not is_interactive_terminal():
        logger.debug("Skipping agent skill prompt: not interactive")
        return

    agent_lines = []
    for known in _get_known_agents():
        exists = known.config_directory.is_dir()
        agent_lines.append(f"  {known.name:<15} {known.config_directory}  exists={exists}")
    logger.debug("Agent detection:\n%s", "\n".join(agent_lines))

    agents = detect_agents()
    if not agents:
        logger.debug("Skipping agent skill prompt: no agents detected")
        return

    skill_lines = []
    for agent in agents:
        global_path = agent.skill_directory / SKILL_PACKAGE_NAME / "SKILL.md"
        project_dir = agent.config_directory.name
        project_path = Path.cwd() / project_dir / "skills" / SKILL_PACKAGE_NAME / "SKILL.md"
        global_exists = str(global_path.exists())
        project_exists = str(project_path.exists())
        skill_lines.append(
            f"  {agent.name:<15} global={global_exists:<5}  {global_path}\n"
            f"  {'':<15} project={project_exists:<5} {project_path}"
        )
    logger.debug("Skill detection:\n%s", "\n".join(skill_lines))

    if any(is_skill_installed(a) for a in agents):
        logger.debug("Skipping agent skill prompt: skill already installed")
        return

    if _is_prompt_declined():
        logger.debug("Skipping agent skill prompt: user previously declined")
        return

    print("\nAI Agent Integration")
    _run_interactive_install(agents)


def setup_parser(parser: argparse._SubParsersAction) -> None:
    """Register the skills command with install/uninstall subcommands."""
    skills_parser = parser.add_parser(
        "skills",
        help="Manage AI agent skill installation for OSMO.",
    )
    skills_subparsers = skills_parser.add_subparsers(dest="skills_command")

    install_parser = skills_subparsers.add_parser(
        "install", help="Install the OSMO agent skill.",
    )
    install_parser.add_argument(
        "--prompt", action="store_true",
        help="Show interactive confirmation menu before installing.",
    )
    install_parser.add_argument(
        "-y", "--yes", action="store_true",
        help="Skip npx confirmation prompts.",
    )
    install_parser.add_argument(
        "-g", "--global", dest="global_scope", action="store_true",
        help="Install globally instead of project-level.",
    )
    install_parser.add_argument(
        "-a", "--agent", nargs="+", metavar="AGENT",
        help="Specify agents to install to (e.g. claude-code cursor).",
    )
    install_parser.add_argument(
        "--copy", action="store_true",
        help="Copy files instead of symlinking.",
    )
    install_parser.set_defaults(func=_install_command)

    uninstall_parser = skills_subparsers.add_parser(
        "uninstall", help="Uninstall the OSMO agent skill.",
    )
    uninstall_parser.add_argument(
        "-y", "--yes", action="store_true",
        help="Skip npx confirmation prompts.",
    )
    uninstall_parser.add_argument(
        "-g", "--global", dest="global_scope", action="store_true",
        help="Remove from global scope.",
    )
    uninstall_parser.add_argument(
        "-a", "--agent", nargs="+", metavar="AGENT",
        help="Remove from specific agents.",
    )
    uninstall_parser.set_defaults(func=_uninstall_command)


def _run_interactive_install(agents: list[AgentDirectory] | None = None) -> None:
    """Shared install flow: show banner, 3-choice menu, run npx interactively."""
    if agents is None:
        agents = detect_agents()
    if agents:
        agent_names = ", ".join(a.name for a in agents)
        print(f"\nDetected AI coding agents: {agent_names}\n")

    print("This enables natural language commands like:")
    print("  \"Check available GPU resources\"")
    print("  \"Submit a training workflow\"")
    print("  \"Show me my recent workflow logs\"\n")

    choice = _prompt_install_choice()
    if choice in (INSTALL_NEVER, INSTALL_NOT_NOW):
        if choice == INSTALL_NEVER:
            _save_prompt_declined()
        print("\nTo install later: osmo skills install\n")
        return

    npx_path = find_npx()
    if npx_path is None:
        _print_npx_install_instructions()
        return

    print()
    _run_npx_install(npx_path)


def _run_npx_command(
    command: list[str],
    success_message: str,
    failure_hint: str,
) -> bool:
    """Run an npx command, print result, return True on success."""
    try:
        result = subprocess.run(command, timeout=120, check=False)
        if result.returncode == 0:
            print(f"\n{success_message}\n")
            return True
        print(f"\n{failure_hint}\n")
        return False
    except (OSError, subprocess.TimeoutExpired) as error:
        logger.warning("npx command failed: %s", error)
        print(f"\n{failure_hint}\n")
        return False


def _run_npx_install(npx_path: str, extra_flags: list[str] | None = None) -> bool:
    """Run npx skills add and print result."""
    command = [npx_path, "skills", "add", SKILLS_REGISTRY_PACKAGE]
    if extra_flags:
        command.extend(extra_flags)
    success = _run_npx_command(
        command,
        success_message="Done! Restart your AI agent or start a new conversation.\n\n"
                        "To remove: osmo skills uninstall",
        failure_hint="Installation failed. Try again with: osmo skills install",
    )
    return success


def _build_npx_flags(args: argparse.Namespace) -> list[str]:
    """Build npx flags from parsed CLI arguments."""
    flags = []
    if getattr(args, "yes", False):
        flags.append("--yes")
    if getattr(args, "global_scope", False):
        flags.append("--global")
    if getattr(args, "copy", False):
        flags.append("--copy")
    agent_list = getattr(args, "agent", None)
    if agent_list and isinstance(agent_list, list):
        flags.extend(["--agent"] + agent_list)
    return flags


def _install_command(
    service_client: client.ServiceClient,  # pylint: disable=unused-argument
    args: argparse.Namespace,
) -> None:
    """Handler for 'osmo skills install'. With --prompt, shows 3-choice menu first."""
    if args.prompt:
        prompt_skill_installation()
        return

    npx_path = find_npx()
    if npx_path is None:
        _print_npx_install_instructions()
        return

    _run_npx_install(npx_path, extra_flags=_build_npx_flags(args))


def _uninstall_command(
    service_client: client.ServiceClient,  # pylint: disable=unused-argument
    args: argparse.Namespace,
) -> None:
    """Handler for 'osmo skills uninstall'."""
    npx_path = find_npx()
    if npx_path is None:
        print("npx not found. To uninstall manually:")
        print(f"  npx skills remove {SKILL_PACKAGE_NAME}\n")
        return

    npx_flags = _build_npx_flags(args)
    command = [npx_path, "skills", "remove", SKILL_PACKAGE_NAME] + npx_flags
    _run_npx_command(
        command,
        success_message="Agent skill removed.",
        failure_hint=f"Removal failed. Try manually: npx skills remove {SKILL_PACKAGE_NAME}",
    )
