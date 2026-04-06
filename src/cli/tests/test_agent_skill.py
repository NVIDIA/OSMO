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
import subprocess
import sys
import unittest
from pathlib import Path
from unittest.mock import MagicMock, call, patch

from src.cli import agent_skill
from src.cli.agent_skill import AgentDirectory


def _make_agent(name="TestAgent", base="/home/user/.testagent", is_universal=False):
    """Helper: build an AgentDirectory with Path objects."""
    config_dir = Path(base)
    skill_dir = config_dir / "skills"
    return AgentDirectory(
        name=name,
        config_directory=config_dir,
        skill_directory=skill_dir,
        is_universal=is_universal,
    )


class TestAgentDirectory(unittest.TestCase):
    def test_dataclass_fields(self):
        agent = AgentDirectory(
            name="Claude Code",
            config_directory=Path("/home/user/.claude"),
            skill_directory=Path("/home/user/.claude/skills"),
        )
        self.assertEqual(agent.name, "Claude Code")
        self.assertEqual(agent.config_directory, Path("/home/user/.claude"))
        self.assertEqual(agent.skill_directory, Path("/home/user/.claude/skills"))
        self.assertFalse(agent.is_universal)

    def test_is_universal_default_false(self):
        agent = _make_agent()
        self.assertFalse(agent.is_universal)

    def test_is_universal_can_be_set(self):
        agent = _make_agent(is_universal=True)
        self.assertTrue(agent.is_universal)


class TestDetectAgents(unittest.TestCase):
    def test_no_agents_present(self):
        """detect_agents returns empty list when none of the config dirs exist."""
        with patch("src.cli.agent_skill.Path.home", return_value=Path("/home/testuser")):
            with patch.object(Path, "is_dir", return_value=False):
                result = agent_skill.detect_agents()
        self.assertEqual(result, [])

    def test_all_agents_present(self):
        """detect_agents returns all three agents when all config dirs exist."""
        with patch("src.cli.agent_skill.Path.home", return_value=Path("/home/testuser")):
            with patch.object(Path, "is_dir", return_value=True):
                result = agent_skill.detect_agents()
        self.assertEqual(len(result), 3)
        names = [a.name for a in result]
        self.assertIn("Claude Code", names)
        self.assertIn("Codex", names)
        self.assertIn("Agent Skills", names)

    def test_only_claude_present(self):
        """detect_agents returns only Claude Code when only ~/.claude exists."""
        home = Path("/home/testuser")

        def is_dir_side_effect(self_path):
            return str(self_path) == str(home / ".claude")

        with patch("src.cli.agent_skill.Path.home", return_value=home):
            with patch.object(Path, "is_dir", is_dir_side_effect):
                result = agent_skill.detect_agents()

        self.assertEqual(len(result), 1)
        self.assertEqual(result[0].name, "Claude Code")

    def test_universal_agent_is_flagged(self):
        """The Agent Skills entry has is_universal=True."""
        with patch("src.cli.agent_skill.Path.home", return_value=Path("/home/testuser")):
            with patch.object(Path, "is_dir", return_value=True):
                result = agent_skill.detect_agents()

        universal = [a for a in result if a.is_universal]
        self.assertEqual(len(universal), 1)
        self.assertEqual(universal[0].name, "Agent Skills")

    def test_config_directories_use_home(self):
        """Config directories are rooted in the home directory."""
        home = Path("/custom/home")
        with patch("src.cli.agent_skill.Path.home", return_value=home):
            with patch.object(Path, "is_dir", return_value=True):
                result = agent_skill.detect_agents()

        for agent in result:
            self.assertTrue(
                str(agent.config_directory).startswith(str(home)),
                f"Expected {agent.config_directory} to be under {home}",
            )


