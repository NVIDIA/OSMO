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
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from src.cli import agent_skill


class TestAgentDirectory(unittest.TestCase):
    """Tests for the AgentDirectory dataclass."""

    def test_default_is_universal(self):
        """is_universal defaults to False."""
        agent = agent_skill.AgentDirectory(
            name="Test",
            config_directory=Path("/tmp/test"),
            skill_directory=Path("/tmp/test/skills"),
        )
        self.assertFalse(agent.is_universal)

    def test_universal_flag(self):
        """is_universal can be set to True."""
        agent = agent_skill.AgentDirectory(
            name="Agent Skills",
            config_directory=Path("/tmp/.agents"),
            skill_directory=Path("/tmp/.agents/skills"),
            is_universal=True,
        )
        self.assertTrue(agent.is_universal)


class TestDetectAgents(unittest.TestCase):
    """Tests for detect_agents()."""

    def test_no_agents_when_directories_absent(self):
        """Returns empty list when no agent config directories exist."""
        with tempfile.TemporaryDirectory() as tmpdir:
            fake_home = Path(tmpdir)
            with mock.patch("src.cli.agent_skill.Path") as mock_path_cls:
                mock_path_cls.home.return_value = fake_home
                # None of the subdirs exist
                result = agent_skill.detect_agents()
        self.assertEqual(result, [])

    def test_detects_claude_directory(self):
        """Returns Claude Code agent when ~/.claude exists."""
        with tempfile.TemporaryDirectory() as tmpdir:
            fake_home = Path(tmpdir)
            (fake_home / ".claude").mkdir()
            with mock.patch("src.cli.agent_skill.Path") as mock_path_cls:
                mock_path_cls.home.return_value = fake_home
                result = agent_skill.detect_agents()
        names = [a.name for a in result]
        self.assertIn("Claude Code", names)

    def test_detects_codex_directory(self):
        """Returns Codex agent when ~/.codex exists."""
        with tempfile.TemporaryDirectory() as tmpdir:
            fake_home = Path(tmpdir)
            (fake_home / ".codex").mkdir()
            with mock.patch("src.cli.agent_skill.Path") as mock_path_cls:
                mock_path_cls.home.return_value = fake_home
                result = agent_skill.detect_agents()
        names = [a.name for a in result]
        self.assertIn("Codex", names)

    def test_detects_agents_directory(self):
        """Returns Agent Skills agent when ~/.agents exists."""
        with tempfile.TemporaryDirectory() as tmpdir:
            fake_home = Path(tmpdir)
            (fake_home / ".agents").mkdir()
            with mock.patch("src.cli.agent_skill.Path") as mock_path_cls:
                mock_path_cls.home.return_value = fake_home
                result = agent_skill.detect_agents()
        names = [a.name for a in result]
        self.assertIn("Agent Skills", names)

    def test_detects_multiple_agents(self):
        """Returns all agents whose directories exist."""
        with tempfile.TemporaryDirectory() as tmpdir:
            fake_home = Path(tmpdir)
            (fake_home / ".claude").mkdir()
            (fake_home / ".codex").mkdir()
            with mock.patch("src.cli.agent_skill.Path") as mock_path_cls:
                mock_path_cls.home.return_value = fake_home
                result = agent_skill.detect_agents()
        self.assertEqual(len(result), 2)

    def test_agents_directory_is_universal(self):
        """Agent Skills directory has is_universal=True."""
        with tempfile.TemporaryDirectory() as tmpdir:
            fake_home = Path(tmpdir)
            (fake_home / ".agents").mkdir()
            with mock.patch("src.cli.agent_skill.Path") as mock_path_cls:
                mock_path_cls.home.return_value = fake_home
                result = agent_skill.detect_agents()
        agents_entry = next(a for a in result if a.name == "Agent Skills")
        self.assertTrue(agents_entry.is_universal)

    def test_claude_not_universal(self):
        """Claude Code agent is not universal."""
        with tempfile.TemporaryDirectory() as tmpdir:
            fake_home = Path(tmpdir)
            (fake_home / ".claude").mkdir()
            with mock.patch("src.cli.agent_skill.Path") as mock_path_cls:
                mock_path_cls.home.return_value = fake_home
                result = agent_skill.detect_agents()
        claude_entry = next(a for a in result if a.name == "Claude Code")
        self.assertFalse(claude_entry.is_universal)