class TestIsSkillInstalled(unittest.TestCase):
    def test_skill_installed_when_skill_md_exists(self):
        agent = _make_agent()
        skill_md = agent.skill_directory / "osmo-agent" / "SKILL.md"
        with patch.object(Path, "exists", lambda p: p == skill_md):
            self.assertTrue(agent_skill.is_skill_installed(agent))

    def test_skill_not_installed_when_skill_md_missing(self):
        agent = _make_agent()
        with patch.object(Path, "exists", return_value=False):
            self.assertFalse(agent_skill.is_skill_installed(agent))

    def test_checks_correct_path(self):
        """is_skill_installed checks <skill_directory>/osmo-agent/SKILL.md."""
        agent = _make_agent(base="/home/user/.claude")
        expected_path = Path("/home/user/.claude/skills/osmo-agent/SKILL.md")
        checked_paths = []

        def recording_exists(p):
            checked_paths.append(p)
            return False

        with patch.object(Path, "exists", recording_exists):
            agent_skill.is_skill_installed(agent)

        self.assertIn(expected_path, checked_paths)


class TestFindNpx(unittest.TestCase):
    def test_returns_path_when_npx_found(self):
        with patch("src.cli.agent_skill.shutil.which", return_value="/usr/local/bin/npx"):
            result = agent_skill.find_npx()
        self.assertEqual(result, "/usr/local/bin/npx")

    def test_returns_none_when_npx_not_found(self):
        with patch("src.cli.agent_skill.shutil.which", return_value=None):
            result = agent_skill.find_npx()
        self.assertIsNone(result)

    def test_calls_which_with_npx(self):
        mock_which = MagicMock(return_value=None)
        with patch("src.cli.agent_skill.shutil.which", mock_which):
            agent_skill.find_npx()
        mock_which.assert_called_once_with("npx")


class TestInstallSkillViaRegistry(unittest.TestCase):
    def _make_completed_process(self, returncode=0, stderr=""):
        proc = MagicMock()
        proc.returncode = returncode
        proc.stderr = stderr
        return proc

    def test_returns_true_on_success(self):
        with patch(
            "src.cli.agent_skill.subprocess.run",
            return_value=self._make_completed_process(returncode=0),
        ):
            result = agent_skill.install_skill_via_registry("/usr/bin/npx")
        self.assertTrue(result)

    def test_returns_false_on_nonzero_returncode(self):
        with patch(
            "src.cli.agent_skill.subprocess.run",
            return_value=self._make_completed_process(returncode=1, stderr="error"),
        ):
            result = agent_skill.install_skill_via_registry("/usr/bin/npx")
        self.assertFalse(result)

    def test_returns_false_on_timeout(self):
        with patch(
            "src.cli.agent_skill.subprocess.run",
            side_effect=subprocess.TimeoutExpired(cmd="npx", timeout=120),
        ):
            result = agent_skill.install_skill_via_registry("/usr/bin/npx")
        self.assertFalse(result)

    def test_returns_false_on_os_error(self):
        with patch(
            "src.cli.agent_skill.subprocess.run",
            side_effect=OSError("file not found"),
        ):
            result = agent_skill.install_skill_via_registry("/usr/bin/npx")
        self.assertFalse(result)

    def test_calls_subprocess_with_correct_args(self):
        mock_run = MagicMock(return_value=self._make_completed_process())
        with patch("src.cli.agent_skill.subprocess.run", mock_run):
            agent_skill.install_skill_via_registry("/usr/local/bin/npx", timeout=60)

        mock_run.assert_called_once_with(
            ["/usr/local/bin/npx", "skills", "add", "nvidia/osmo"],
            capture_output=True,
            text=True,
            timeout=60,
        )

    def test_default_timeout_is_120(self):
        mock_run = MagicMock(return_value=self._make_completed_process())
        with patch("src.cli.agent_skill.subprocess.run", mock_run):
            agent_skill.install_skill_via_registry("/usr/bin/npx")

        _, kwargs = mock_run.call_args
        self.assertEqual(kwargs["timeout"], 120)


class TestInstallSymlinks(unittest.TestCase):
    def _make_agents(self):
        return [
            _make_agent("Claude Code", "/home/user/.claude"),
            _make_agent("Codex", "/home/user/.codex"),
        ]

    def test_creates_symlink_when_target_absent(self):
        agents = self._make_agents()
        universal = Path("/home/user/.agents/skills/osmo-agent")

        with patch.object(Path, "exists", return_value=False), \
             patch.object(Path, "is_symlink", return_value=False), \
             patch.object(Path, "mkdir") as mock_mkdir, \
             patch.object(Path, "symlink_to") as mock_symlink, \
             patch("builtins.print"):
            agent_skill.install_symlinks(agents, universal)

        self.assertEqual(mock_symlink.call_count, 2)
        for symlink_call in mock_symlink.call_args_list:
            self.assertEqual(symlink_call, call(universal))

    def test_skips_when_target_exists(self):
        agents = self._make_agents()
        universal = Path("/home/user/.agents/skills/osmo-agent")

        with patch.object(Path, "exists", return_value=True), \
             patch.object(Path, "is_symlink", return_value=False), \
             patch.object(Path, "symlink_to") as mock_symlink, \
             patch("builtins.print"):
            agent_skill.install_symlinks(agents, universal)

        mock_symlink.assert_not_called()

    def test_skips_when_target_is_symlink(self):
        agents = self._make_agents()
        universal = Path("/home/user/.agents/skills/osmo-agent")

        with patch.object(Path, "exists", return_value=False), \
             patch.object(Path, "is_symlink", return_value=True), \
             patch.object(Path, "symlink_to") as mock_symlink, \
             patch("builtins.print"):
            agent_skill.install_symlinks(agents, universal)

        mock_symlink.assert_not_called()

    def test_creates_parent_directory(self):
        agents = [_make_agent("Claude Code", "/home/user/.claude")]
        universal = Path("/home/user/.agents/skills/osmo-agent")

        with patch.object(Path, "exists", return_value=False), \
             patch.object(Path, "is_symlink", return_value=False), \
             patch.object(Path, "mkdir") as mock_mkdir, \
             patch.object(Path, "symlink_to"), \
             patch("builtins.print"):
            agent_skill.install_symlinks(agents, universal)

        mock_mkdir.assert_called_once_with(parents=True, exist_ok=True)


class TestUninstallSkill(unittest.TestCase):
    def test_removes_symlink(self):
        agents = [_make_agent("Claude Code", "/home/user/.claude")]

        with patch.object(Path, "is_symlink", return_value=True), \
             patch.object(Path, "unlink") as mock_unlink, \
             patch.object(Path, "is_dir", return_value=False), \
             patch("builtins.print"):
            agent_skill.uninstall_skill(agents)

        mock_unlink.assert_called_once()

    def test_removes_directory(self):
        agents = [_make_agent("Claude Code", "/home/user/.claude")]

        with patch.object(Path, "is_symlink", return_value=False), \
             patch.object(Path, "is_dir", return_value=True), \
             patch("src.cli.agent_skill.shutil.rmtree") as mock_rmtree, \
             patch("builtins.print"):
            agent_skill.uninstall_skill(agents)

        mock_rmtree.assert_called_once()

    def test_does_nothing_when_not_installed(self):
        agents = [_make_agent("Claude Code", "/home/user/.claude")]

        with patch.object(Path, "is_symlink", return_value=False), \
             patch.object(Path, "is_dir", return_value=False), \
             patch("src.cli.agent_skill.shutil.rmtree") as mock_rmtree, \
             patch.object(Path, "unlink") as mock_unlink, \
             patch("builtins.print"):
            agent_skill.uninstall_skill(agents)

        mock_rmtree.assert_not_called()
        mock_unlink.assert_not_called()

    def test_removes_all_agents(self):
        agents = [
            _make_agent("Claude Code", "/home/user/.claude"),
            _make_agent("Codex", "/home/user/.codex"),
        ]

        with patch.object(Path, "is_symlink", return_value=True), \
             patch.object(Path, "unlink") as mock_unlink, \
             patch.object(Path, "is_dir", return_value=False), \
             patch("builtins.print"):
            agent_skill.uninstall_skill(agents)

        self.assertEqual(mock_unlink.call_count, 2)