class TestIsSkillInstalled(unittest.TestCase):
    """Tests for is_skill_installed()."""

    def test_returns_true_when_skill_md_exists(self):
        """Returns True when SKILL.md is present in skill directory."""
        with tempfile.TemporaryDirectory() as tmpdir:
            skill_dir = Path(tmpdir) / "skills"
            skill_md = skill_dir / "osmo-agent" / "SKILL.md"
            skill_md.parent.mkdir(parents=True)
            skill_md.touch()

            agent = agent_skill.AgentDirectory(
                name="Test",
                config_directory=Path(tmpdir),
                skill_directory=skill_dir,
            )
            self.assertTrue(agent_skill.is_skill_installed(agent))

    def test_returns_false_when_skill_md_absent(self):
        """Returns False when SKILL.md is missing."""
        with tempfile.TemporaryDirectory() as tmpdir:
            skill_dir = Path(tmpdir) / "skills"
            skill_dir.mkdir()

            agent = agent_skill.AgentDirectory(
                name="Test",
                config_directory=Path(tmpdir),
                skill_directory=skill_dir,
            )
            self.assertFalse(agent_skill.is_skill_installed(agent))

    def test_returns_false_when_skill_dir_absent(self):
        """Returns False when the skills directory itself does not exist."""
        with tempfile.TemporaryDirectory() as tmpdir:
            skill_dir = Path(tmpdir) / "skills"  # not created

            agent = agent_skill.AgentDirectory(
                name="Test",
                config_directory=Path(tmpdir),
                skill_directory=skill_dir,
            )
            self.assertFalse(agent_skill.is_skill_installed(agent))

    def test_returns_false_when_only_dir_no_skill_md(self):
        """Returns False when osmo-agent directory exists but SKILL.md is absent."""
        with tempfile.TemporaryDirectory() as tmpdir:
            skill_dir = Path(tmpdir) / "skills"
            (skill_dir / "osmo-agent").mkdir(parents=True)
            # SKILL.md not created

            agent = agent_skill.AgentDirectory(
                name="Test",
                config_directory=Path(tmpdir),
                skill_directory=skill_dir,
            )
            self.assertFalse(agent_skill.is_skill_installed(agent))


class TestFindNpx(unittest.TestCase):
    """Tests for find_npx()."""

    def test_returns_path_when_npx_found(self):
        """Returns the npx path when it exists on PATH."""
        with mock.patch("src.cli.agent_skill.shutil.which", return_value="/usr/bin/npx"):
            result = agent_skill.find_npx()
        self.assertEqual(result, "/usr/bin/npx")

    def test_returns_none_when_npx_not_found(self):
        """Returns None when npx is not on PATH."""
        with mock.patch("src.cli.agent_skill.shutil.which", return_value=None):
            result = agent_skill.find_npx()
        self.assertIsNone(result)

    def test_calls_which_with_npx(self):
        """Searches for 'npx' specifically."""
        with mock.patch("src.cli.agent_skill.shutil.which") as mock_which:
            mock_which.return_value = None
            agent_skill.find_npx()
        mock_which.assert_called_once_with("npx")


class TestInstallSkillViaRegistry(unittest.TestCase):
    """Tests for install_skill_via_registry()."""

    def test_returns_true_on_success(self):
        """Returns True when subprocess exits with code 0."""
        mock_result = mock.MagicMock()
        mock_result.returncode = 0
        with mock.patch("src.cli.agent_skill.subprocess.run", return_value=mock_result):
            result = agent_skill.install_skill_via_registry("/usr/bin/npx")
        self.assertTrue(result)

    def test_returns_false_on_nonzero_exit(self):
        """Returns False when subprocess exits with non-zero code."""
        mock_result = mock.MagicMock()
        mock_result.returncode = 1
        mock_result.stderr = "error output"
        with mock.patch("src.cli.agent_skill.subprocess.run", return_value=mock_result):
            result = agent_skill.install_skill_via_registry("/usr/bin/npx")
        self.assertFalse(result)

    def test_returns_false_on_timeout(self):
        """Returns False when subprocess times out."""
        with mock.patch(
            "src.cli.agent_skill.subprocess.run",
            side_effect=subprocess.TimeoutExpired(cmd="npx", timeout=120),
        ):
            result = agent_skill.install_skill_via_registry("/usr/bin/npx")
        self.assertFalse(result)

    def test_returns_false_on_os_error(self):
        """Returns False when subprocess raises OSError."""
        with mock.patch(
            "src.cli.agent_skill.subprocess.run",
            side_effect=OSError("file not found"),
        ):
            result = agent_skill.install_skill_via_registry("/usr/bin/npx")
        self.assertFalse(result)

    def test_invokes_npx_skills_add(self):
        """Calls npx skills add nvidia/osmo with the provided npx path."""
        mock_result = mock.MagicMock()
        mock_result.returncode = 0
        with mock.patch("src.cli.agent_skill.subprocess.run", return_value=mock_result) as mock_run:
            agent_skill.install_skill_via_registry("/custom/npx", timeout=60)
        mock_run.assert_called_once()
        call_args = mock_run.call_args
        self.assertEqual(call_args[0][0][0], "/custom/npx")
        self.assertIn("nvidia/osmo", call_args[0][0])

    def test_respects_timeout_parameter(self):
        """Passes the timeout argument to subprocess.run."""
        mock_result = mock.MagicMock()
        mock_result.returncode = 0
        with mock.patch("src.cli.agent_skill.subprocess.run", return_value=mock_result) as mock_run:
            agent_skill.install_skill_via_registry("/usr/bin/npx", timeout=45)
        call_kwargs = mock_run.call_args[1]
        self.assertEqual(call_kwargs["timeout"], 45)


class TestInstallSymlinks(unittest.TestCase):
    """Tests for install_symlinks()."""

    def test_creates_symlink_for_missing_skill(self):
        """Creates a symlink when the target does not exist yet."""
        with tempfile.TemporaryDirectory() as tmpdir:
            skill_dir = Path(tmpdir) / "skills"
            skill_dir.mkdir()
            universal_path = Path(tmpdir) / "universal_osmo_agent"
            universal_path.mkdir()

            agent = agent_skill.AgentDirectory(
                name="Claude Code",
                config_directory=Path(tmpdir),
                skill_directory=skill_dir,
            )
            agent_skill.install_symlinks([agent], universal_path)

            target = skill_dir / "osmo-agent"
            self.assertTrue(target.is_symlink())
            self.assertEqual(target.resolve(), universal_path.resolve())

    def test_skips_existing_skill(self):
        """Does not overwrite an already-installed skill."""
        with tempfile.TemporaryDirectory() as tmpdir:
            skill_dir = Path(tmpdir) / "skills"
            existing = skill_dir / "osmo-agent"
            existing.mkdir(parents=True)
            universal_path = Path(tmpdir) / "universal_osmo_agent"
            universal_path.mkdir()

            agent = agent_skill.AgentDirectory(
                name="Claude Code",
                config_directory=Path(tmpdir),
                skill_directory=skill_dir,
            )
            agent_skill.install_symlinks([agent], universal_path)

            # Still a regular directory, not replaced by symlink
            self.assertTrue(existing.is_dir())
            self.assertFalse(existing.is_symlink())

    def test_skips_existing_symlink(self):
        """Does not replace an already-present symlink."""
        with tempfile.TemporaryDirectory() as tmpdir:
            skill_dir = Path(tmpdir) / "skills"
            skill_dir.mkdir()
            other_target = Path(tmpdir) / "other"
            other_target.mkdir()
            existing_link = skill_dir / "osmo-agent"
            existing_link.symlink_to(other_target)

            universal_path = Path(tmpdir) / "universal_osmo_agent"
            universal_path.mkdir()

            agent = agent_skill.AgentDirectory(
                name="Claude Code",
                config_directory=Path(tmpdir),
                skill_directory=skill_dir,
            )
            agent_skill.install_symlinks([agent], universal_path)

            # Symlink still points to original target
            self.assertEqual(existing_link.resolve(), other_target.resolve())

    def test_creates_skill_directory_if_missing(self):
        """Creates parent skill directory if it does not yet exist."""
        with tempfile.TemporaryDirectory() as tmpdir:
            skill_dir = Path(tmpdir) / "skills"  # not created
            universal_path = Path(tmpdir) / "universal_osmo_agent"
            universal_path.mkdir()

            agent = agent_skill.AgentDirectory(
                name="Claude Code",
                config_directory=Path(tmpdir),
                skill_directory=skill_dir,
            )
            agent_skill.install_symlinks([agent], universal_path)

            self.assertTrue(skill_dir.is_dir())
            self.assertTrue((skill_dir / "osmo-agent").is_symlink())

    def test_handles_multiple_agents(self):
        """Creates symlinks for each agent in the list."""
        with tempfile.TemporaryDirectory() as tmpdir:
            universal_path = Path(tmpdir) / "universal_osmo_agent"
            universal_path.mkdir()

            agents = []
            for name in ("Agent1", "Agent2"):
                skill_dir = Path(tmpdir) / name / "skills"
                skill_dir.mkdir(parents=True)
                agents.append(agent_skill.AgentDirectory(
                    name=name,
                    config_directory=Path(tmpdir) / name,
                    skill_directory=skill_dir,
                ))

            agent_skill.install_symlinks(agents, universal_path)

            for a in agents:
                self.assertTrue((a.skill_directory / "osmo-agent").is_symlink())