class TestIsInteractiveTerminal(unittest.TestCase):
    def test_returns_true_when_both_are_tty(self):
        with patch.object(sys.stdin, "isatty", return_value=True), \
             patch.object(sys.stdout, "isatty", return_value=True):
            self.assertTrue(agent_skill.is_interactive_terminal())

    def test_returns_false_when_stdin_not_tty(self):
        with patch.object(sys.stdin, "isatty", return_value=False), \
             patch.object(sys.stdout, "isatty", return_value=True):
            self.assertFalse(agent_skill.is_interactive_terminal())

    def test_returns_false_when_stdout_not_tty(self):
        with patch.object(sys.stdin, "isatty", return_value=True), \
             patch.object(sys.stdout, "isatty", return_value=False):
            self.assertFalse(agent_skill.is_interactive_terminal())

    def test_returns_false_when_neither_is_tty(self):
        with patch.object(sys.stdin, "isatty", return_value=False), \
             patch.object(sys.stdout, "isatty", return_value=False):
            self.assertFalse(agent_skill.is_interactive_terminal())


class TestPromptSkillInstallation(unittest.TestCase):
    def test_returns_early_when_not_tty(self):
        with patch("src.cli.agent_skill.is_interactive_terminal", return_value=False), \
             patch("src.cli.agent_skill.detect_agents") as mock_detect:
            agent_skill.prompt_skill_installation()
        mock_detect.assert_not_called()

    def test_returns_early_when_no_agents(self):
        with patch("src.cli.agent_skill.is_interactive_terminal", return_value=True), \
             patch("src.cli.agent_skill.detect_agents", return_value=[]), \
             patch("src.cli.agent_skill.find_npx") as mock_npx:
            agent_skill.prompt_skill_installation()
        mock_npx.assert_not_called()

    def test_returns_early_when_all_installed(self):
        agent = _make_agent()
        with patch("src.cli.agent_skill.is_interactive_terminal", return_value=True), \
             patch("src.cli.agent_skill.detect_agents", return_value=[agent]), \
             patch("src.cli.agent_skill.is_skill_installed", return_value=True), \
             patch("src.cli.agent_skill.find_npx") as mock_npx:
            agent_skill.prompt_skill_installation()
        mock_npx.assert_not_called()

    def test_prints_npm_hint_when_npx_missing(self):
        agent = _make_agent()
        with patch("src.cli.agent_skill.is_interactive_terminal", return_value=True), \
             patch("src.cli.agent_skill.detect_agents", return_value=[agent]), \
             patch("src.cli.agent_skill.is_skill_installed", return_value=False), \
             patch("src.cli.agent_skill.find_npx", return_value=None), \
             patch("builtins.print") as mock_print:
            agent_skill.prompt_skill_installation()

        printed = " ".join(str(c) for c in mock_print.call_args_list)
        self.assertIn("npm", printed)

    def test_does_not_install_when_user_declines(self):
        agent = _make_agent()
        with patch("src.cli.agent_skill.is_interactive_terminal", return_value=True), \
             patch("src.cli.agent_skill.detect_agents", return_value=[agent]), \
             patch("src.cli.agent_skill.is_skill_installed", return_value=False), \
             patch("src.cli.agent_skill.find_npx", return_value="/usr/bin/npx"), \
             patch("src.cli.agent_skill.common.prompt_user", return_value=False), \
             patch("src.cli.agent_skill.install_skill_via_registry") as mock_install, \
             patch("builtins.print"):
            agent_skill.prompt_skill_installation()

        mock_install.assert_not_called()

    def test_installs_when_user_accepts(self):
        agent = _make_agent()
        with patch("src.cli.agent_skill.is_interactive_terminal", return_value=True), \
             patch("src.cli.agent_skill.detect_agents", return_value=[agent]), \
             patch("src.cli.agent_skill.is_skill_installed", return_value=False), \
             patch("src.cli.agent_skill.find_npx", return_value="/usr/bin/npx"), \
             patch("src.cli.agent_skill.common.prompt_user", return_value=True), \
             patch("src.cli.agent_skill.install_skill_via_registry", return_value=True) as mock_install, \
             patch.object(Path, "is_dir", return_value=False), \
             patch("builtins.print"):
            agent_skill.prompt_skill_installation()

        mock_install.assert_called_once()