class TestUninstallSkill(unittest.TestCase):
    """Tests for uninstall_skill()."""

    def test_removes_symlink(self):
        """Removes a symlink pointing to the skill."""
        with tempfile.TemporaryDirectory() as tmpdir:
            skill_dir = Path(tmpdir) / "skills"
            skill_dir.mkdir()
            target_dir = Path(tmpdir) / "real_skill"
            target_dir.mkdir()
            link = skill_dir / "osmo-agent"
            link.symlink_to(target_dir)

            agent = agent_skill.AgentDirectory(
                name="Test",
                config_directory=Path(tmpdir),
                skill_directory=skill_dir,
            )
            agent_skill.uninstall_skill([agent])

            self.assertFalse(link.exists())
            self.assertFalse(link.is_symlink())

    def test_removes_directory(self):
        """Removes a real directory installation."""
        with tempfile.TemporaryDirectory() as tmpdir:
            skill_dir = Path(tmpdir) / "skills"
            osmo_dir = skill_dir / "osmo-agent"
            osmo_dir.mkdir(parents=True)
            (osmo_dir / "SKILL.md").touch()

            agent = agent_skill.AgentDirectory(
                name="Test",
                config_directory=Path(tmpdir),
                skill_directory=skill_dir,
            )
            agent_skill.uninstall_skill([agent])

            self.assertFalse(osmo_dir.exists())

    def test_noop_when_not_installed(self):
        """Does nothing (no error) when skill is not installed."""
        with tempfile.TemporaryDirectory() as tmpdir:
            skill_dir = Path(tmpdir) / "skills"
            skill_dir.mkdir()

            agent = agent_skill.AgentDirectory(
                name="Test",
                config_directory=Path(tmpdir),
                skill_directory=skill_dir,
            )
            # Should not raise
            agent_skill.uninstall_skill([agent])

    def test_removes_from_multiple_agents(self):
        """Removes skill from each agent in the list."""
        with tempfile.TemporaryDirectory() as tmpdir:
            targets = []
            agents = []
            for i in range(2):
                skill_dir = Path(tmpdir) / f"agent{i}" / "skills"
                osmo_dir = skill_dir / "osmo-agent"
                osmo_dir.mkdir(parents=True)
                (osmo_dir / "SKILL.md").touch()
                targets.append(osmo_dir)
                agents.append(agent_skill.AgentDirectory(
                    name=f"Agent{i}",
                    config_directory=Path(tmpdir) / f"agent{i}",
                    skill_directory=skill_dir,
                ))

            agent_skill.uninstall_skill(agents)

            for target in targets:
                self.assertFalse(target.exists())


class TestIsInteractiveTerminal(unittest.TestCase):
    """Tests for is_interactive_terminal()."""

    def test_true_when_both_tty(self):
        """Returns True when stdin and stdout are both TTYs."""
        with mock.patch.object(sys.stdin, "isatty", return_value=True), \
             mock.patch.object(sys.stdout, "isatty", return_value=True):
            self.assertTrue(agent_skill.is_interactive_terminal())

    def test_false_when_stdin_not_tty(self):
        """Returns False when stdin is not a TTY."""
        with mock.patch.object(sys.stdin, "isatty", return_value=False), \
             mock.patch.object(sys.stdout, "isatty", return_value=True):
            self.assertFalse(agent_skill.is_interactive_terminal())

    def test_false_when_stdout_not_tty(self):
        """Returns False when stdout is not a TTY."""
        with mock.patch.object(sys.stdin, "isatty", return_value=True), \
             mock.patch.object(sys.stdout, "isatty", return_value=False):
            self.assertFalse(agent_skill.is_interactive_terminal())

    def test_false_when_neither_tty(self):
        """Returns False when neither stdin nor stdout is a TTY."""
        with mock.patch.object(sys.stdin, "isatty", return_value=False), \
             mock.patch.object(sys.stdout, "isatty", return_value=False):
            self.assertFalse(agent_skill.is_interactive_terminal())


class TestPromptSkillInstallation(unittest.TestCase):
    """Tests for prompt_skill_installation()."""

    def _make_agent(self, name="Test", installed=False):
        agent = mock.MagicMock(spec=agent_skill.AgentDirectory)
        agent.name = name
        return agent

    def test_returns_early_when_not_interactive(self):
        """Does nothing when not running in a TTY."""
        with mock.patch("src.cli.agent_skill.is_interactive_terminal", return_value=False), \
             mock.patch("src.cli.agent_skill.detect_agents") as mock_detect:
            agent_skill.prompt_skill_installation()
        mock_detect.assert_not_called()

    def test_returns_early_when_no_agents(self):
        """Does nothing when no agents are detected."""
        with mock.patch("src.cli.agent_skill.is_interactive_terminal", return_value=True), \
             mock.patch("src.cli.agent_skill.detect_agents", return_value=[]), \
             mock.patch("src.cli.agent_skill.find_npx") as mock_find:
            agent_skill.prompt_skill_installation()
        mock_find.assert_not_called()

    def test_returns_early_when_all_installed(self):
        """Does nothing when all detected agents already have the skill."""
        agent = self._make_agent()
        with mock.patch("src.cli.agent_skill.is_interactive_terminal", return_value=True), \
             mock.patch("src.cli.agent_skill.detect_agents", return_value=[agent]), \
             mock.patch("src.cli.agent_skill.is_skill_installed", return_value=True), \
             mock.patch("src.cli.agent_skill.find_npx") as mock_find:
            agent_skill.prompt_skill_installation()
        mock_find.assert_not_called()

    def test_prints_npm_hint_when_npx_missing(self):
        """Prints npm install hint when npx is unavailable."""
        agent = self._make_agent()
        with mock.patch("src.cli.agent_skill.is_interactive_terminal", return_value=True), \
             mock.patch("src.cli.agent_skill.detect_agents", return_value=[agent]), \
             mock.patch("src.cli.agent_skill.is_skill_installed", return_value=False), \
             mock.patch("src.cli.agent_skill.find_npx", return_value=None), \
             mock.patch("builtins.print") as mock_print:
            agent_skill.prompt_skill_installation()
        printed = " ".join(str(c) for c in mock_print.call_args_list)
        self.assertIn("npm", printed)

    def test_does_not_install_when_user_declines(self):
        """Does not install when the user answers no."""
        agent = self._make_agent()
        with mock.patch("src.cli.agent_skill.is_interactive_terminal", return_value=True), \
             mock.patch("src.cli.agent_skill.detect_agents", return_value=[agent]), \
             mock.patch("src.cli.agent_skill.is_skill_installed", return_value=False), \
             mock.patch("src.cli.agent_skill.find_npx", return_value="/usr/bin/npx"), \
             mock.patch("src.cli.agent_skill._run_install") as mock_install, \
             mock.patch("src.lib.utils.common.prompt_user", return_value=False):
            agent_skill.prompt_skill_installation()
        mock_install.assert_not_called()

    def test_installs_when_user_confirms(self):
        """Calls _run_install when user confirms installation."""
        agent = self._make_agent()
        with mock.patch("src.cli.agent_skill.is_interactive_terminal", return_value=True), \
             mock.patch("src.cli.agent_skill.detect_agents", return_value=[agent]), \
             mock.patch("src.cli.agent_skill.is_skill_installed", return_value=False), \
             mock.patch("src.cli.agent_skill.find_npx", return_value="/usr/bin/npx"), \
             mock.patch("src.cli.agent_skill._run_install") as mock_install, \
             mock.patch("src.lib.utils.common.prompt_user", return_value=True):
            agent_skill.prompt_skill_installation()
        mock_install.assert_called_once()

    def test_only_uninstalled_agents_passed_to_run_install(self):
        """Passes only agents missing the skill to _run_install."""
        installed_agent = self._make_agent("Installed")
        missing_agent = self._make_agent("Missing")

        def _fake_is_installed(a):
            return a.name == "Installed"

        with mock.patch("src.cli.agent_skill.is_interactive_terminal", return_value=True), \
             mock.patch("src.cli.agent_skill.detect_agents", return_value=[installed_agent, missing_agent]), \
             mock.patch("src.cli.agent_skill.is_skill_installed", side_effect=_fake_is_installed), \
             mock.patch("src.cli.agent_skill.find_npx", return_value="/usr/bin/npx"), \
             mock.patch("src.cli.agent_skill._run_install") as mock_install, \
             mock.patch("src.lib.utils.common.prompt_user", return_value=True):
            agent_skill.prompt_skill_installation()

        agents_arg = mock_install.call_args[0][1]
        self.assertEqual(len(agents_arg), 1)
        self.assertEqual(agents_arg[0].name, "Missing")