class TestInstallCommand(unittest.TestCase):
    def _make_args(self, force=False):
        args = argparse.Namespace()
        args.force = force
        return args

    def test_no_agents_detected(self):
        with patch("src.cli.agent_skill.detect_agents", return_value=[]), \
             patch("builtins.print") as mock_print:
            agent_skill._install_command(MagicMock(), self._make_args())

        printed = " ".join(str(c) for c in mock_print.call_args_list)
        self.assertIn("No AI coding agents", printed)

    def test_all_already_installed(self):
        agent = _make_agent()
        with patch("src.cli.agent_skill.detect_agents", return_value=[agent]), \
             patch("src.cli.agent_skill.is_skill_installed", return_value=True), \
             patch("src.cli.agent_skill.find_npx") as mock_npx, \
             patch("builtins.print") as mock_print:
            agent_skill._install_command(MagicMock(), self._make_args(force=False))

        mock_npx.assert_not_called()
        printed = " ".join(str(c) for c in mock_print.call_args_list)
        self.assertIn("already installed", printed)

    def test_npx_missing_prints_instructions(self):
        agent = _make_agent()
        with patch("src.cli.agent_skill.detect_agents", return_value=[agent]), \
             patch("src.cli.agent_skill.is_skill_installed", return_value=False), \
             patch("src.cli.agent_skill.find_npx", return_value=None), \
             patch("builtins.print") as mock_print:
            agent_skill._install_command(MagicMock(), self._make_args())

        printed = " ".join(str(c) for c in mock_print.call_args_list)
        self.assertIn("npx not found", printed)

    def test_force_reinstalls(self):
        agent = _make_agent()
        with patch("src.cli.agent_skill.detect_agents", return_value=[agent]), \
             patch("src.cli.agent_skill.is_skill_installed", return_value=True), \
             patch("src.cli.agent_skill.uninstall_skill") as mock_uninstall, \
             patch("src.cli.agent_skill.find_npx", return_value="/usr/bin/npx"), \
             patch("src.cli.agent_skill.install_skill_via_registry", return_value=False), \
             patch("builtins.print"):
            agent_skill._install_command(MagicMock(), self._make_args(force=True))

        mock_uninstall.assert_called_once_with([agent])

    def test_installs_when_needed(self):
        agent = _make_agent()
        with patch("src.cli.agent_skill.detect_agents", return_value=[agent]), \
             patch("src.cli.agent_skill.is_skill_installed", return_value=False), \
             patch("src.cli.agent_skill.find_npx", return_value="/usr/bin/npx"), \
             patch("src.cli.agent_skill.install_skill_via_registry", return_value=True) as mock_install, \
             patch.object(Path, "is_dir", return_value=False), \
             patch("builtins.print"):
            agent_skill._install_command(MagicMock(), self._make_args())

        mock_install.assert_called_once()


class TestUninstallCommand(unittest.TestCase):
    def test_nothing_installed(self):
        agent = _make_agent()
        with patch("src.cli.agent_skill.detect_agents", return_value=[agent]), \
             patch("src.cli.agent_skill.is_skill_installed", return_value=False), \
             patch("src.cli.agent_skill.uninstall_skill") as mock_uninstall, \
             patch("builtins.print") as mock_print:
            agent_skill._uninstall_command(MagicMock(), argparse.Namespace())

        mock_uninstall.assert_not_called()
        printed = " ".join(str(c) for c in mock_print.call_args_list)
        self.assertIn("not installed", printed)

    def test_uninstalls_installed_agents(self):
        agent = _make_agent()
        with patch("src.cli.agent_skill.detect_agents", return_value=[agent]), \
             patch("src.cli.agent_skill.is_skill_installed", return_value=True), \
             patch("src.cli.agent_skill.uninstall_skill") as mock_uninstall, \
             patch("builtins.print"):
            agent_skill._uninstall_command(MagicMock(), argparse.Namespace())

        mock_uninstall.assert_called_once_with([agent])