class TestSetupParser(unittest.TestCase):
    """Tests for setup_parser()."""

    def _make_parser(self):
        parser = argparse.ArgumentParser()
        subparsers = parser.add_subparsers(dest="command")
        agent_skill.setup_parser(subparsers)
        return parser

    def test_agent_skill_subcommand_exists(self):
        """agent-skill is a registered top-level subcommand."""
        parser = self._make_parser()
        args = parser.parse_args(["agent-skill", "status"])
        self.assertEqual(args.command, "agent-skill")

    def test_install_subcommand(self):
        """install subcommand is registered under agent-skill."""
        parser = self._make_parser()
        args = parser.parse_args(["agent-skill", "install"])
        self.assertEqual(args.agent_skill_command, "install")

    def test_uninstall_subcommand(self):
        """uninstall subcommand is registered under agent-skill."""
        parser = self._make_parser()
        args = parser.parse_args(["agent-skill", "uninstall"])
        self.assertEqual(args.agent_skill_command, "uninstall")

    def test_status_subcommand(self):
        """status subcommand is registered under agent-skill."""
        parser = self._make_parser()
        args = parser.parse_args(["agent-skill", "status"])
        self.assertEqual(args.agent_skill_command, "status")

    def test_install_force_flag(self):
        """install subcommand accepts --force flag."""
        parser = self._make_parser()
        args = parser.parse_args(["agent-skill", "install", "--force"])
        self.assertTrue(args.force)

    def test_install_force_defaults_false(self):
        """--force defaults to False when not specified."""
        parser = self._make_parser()
        args = parser.parse_args(["agent-skill", "install"])
        self.assertFalse(args.force)

    def test_install_sets_func(self):
        """install subcommand sets a callable func on the namespace."""
        parser = self._make_parser()
        args = parser.parse_args(["agent-skill", "install"])
        self.assertTrue(callable(args.func))

    def test_uninstall_sets_func(self):
        """uninstall subcommand sets a callable func on the namespace."""
        parser = self._make_parser()
        args = parser.parse_args(["agent-skill", "uninstall"])
        self.assertTrue(callable(args.func))

    def test_status_sets_func(self):
        """status subcommand sets a callable func on the namespace."""
        parser = self._make_parser()
        args = parser.parse_args(["agent-skill", "status"])
        self.assertTrue(callable(args.func))


class TestFormatPath(unittest.TestCase):
    """Tests for the _format_path helper."""

    def test_home_directory_replaced_with_tilde(self):
        """Paths under home directory are shown with ~/ prefix."""
        home = Path.home()
        path = home / "some" / "subdir"
        result = agent_skill._format_path(path)
        self.assertTrue(result.startswith("~/"))
        self.assertIn("some/subdir", result)

    def test_non_home_path_returned_as_is(self):
        """Paths outside home directory are returned as absolute strings."""
        path = Path("/tmp/some/path")
        result = agent_skill._format_path(path)
        self.assertEqual(result, "/tmp/some/path")


if __name__ == "__main__":
    unittest.main()