class TestStatusCommand(unittest.TestCase):
    def test_no_agents_detected(self):
        with patch("src.cli.agent_skill.detect_agents", return_value=[]), \
             patch("builtins.print") as mock_print:
            agent_skill._status_command(MagicMock(), argparse.Namespace())

        printed = " ".join(str(c) for c in mock_print.call_args_list)
        self.assertIn("No AI coding agents", printed)

    def test_shows_installed_status(self):
        agent = _make_agent("Claude Code", "/home/user/.claude")
        with patch("src.cli.agent_skill.detect_agents", return_value=[agent]), \
             patch("src.cli.agent_skill.is_skill_installed", return_value=True), \
             patch.object(Path, "is_symlink", return_value=False), \
             patch("src.cli.agent_skill.find_npx", return_value="/usr/bin/npx"), \
             patch("builtins.print") as mock_print:
            agent_skill._status_command(MagicMock(), argparse.Namespace())

        printed = " ".join(str(c) for c in mock_print.call_args_list)
        self.assertIn("Claude Code", printed)
        self.assertIn("installed", printed)

    def test_shows_not_installed_status(self):
        agent = _make_agent("Claude Code", "/home/user/.claude")
        with patch("src.cli.agent_skill.detect_agents", return_value=[agent]), \
             patch("src.cli.agent_skill.is_skill_installed", return_value=False), \
             patch.object(Path, "is_symlink", return_value=False), \
             patch("src.cli.agent_skill.find_npx", return_value=None), \
             patch("builtins.print") as mock_print:
            agent_skill._status_command(MagicMock(), argparse.Namespace())

        printed = " ".join(str(c) for c in mock_print.call_args_list)
        self.assertIn("not installed", printed)

    def test_shows_symlink_status(self):
        agent = _make_agent("Claude Code", "/home/user/.claude")
        with patch("src.cli.agent_skill.detect_agents", return_value=[agent]), \
             patch("src.cli.agent_skill.is_skill_installed", return_value=True), \
             patch.object(Path, "is_symlink", return_value=True), \
             patch("src.cli.agent_skill.find_npx", return_value="/usr/bin/npx"), \
             patch("builtins.print") as mock_print:
            agent_skill._status_command(MagicMock(), argparse.Namespace())

        printed = " ".join(str(c) for c in mock_print.call_args_list)
        self.assertIn("symlink", printed)

    def test_shows_npx_availability(self):
        agent = _make_agent()
        with patch("src.cli.agent_skill.detect_agents", return_value=[agent]), \
             patch("src.cli.agent_skill.is_skill_installed", return_value=False), \
             patch.object(Path, "is_symlink", return_value=False), \
             patch("src.cli.agent_skill.find_npx", return_value="/usr/bin/npx"), \
             patch("builtins.print") as mock_print:
            agent_skill._status_command(MagicMock(), argparse.Namespace())

        printed = " ".join(str(c) for c in mock_print.call_args_list)
        self.assertIn("npx", printed)


class TestSetupParser(unittest.TestCase):
    def _build_parser(self):
        main_parser = argparse.ArgumentParser()
        subparsers = main_parser.add_subparsers(dest="command")
        agent_skill.setup_parser(subparsers)
        return main_parser

    def test_agent_skill_subcommand_registered(self):
        parser = self._build_parser()
        args = parser.parse_args(["agent-skill", "status"])
        self.assertEqual(args.command, "agent-skill")
        self.assertEqual(args.agent_skill_command, "status")

    def test_install_subcommand(self):
        parser = self._build_parser()
        args = parser.parse_args(["agent-skill", "install"])
        self.assertEqual(args.agent_skill_command, "install")
        self.assertFalse(args.force)

    def test_install_force_flag(self):
        parser = self._build_parser()
        args = parser.parse_args(["agent-skill", "install", "--force"])
        self.assertTrue(args.force)

    def test_uninstall_subcommand(self):
        parser = self._build_parser()
        args = parser.parse_args(["agent-skill", "uninstall"])
        self.assertEqual(args.agent_skill_command, "uninstall")

    def test_install_sets_func(self):
        parser = self._build_parser()
        args = parser.parse_args(["agent-skill", "install"])
        self.assertEqual(args.func, agent_skill._install_command)

    def test_uninstall_sets_func(self):
        parser = self._build_parser()
        args = parser.parse_args(["agent-skill", "uninstall"])
        self.assertEqual(args.func, agent_skill._uninstall_command)

    def test_status_sets_func(self):
        parser = self._build_parser()
        args = parser.parse_args(["agent-skill", "status"])
        self.assertEqual(args.func, agent_skill._status_command)


if __name__ == "__main__":
    unittest.main()