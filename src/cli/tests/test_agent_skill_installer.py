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
import os
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from src.cli import agent_skill_installer as agent_skill
from src.cli import login as login_module


class TestAgentDirectory(unittest.TestCase):
    """Tests for AgentDirectory dataclass."""

    def test_agent_directory_stores_name_and_paths(self):
        """AgentDirectory should store name, config_directory, and skill_directory."""
        agent = agent_skill.AgentDirectory(
            name="Test Agent",
            config_directory=Path("/home/user/.test"),
            skill_directory=Path("/home/user/.test/skills"),
        )
        self.assertEqual(agent.name, "Test Agent")
        self.assertEqual(agent.config_directory, Path("/home/user/.test"))
        self.assertEqual(agent.skill_directory, Path("/home/user/.test/skills"))


class TestGetKnownAgents(unittest.TestCase):
    """Tests for _get_known_agents function."""

    def test_returns_list_of_agent_directories(self):
        """_get_known_agents should return a list of AgentDirectory objects."""
        with mock.patch.object(Path, "home", return_value=Path("/home/testuser")):
            agents = agent_skill._get_known_agents()

        self.assertIsInstance(agents, list)
        self.assertGreater(len(agents), 0)
        self.assertTrue(all(isinstance(a, agent_skill.AgentDirectory) for a in agents))

    def test_includes_claude_code_agent(self):
        """_get_known_agents should include Claude Code agent."""
        with mock.patch.object(Path, "home", return_value=Path("/home/testuser")):
            agents = agent_skill._get_known_agents()

        agent_names = [a.name for a in agents]
        self.assertIn("Claude Code", agent_names)

    def test_includes_codex_agent(self):
        """_get_known_agents should include Codex agent."""
        with mock.patch.object(Path, "home", return_value=Path("/home/testuser")):
            agents = agent_skill._get_known_agents()

        agent_names = [a.name for a in agents]
        self.assertIn("Codex", agent_names)

    def test_includes_agent_skills_agent(self):
        """_get_known_agents should include Agent Skills agent."""
        with mock.patch.object(Path, "home", return_value=Path("/home/testuser")):
            agents = agent_skill._get_known_agents()

        agent_names = [a.name for a in agents]
        self.assertIn("Agent Skills", agent_names)

    def test_claude_code_paths_use_home_directory(self):
        """Claude Code agent should use paths relative to home."""
        with mock.patch.object(Path, "home", return_value=Path("/home/testuser")):
            agents = agent_skill._get_known_agents()

        claude_agent = next(a for a in agents if a.name == "Claude Code")
        self.assertEqual(claude_agent.config_directory, Path("/home/testuser/.claude"))
        self.assertEqual(claude_agent.skill_directory, Path("/home/testuser/.claude/skills"))


class TestDetectAgents(unittest.TestCase):
    """Tests for detect_agents function."""

    def test_returns_empty_list_when_no_agent_directories_exist(self):
        """detect_agents should return empty list when no config directories exist."""
        with mock.patch.object(Path, "home", return_value=Path("/home/testuser")), \
             mock.patch.object(Path, "is_dir", return_value=False):
            agents = agent_skill.detect_agents()

        self.assertEqual(agents, [])

    def test_returns_agents_with_existing_config_directories(self):
        """detect_agents should return only agents whose config_directory exists."""
        with tempfile.TemporaryDirectory() as temp_dir:
            temp_path = Path(temp_dir)
            # Create only Claude config dir
            (temp_path / ".claude").mkdir()

            with mock.patch.object(Path, "home", return_value=temp_path):
                agents = agent_skill.detect_agents()

        agent_names = [a.name for a in agents]
        self.assertIn("Claude Code", agent_names)
        self.assertNotIn("Codex", agent_names)

    def test_returns_multiple_agents_when_multiple_exist(self):
        """detect_agents should return all agents with existing directories."""
        with tempfile.TemporaryDirectory() as temp_dir:
            temp_path = Path(temp_dir)
            (temp_path / ".claude").mkdir()
            (temp_path / ".codex").mkdir()

            with mock.patch.object(Path, "home", return_value=temp_path):
                agents = agent_skill.detect_agents()

        agent_names = [a.name for a in agents]
        self.assertIn("Claude Code", agent_names)
        self.assertIn("Codex", agent_names)
        self.assertEqual(len(agents), 2)


class TestIsSkillInstalled(unittest.TestCase):
    """Tests for is_skill_installed function."""

    def test_returns_false_when_skill_file_does_not_exist(self):
        """is_skill_installed should return False when SKILL.md doesn't exist."""
        with tempfile.TemporaryDirectory() as temp_dir:
            agent = agent_skill.AgentDirectory(
                name="Test",
                config_directory=Path(temp_dir),
                skill_directory=Path(temp_dir) / "skills",
            )

            result = agent_skill.is_skill_installed(agent)

        self.assertFalse(result)

    def test_returns_true_when_skill_file_exists(self):
        """is_skill_installed should return True when SKILL.md exists."""
        with tempfile.TemporaryDirectory() as temp_dir:
            skill_dir = Path(temp_dir) / "skills" / agent_skill.SKILL_PACKAGE_NAME
            skill_dir.mkdir(parents=True)
            (skill_dir / "SKILL.md").touch()

            agent = agent_skill.AgentDirectory(
                name="Test",
                config_directory=Path(temp_dir),
                skill_directory=Path(temp_dir) / "skills",
            )

            result = agent_skill.is_skill_installed(agent)

        self.assertTrue(result)

    def test_returns_true_when_skill_exists_in_project_scope(self):
        """is_skill_installed should return True when skill exists in project-scope path."""
        with tempfile.TemporaryDirectory() as temp_home, \
             tempfile.TemporaryDirectory() as temp_project:
            # Global path does NOT have the skill
            agent = agent_skill.AgentDirectory(
                name="Claude Code",
                config_directory=Path(temp_home) / ".claude",
                skill_directory=Path(temp_home) / ".claude" / "skills",
            )
            (Path(temp_home) / ".claude").mkdir()

            # Project-scope path DOES have the skill
            project_skill = Path(temp_project) / ".claude" / "skills" / agent_skill.SKILL_PACKAGE_NAME
            project_skill.mkdir(parents=True)
            (project_skill / "SKILL.md").touch()

            with mock.patch("pathlib.Path.cwd", return_value=Path(temp_project)):
                result = agent_skill.is_skill_installed(agent)

        self.assertTrue(result)

    def test_returns_false_when_skill_missing_from_both_scopes(self):
        """is_skill_installed should return False when skill is in neither global nor project."""
        with tempfile.TemporaryDirectory() as temp_home, \
             tempfile.TemporaryDirectory() as temp_project:
            agent = agent_skill.AgentDirectory(
                name="Claude Code",
                config_directory=Path(temp_home) / ".claude",
                skill_directory=Path(temp_home) / ".claude" / "skills",
            )

            with mock.patch("pathlib.Path.cwd", return_value=Path(temp_project)):
                result = agent_skill.is_skill_installed(agent)

        self.assertFalse(result)


class TestFindNpx(unittest.TestCase):
    """Tests for find_npx function."""

    def test_returns_path_when_npx_found(self):
        """find_npx should return path when npx is on PATH."""
        with mock.patch("shutil.which", return_value="/usr/local/bin/npx"):
            result = agent_skill.find_npx()

        self.assertEqual(result, "/usr/local/bin/npx")

    def test_returns_none_when_npx_not_found(self):
        """find_npx should return None when npx is not on PATH."""
        with mock.patch("shutil.which", return_value=None):
            result = agent_skill.find_npx()

        self.assertIsNone(result)


class TestIsPromptDeclined(unittest.TestCase):
    """Tests for _is_prompt_declined function."""

    def test_returns_false_when_marker_does_not_exist(self):
        """_is_prompt_declined should return False when marker file doesn't exist."""
        with tempfile.TemporaryDirectory() as temp_dir:
            with mock.patch("src.cli.agent_skill_installer.client_configs.get_client_config_dir",
                            return_value=temp_dir):
                result = agent_skill._is_prompt_declined()

        self.assertFalse(result)

    def test_returns_true_when_marker_exists(self):
        """_is_prompt_declined should return True when marker file exists."""
        with tempfile.TemporaryDirectory() as temp_dir:
            marker_path = Path(temp_dir) / agent_skill.DECLINE_MARKER_FILE
            marker_path.touch()

            with mock.patch("src.cli.agent_skill_installer.client_configs.get_client_config_dir",
                            return_value=temp_dir):
                result = agent_skill._is_prompt_declined()

        self.assertTrue(result)


class TestSavePromptDeclined(unittest.TestCase):
    """Tests for _save_prompt_declined function."""

    def test_creates_marker_file(self):
        """_save_prompt_declined should create the decline marker file."""
        with tempfile.TemporaryDirectory() as temp_dir:
            with mock.patch("src.cli.agent_skill_installer.client_configs.get_client_config_dir",
                            return_value=temp_dir):
                agent_skill._save_prompt_declined()

            marker_path = Path(temp_dir) / agent_skill.DECLINE_MARKER_FILE
            self.assertTrue(marker_path.exists())


class TestPrintNpxInstallInstructions(unittest.TestCase):
    """Tests for _print_npx_install_instructions."""

    def test_with_brew_shows_brew_command(self):
        """When brew is available, shows brew install node."""
        with mock.patch("shutil.which", return_value="/opt/homebrew/bin/brew"), \
             mock.patch("builtins.print") as mock_print:
            agent_skill._print_npx_install_instructions()

        output = " ".join(str(arg) for call in mock_print.call_args_list for arg in call.args)
        self.assertIn("brew install node", output)

    def test_without_brew_shows_nvm_and_download_url(self):
        """Without brew, shows nvm install command and nodejs.org URL."""
        with mock.patch("shutil.which", return_value=None), \
             mock.patch("builtins.print") as mock_print:
            agent_skill._print_npx_install_instructions()

        output = " ".join(str(arg) for call in mock_print.call_args_list for arg in call.args)
        self.assertIn("https://nodejs.org/en/download", output)
        self.assertNotIn("brew", output)

    def test_always_shows_skills_add_command(self):
        """Always shows osmo skills install as the follow-up command."""
        with mock.patch("shutil.which", return_value=None), \
             mock.patch("builtins.print") as mock_print:
            agent_skill._print_npx_install_instructions()

        output = " ".join(str(arg) for call in mock_print.call_args_list for arg in call.args)
        self.assertIn("osmo skills install", output)


class TestRunNpxInstall(unittest.TestCase):
    """Tests for _run_npx_install function."""

    def test_success_returns_true(self):
        """Returns True and prints success on exit code 0."""
        with mock.patch("subprocess.run") as mock_run, \
             mock.patch("builtins.print") as mock_print:
            mock_run.return_value = mock.Mock(returncode=0)
            result = agent_skill._run_npx_install("/usr/bin/npx")

        self.assertTrue(result)
        output = " ".join(str(a) for c in mock_print.call_args_list for a in c.args)
        self.assertIn("Done!", output)

    def test_failure_returns_false(self):
        """Returns False and prints failure on nonzero exit."""
        with mock.patch("subprocess.run") as mock_run, \
             mock.patch("builtins.print") as mock_print:
            mock_run.return_value = mock.Mock(returncode=1)
            result = agent_skill._run_npx_install("/usr/bin/npx")

        self.assertFalse(result)
        output = " ".join(str(a) for c in mock_print.call_args_list for a in c.args)
        self.assertIn("Installation failed", output)

    def test_timeout_returns_false(self):
        """Returns False on timeout."""
        with mock.patch("subprocess.run") as mock_run, \
             mock.patch("builtins.print"):
            mock_run.side_effect = subprocess.TimeoutExpired("npx", 120)
            result = agent_skill._run_npx_install("/usr/bin/npx")

        self.assertFalse(result)

    def test_os_error_returns_false(self):
        """Returns False on OSError."""
        with mock.patch("subprocess.run") as mock_run, \
             mock.patch("builtins.print"):
            mock_run.side_effect = OSError("not found")
            result = agent_skill._run_npx_install("/usr/bin/npx")

        self.assertFalse(result)

    def test_extra_flags_appended(self):
        """Extra flags are appended to the npx command."""
        with mock.patch("subprocess.run") as mock_run, \
             mock.patch("builtins.print"):
            mock_run.return_value = mock.Mock(returncode=0)
            agent_skill._run_npx_install("/usr/bin/npx", extra_flags=["--yes", "--global"])

        command = mock_run.call_args[0][0]
        self.assertIn("--yes", command)
        self.assertIn("--global", command)


class TestIsInteractiveTerminal(unittest.TestCase):
    """Tests for is_interactive_terminal function."""

    def test_returns_true_when_both_stdin_and_stdout_are_tty(self):
        """is_interactive_terminal should return True when both are TTY."""
        with mock.patch("sys.stdin") as mock_stdin, \
             mock.patch("sys.stdout") as mock_stdout:
            mock_stdin.isatty.return_value = True
            mock_stdout.isatty.return_value = True

            result = agent_skill.is_interactive_terminal()

        self.assertTrue(result)

    def test_returns_false_when_stdin_is_not_tty(self):
        """is_interactive_terminal should return False when stdin is not TTY."""
        with mock.patch("sys.stdin") as mock_stdin, \
             mock.patch("sys.stdout") as mock_stdout:
            mock_stdin.isatty.return_value = False
            mock_stdout.isatty.return_value = True

            result = agent_skill.is_interactive_terminal()

        self.assertFalse(result)

    def test_returns_false_when_stdout_is_not_tty(self):
        """is_interactive_terminal should return False when stdout is not TTY."""
        with mock.patch("sys.stdin") as mock_stdin, \
             mock.patch("sys.stdout") as mock_stdout:
            mock_stdin.isatty.return_value = True
            mock_stdout.isatty.return_value = False

            result = agent_skill.is_interactive_terminal()

        self.assertFalse(result)

    def test_returns_false_when_neither_is_tty(self):
        """is_interactive_terminal should return False when neither is TTY."""
        with mock.patch("sys.stdin") as mock_stdin, \
             mock.patch("sys.stdout") as mock_stdout:
            mock_stdin.isatty.return_value = False
            mock_stdout.isatty.return_value = False

            result = agent_skill.is_interactive_terminal()

        self.assertFalse(result)


class TestPromptSkillInstallation(unittest.TestCase):
    """Tests for prompt_skill_installation function."""

    def test_returns_early_when_not_interactive(self):
        """prompt_skill_installation should return early when not interactive."""
        with mock.patch("src.cli.agent_skill_installer.is_interactive_terminal", return_value=False), \
             mock.patch("src.cli.agent_skill_installer.detect_agents") as mock_detect:
            agent_skill.prompt_skill_installation()

        mock_detect.assert_not_called()

    def test_returns_early_when_prompt_declined(self):
        """prompt_skill_installation should return early when previously declined."""
        mock_agent = agent_skill.AgentDirectory(
            name="Test", config_directory=Path("/test"), skill_directory=Path("/test/skills"))

        with mock.patch("src.cli.agent_skill_installer.is_interactive_terminal", return_value=True), \
             mock.patch("src.cli.agent_skill_installer.detect_agents", return_value=[mock_agent]), \
             mock.patch("src.cli.agent_skill_installer.is_skill_installed", return_value=False), \
             mock.patch("src.cli.agent_skill_installer._is_prompt_declined", return_value=True), \
             mock.patch("builtins.print") as mock_print:
            agent_skill.prompt_skill_installation()

        mock_print.assert_not_called()

    def test_returns_early_when_no_agents_detected(self):
        """prompt_skill_installation should return early when no agents found."""
        with mock.patch("src.cli.agent_skill_installer.is_interactive_terminal", return_value=True), \
             mock.patch("src.cli.agent_skill_installer._is_prompt_declined", return_value=False), \
             mock.patch("src.cli.agent_skill_installer.detect_agents", return_value=[]), \
             mock.patch("builtins.print") as mock_print:
            agent_skill.prompt_skill_installation()

        mock_print.assert_not_called()

    def test_returns_early_when_skill_already_installed_everywhere(self):
        """prompt_skill_installation should return early when skill installed in all agents."""
        mock_agent = agent_skill.AgentDirectory(
            name="Test", config_directory=Path("/test"), skill_directory=Path("/test/skills"))

        with mock.patch("src.cli.agent_skill_installer.is_interactive_terminal", return_value=True), \
             mock.patch("src.cli.agent_skill_installer._is_prompt_declined", return_value=False), \
             mock.patch("src.cli.agent_skill_installer.detect_agents", return_value=[mock_agent]), \
             mock.patch("src.cli.agent_skill_installer.is_skill_installed", return_value=True), \
             mock.patch("builtins.print") as mock_print:
            agent_skill.prompt_skill_installation()

        mock_print.assert_not_called()

    def test_saves_decline_when_user_chooses_dont_ask_again(self):
        """prompt_skill_installation should save decline when user chooses 'Don't ask again'."""
        mock_agent = agent_skill.AgentDirectory(
            name="Test Agent", config_directory=Path("/test"), skill_directory=Path("/test/skills"))

        with mock.patch("src.cli.agent_skill_installer.is_interactive_terminal", return_value=True), \
             mock.patch("src.cli.agent_skill_installer._is_prompt_declined", return_value=False), \
             mock.patch("src.cli.agent_skill_installer.detect_agents", return_value=[mock_agent]), \
             mock.patch("src.cli.agent_skill_installer.is_skill_installed", return_value=False), \
             mock.patch("src.cli.agent_skill_installer._prompt_install_choice",
                        return_value=agent_skill.INSTALL_NEVER), \
             mock.patch("src.cli.agent_skill_installer._save_prompt_declined") as mock_save, \
             mock.patch("builtins.print"):
            agent_skill.prompt_skill_installation()

        mock_save.assert_called_once()

    def test_does_not_save_decline_when_user_chooses_not_now(self):
        """prompt_skill_installation should not save decline when user chooses 'Not now'."""
        mock_agent = agent_skill.AgentDirectory(
            name="Test Agent", config_directory=Path("/test"), skill_directory=Path("/test/skills"))

        with mock.patch("src.cli.agent_skill_installer.is_interactive_terminal", return_value=True), \
             mock.patch("src.cli.agent_skill_installer._is_prompt_declined", return_value=False), \
             mock.patch("src.cli.agent_skill_installer.detect_agents", return_value=[mock_agent]), \
             mock.patch("src.cli.agent_skill_installer.is_skill_installed", return_value=False), \
             mock.patch("src.cli.agent_skill_installer._prompt_install_choice",
                        return_value=agent_skill.INSTALL_NOT_NOW), \
             mock.patch("src.cli.agent_skill_installer._save_prompt_declined") as mock_save, \
             mock.patch("builtins.print"):
            agent_skill.prompt_skill_installation()

        mock_save.assert_not_called()

    def test_prints_instructions_when_npx_not_found(self):
        """prompt_skill_installation should print install instructions when npx not found."""
        mock_agent = agent_skill.AgentDirectory(
            name="Test Agent", config_directory=Path("/test"), skill_directory=Path("/test/skills"))

        with mock.patch("src.cli.agent_skill_installer.is_interactive_terminal", return_value=True), \
             mock.patch("src.cli.agent_skill_installer._is_prompt_declined", return_value=False), \
             mock.patch("src.cli.agent_skill_installer.detect_agents", return_value=[mock_agent]), \
             mock.patch("src.cli.agent_skill_installer.is_skill_installed", return_value=False), \
             mock.patch("src.cli.agent_skill_installer._prompt_install_choice",
                        return_value=agent_skill.INSTALL_YES), \
             mock.patch("src.cli.agent_skill_installer.find_npx", return_value=None), \
             mock.patch("src.cli.agent_skill_installer._print_npx_install_instructions") as mock_instructions, \
             mock.patch("builtins.print"):
            agent_skill.prompt_skill_installation()

        mock_instructions.assert_called_once()

    def test_calls_run_npx_install_when_npx_found(self):
        """prompt_skill_installation calls _run_npx_install when npx is available."""
        mock_agent = agent_skill.AgentDirectory(
            name="Test Agent", config_directory=Path("/test"), skill_directory=Path("/test/skills"))

        with mock.patch("src.cli.agent_skill_installer.is_interactive_terminal", return_value=True), \
             mock.patch("src.cli.agent_skill_installer._is_prompt_declined", return_value=False), \
             mock.patch("src.cli.agent_skill_installer.detect_agents", return_value=[mock_agent]), \
             mock.patch("src.cli.agent_skill_installer.is_skill_installed", return_value=False), \
             mock.patch("src.cli.agent_skill_installer._prompt_install_choice",
                        return_value=agent_skill.INSTALL_YES), \
             mock.patch("src.cli.agent_skill_installer.find_npx", return_value="/usr/bin/npx"), \
             mock.patch("src.cli.agent_skill_installer._run_npx_install") as mock_install, \
             mock.patch("builtins.print"):
            agent_skill.prompt_skill_installation()

        mock_install.assert_called_once_with("/usr/bin/npx")

class TestPromptInstallChoiceFallback(unittest.TestCase):
    """Tests for _prompt_install_choice text fallback when termios is unavailable."""

    def test_fallback_returns_yes_on_input_1(self):
        """Numbered fallback returns INSTALL_YES when user enters '1'."""
        with mock.patch.object(agent_skill, "_HAS_TERMIOS", False), \
             mock.patch("builtins.input", return_value="1"), \
             mock.patch("builtins.print"):
            result = agent_skill._prompt_install_choice()
        self.assertEqual(result, agent_skill.INSTALL_YES)

    def test_fallback_returns_yes_on_empty_input(self):
        """Numbered fallback returns INSTALL_YES on empty input (default)."""
        with mock.patch.object(agent_skill, "_HAS_TERMIOS", False), \
             mock.patch("builtins.input", return_value=""), \
             mock.patch("builtins.print"):
            result = agent_skill._prompt_install_choice()
        self.assertEqual(result, agent_skill.INSTALL_YES)

    def test_fallback_returns_not_now_on_input_2(self):
        """Numbered fallback returns INSTALL_NOT_NOW when user enters '2'."""
        with mock.patch.object(agent_skill, "_HAS_TERMIOS", False), \
             mock.patch("builtins.input", return_value="2"), \
             mock.patch("builtins.print"):
            result = agent_skill._prompt_install_choice()
        self.assertEqual(result, agent_skill.INSTALL_NOT_NOW)

    def test_fallback_returns_never_on_input_3(self):
        """Numbered fallback returns INSTALL_NEVER when user enters '3'."""
        with mock.patch.object(agent_skill, "_HAS_TERMIOS", False), \
             mock.patch("builtins.input", return_value="3"), \
             mock.patch("builtins.print"):
            result = agent_skill._prompt_install_choice()
        self.assertEqual(result, agent_skill.INSTALL_NEVER)

    def test_fallback_retries_on_invalid_then_accepts(self):
        """Numbered fallback loops on invalid input until valid."""
        with mock.patch.object(agent_skill, "_HAS_TERMIOS", False), \
             mock.patch("builtins.input", side_effect=["x", "abc", "2"]), \
             mock.patch("builtins.print"):
            result = agent_skill._prompt_install_choice()
        self.assertEqual(result, agent_skill.INSTALL_NOT_NOW)

    def test_uses_interactive_select_when_termios_available(self):
        """Uses _interactive_select when termios is available."""
        with mock.patch.object(agent_skill, "_HAS_TERMIOS", True), \
             mock.patch("src.cli.agent_skill_installer._interactive_select",
                        return_value=agent_skill.INSTALL_NEVER) as mock_select:
            result = agent_skill._prompt_install_choice()
        self.assertEqual(result, agent_skill.INSTALL_NEVER)
        mock_select.assert_called_once()


class TestInteractiveSelectCursorRestore(unittest.TestCase):
    """Tests that _interactive_select restores cursor on exceptions."""

    def test_cursor_restored_on_keyboard_interrupt(self):
        """Cursor visibility is restored even if KeyboardInterrupt is raised."""
        writes = []

        def capture_write(text):
            writes.append(text)

        with mock.patch("sys.stdout.write", side_effect=capture_write), \
             mock.patch("sys.stdout.flush"), \
             mock.patch("src.cli.agent_skill_installer._read_key",
                        side_effect=KeyboardInterrupt):
            with self.assertRaises(KeyboardInterrupt):
                agent_skill._interactive_select(["a", "b", "c"])

        # Verify cursor was hidden then restored
        self.assertIn("\033[?25l", writes)  # hidden
        self.assertIn("\033[?25h", writes)  # restored

    def test_cursor_restored_on_eof_error(self):
        """Cursor visibility is restored even if EOFError is raised."""
        writes = []

        def capture_write(text):
            writes.append(text)

        with mock.patch("sys.stdout.write", side_effect=capture_write), \
             mock.patch("sys.stdout.flush"), \
             mock.patch("src.cli.agent_skill_installer._read_key",
                        side_effect=EOFError):
            with self.assertRaises(EOFError):
                agent_skill._interactive_select(["a", "b", "c"])

        self.assertIn("\033[?25h", writes)


class TestSuccessMessageUsesConstant(unittest.TestCase):
    """Tests that user-facing messages use the SKILL_PACKAGE_NAME constant."""

    def test_remove_instruction_contains_skill_package_name(self):
        """Success message includes the correct skill package name for removal."""
        mock_agent = agent_skill.AgentDirectory(
            name="Test", config_directory=Path("/test"), skill_directory=Path("/test/skills"))

        with mock.patch("src.cli.agent_skill_installer.is_interactive_terminal", return_value=True), \
             mock.patch("src.cli.agent_skill_installer._is_prompt_declined", return_value=False), \
             mock.patch("src.cli.agent_skill_installer.detect_agents", return_value=[mock_agent]), \
             mock.patch("src.cli.agent_skill_installer.is_skill_installed", return_value=False), \
             mock.patch("src.cli.agent_skill_installer._prompt_install_choice",
                        return_value=agent_skill.INSTALL_YES), \
             mock.patch("src.cli.agent_skill_installer.find_npx", return_value="/usr/bin/npx"), \
             mock.patch("subprocess.run") as mock_run, \
             mock.patch("builtins.print") as mock_print:
            mock_run.return_value = mock.Mock(returncode=0)
            agent_skill.prompt_skill_installation()

        output = " ".join(str(arg) for call in mock_print.call_args_list for arg in call.args)
        self.assertIn("osmo skills uninstall", output)


class TestSetupParser(unittest.TestCase):
    """Tests for the skills subcommand parser registration."""

    def _create_parser_with_skills(self):
        parser = argparse.ArgumentParser()
        subparsers = parser.add_subparsers(dest="module")
        agent_skill.setup_parser(subparsers)
        return parser

    def test_skills_install_has_handler(self):
        """'skills install' subcommand is registered with a callable handler."""
        parser = self._create_parser_with_skills()
        args = parser.parse_args(["skills", "install"])
        self.assertTrue(callable(args.func))

    def test_skills_uninstall_has_handler(self):
        """'skills uninstall' subcommand is registered with a callable handler."""
        parser = self._create_parser_with_skills()
        args = parser.parse_args(["skills", "uninstall"])
        self.assertTrue(callable(args.func))


class TestInstallCommand(unittest.TestCase):
    """Tests for _install_command handler."""

    @staticmethod
    def _make_install_args(**overrides):
        defaults = {"prompt": False, "yes": False, "global_scope": False,
                     "agent": None, "copy": False}
        defaults.update(overrides)
        return mock.Mock(**defaults)

    def test_runs_install_when_npx_found(self):
        """Runs npx skills add directly when npx is available."""
        with mock.patch("src.cli.agent_skill_installer.find_npx",
                        return_value="/usr/bin/npx"), \
             mock.patch("subprocess.run") as mock_run, \
             mock.patch("builtins.print"):
            mock_run.return_value = mock.Mock(returncode=0)
            agent_skill._install_command(mock.Mock(), self._make_install_args())

        self.assertEqual(mock_run.call_args[0][0][:4],
                         ["/usr/bin/npx", "skills", "add", agent_skill.SKILLS_REGISTRY_PACKAGE])

    def test_prints_instructions_when_npx_missing(self):
        """Prints Node.js install instructions when npx not found."""
        with mock.patch("src.cli.agent_skill_installer.find_npx",
                        return_value=None), \
             mock.patch("src.cli.agent_skill_installer._print_npx_install_instructions"
                        ) as mock_instructions:
            agent_skill._install_command(mock.Mock(), self._make_install_args())

        mock_instructions.assert_called_once()

    def test_prints_failure_on_install_error(self):
        """Prints failure message when npx skills add fails."""
        with mock.patch("src.cli.agent_skill_installer.find_npx",
                        return_value="/usr/bin/npx"), \
             mock.patch("subprocess.run") as mock_run, \
             mock.patch("builtins.print") as mock_print:
            mock_run.return_value = mock.Mock(returncode=1)
            agent_skill._install_command(mock.Mock(), self._make_install_args())

        output = " ".join(str(arg) for call in mock_print.call_args_list for arg in call.args)
        self.assertIn("Installation failed", output)

    def test_with_prompt_flag_delegates_to_prompt_skill_installation(self):
        """With --prompt, delegates to prompt_skill_installation with guards."""
        with mock.patch("src.cli.agent_skill_installer.prompt_skill_installation"
                        ) as mock_prompt:
            agent_skill._install_command(mock.Mock(), self._make_install_args(prompt=True))

        mock_prompt.assert_called_once()

    def test_passes_yes_flag_to_npx(self):
        """--yes flag is forwarded to npx."""
        with mock.patch("src.cli.agent_skill_installer.find_npx",
                        return_value="/usr/bin/npx"), \
             mock.patch("subprocess.run") as mock_run, \
             mock.patch("builtins.print"):
            mock_run.return_value = mock.Mock(returncode=0)
            agent_skill._install_command(mock.Mock(), self._make_install_args(yes=True))

        command = mock_run.call_args[0][0]
        self.assertIn("--yes", command)

    def test_passes_global_flag_to_npx(self):
        """--global flag is forwarded to npx."""
        with mock.patch("src.cli.agent_skill_installer.find_npx",
                        return_value="/usr/bin/npx"), \
             mock.patch("subprocess.run") as mock_run, \
             mock.patch("builtins.print"):
            mock_run.return_value = mock.Mock(returncode=0)
            agent_skill._install_command(mock.Mock(), self._make_install_args(global_scope=True))

        command = mock_run.call_args[0][0]
        self.assertIn("--global", command)

    def test_passes_agent_flag_to_npx(self):
        """--agent flag is forwarded to npx."""
        with mock.patch("src.cli.agent_skill_installer.find_npx",
                        return_value="/usr/bin/npx"), \
             mock.patch("subprocess.run") as mock_run, \
             mock.patch("builtins.print"):
            mock_run.return_value = mock.Mock(returncode=0)
            agent_skill._install_command(
                mock.Mock(), self._make_install_args(agent=["claude-code", "cursor"]))

        command = mock_run.call_args[0][0]
        self.assertIn("--agent", command)
        self.assertIn("claude-code", command)
        self.assertIn("cursor", command)

    def test_passes_copy_flag_to_npx(self):
        """--copy flag is forwarded to npx."""
        with mock.patch("src.cli.agent_skill_installer.find_npx",
                        return_value="/usr/bin/npx"), \
             mock.patch("subprocess.run") as mock_run, \
             mock.patch("builtins.print"):
            mock_run.return_value = mock.Mock(returncode=0)
            agent_skill._install_command(mock.Mock(), self._make_install_args(copy=True))

        command = mock_run.call_args[0][0]
        self.assertIn("--copy", command)


class TestUninstallCommand(unittest.TestCase):
    """Tests for _uninstall_command handler."""

    @staticmethod
    def _make_uninstall_args(**overrides):
        defaults = {"yes": False, "global_scope": False, "agent": None}
        defaults.update(overrides)
        return mock.Mock(**defaults)

    def test_runs_remove_when_npx_found(self):
        """Runs npx skills remove when npx is available."""
        with mock.patch("src.cli.agent_skill_installer.find_npx",
                        return_value="/usr/bin/npx"), \
             mock.patch("subprocess.run") as mock_run, \
             mock.patch("builtins.print"):
            mock_run.return_value = mock.Mock(returncode=0)
            agent_skill._uninstall_command(mock.Mock(), self._make_uninstall_args())

        command = mock_run.call_args[0][0]
        self.assertEqual(command[:4],
                         ["/usr/bin/npx", "skills", "remove", agent_skill.SKILL_PACKAGE_NAME])

    def test_prints_instructions_when_npx_missing(self):
        """Prints manual uninstall command when npx is not found."""
        with mock.patch("src.cli.agent_skill_installer.find_npx",
                        return_value=None), \
             mock.patch("builtins.print") as mock_print:
            agent_skill._uninstall_command(mock.Mock(), self._make_uninstall_args())

        output = " ".join(str(arg) for call in mock_print.call_args_list for arg in call.args)
        self.assertIn(f"npx skills remove {agent_skill.SKILL_PACKAGE_NAME}", output)

    def test_prints_failure_on_nonzero_exit(self):
        """Prints failure message when npx skills remove fails."""
        with mock.patch("src.cli.agent_skill_installer.find_npx",
                        return_value="/usr/bin/npx"), \
             mock.patch("subprocess.run") as mock_run, \
             mock.patch("builtins.print") as mock_print:
            mock_run.return_value = mock.Mock(returncode=1)
            agent_skill._uninstall_command(mock.Mock(), self._make_uninstall_args())

        output = " ".join(str(arg) for call in mock_print.call_args_list for arg in call.args)
        self.assertIn("Removal failed", output)

    def test_passes_yes_and_global_flags(self):
        """--yes and --global flags are forwarded to npx."""
        with mock.patch("src.cli.agent_skill_installer.find_npx",
                        return_value="/usr/bin/npx"), \
             mock.patch("subprocess.run") as mock_run, \
             mock.patch("builtins.print"):
            mock_run.return_value = mock.Mock(returncode=0)
            agent_skill._uninstall_command(
                mock.Mock(), self._make_uninstall_args(yes=True, global_scope=True))

        command = mock_run.call_args[0][0]
        self.assertIn("--yes", command)
        self.assertIn("--global", command)


class TestLoginKeyboardInterrupt(unittest.TestCase):
    """Tests that KeyboardInterrupt during skill prompt doesn't crash login."""

    def test_keyboard_interrupt_caught_gracefully(self):
        """Ctrl+C during prompt should not propagate as unhandled exception."""
        with mock.patch("src.cli.login.agent_skill_installer") as mock_installer:
            mock_installer.prompt_skill_installation.side_effect = KeyboardInterrupt
            mock_service_client = mock.Mock()
            mock_args = mock.Mock()
            mock_args.url = "https://osmo.example.com"
            mock_args.method = "code"
            mock_args.device_endpoint = None
            mock_args.password_file = None

            # Should not raise
            login_module._login(mock_service_client, mock_args)


class TestPromptSkillInstallationIntegration(unittest.TestCase):
    """Integration tests for the full prompt flow using real temp directories.

    These simulate the 8 end-to-end scenarios: clean state, decline persistence,
    global install detection, project-scope install detection, and external removal.
    """

    def setUp(self):
        """Create isolated temp directories for home, project, and config."""
        self.temp_home_obj = tempfile.TemporaryDirectory()
        self.temp_project_obj = tempfile.TemporaryDirectory()
        self.temp_config_obj = tempfile.TemporaryDirectory()
        self.temp_home = Path(self.temp_home_obj.name)
        self.temp_project = Path(self.temp_project_obj.name)
        self.temp_config = self.temp_config_obj.name

        # Create agent directories so detect_agents() finds them
        (self.temp_home / ".claude").mkdir()
        (self.temp_home / ".agents").mkdir()

        # Common mock context for all tests
        self.home_patch = mock.patch("pathlib.Path.home", return_value=self.temp_home)
        self.cwd_patch = mock.patch("pathlib.Path.cwd", return_value=self.temp_project)
        self.config_patch = mock.patch(
            "src.cli.agent_skill_installer.client_configs.get_client_config_dir",
            return_value=self.temp_config,
        )
        self.tty_patch = mock.patch(
            "src.cli.agent_skill_installer.is_interactive_terminal", return_value=True,
        )

    def tearDown(self):
        self.temp_home_obj.cleanup()
        self.temp_project_obj.cleanup()
        self.temp_config_obj.cleanup()

    def _install_skill_global(self):
        """Simulate global install by creating SKILL.md in ~/.agents/skills/."""
        skill_dir = self.temp_home / ".agents" / "skills" / agent_skill.SKILL_PACKAGE_NAME
        skill_dir.mkdir(parents=True, exist_ok=True)
        (skill_dir / "SKILL.md").write_text("# osmo-agent")

    def _install_skill_project(self):
        """Simulate project-scope install by creating SKILL.md in <cwd>/.claude/skills/."""
        skill_dir = self.temp_project / ".claude" / "skills" / agent_skill.SKILL_PACKAGE_NAME
        skill_dir.mkdir(parents=True, exist_ok=True)
        (skill_dir / "SKILL.md").write_text("# osmo-agent")

    def _remove_skill_global(self):
        """Simulate external skill removal."""
        for agent_dir in [".claude", ".agents", ".codex"]:
            skill_path = self.temp_home / agent_dir / "skills" / agent_skill.SKILL_PACKAGE_NAME
            if skill_path.exists():
                shutil.rmtree(skill_path)

    def _remove_skill_project(self):
        """Simulate external project-scope skill removal."""
        for agent_dir in [".claude", ".agents", ".codex"]:
            skill_path = self.temp_project / agent_dir / "skills" / agent_skill.SKILL_PACKAGE_NAME
            if skill_path.exists():
                shutil.rmtree(skill_path)

    def _prompt_was_shown(self, choice=agent_skill.INSTALL_NOT_NOW):
        """Run prompt_skill_installation and return whether the prompt was displayed."""
        prompt_shown = False

        def fake_install_choice():
            nonlocal prompt_shown
            prompt_shown = True
            return choice

        with self.home_patch, self.cwd_patch, self.config_patch, self.tty_patch, \
             mock.patch("src.cli.agent_skill_installer._prompt_install_choice",
                        side_effect=fake_install_choice), \
             mock.patch("builtins.print"):
            agent_skill.prompt_skill_installation()

        return prompt_shown

    def test_case1_clean_state_shows_prompt(self):
        """No skill installed, no decline — prompt should be shown."""
        self.assertTrue(self._prompt_was_shown())

    def test_case2_dont_ask_again_persists_marker(self):
        """Choosing 'Don't ask again' creates a marker file in config dir."""
        self._prompt_was_shown(choice=agent_skill.INSTALL_NEVER)
        marker = os.path.join(self.temp_config, agent_skill.DECLINE_MARKER_FILE)
        self.assertTrue(os.path.exists(marker))

    def test_case3_second_attempt_after_dont_ask_again_skips(self):
        """After 'Don't ask again', the prompt is silenced on subsequent calls."""
        self._prompt_was_shown(choice=agent_skill.INSTALL_NEVER)
        self.assertFalse(self._prompt_was_shown())

    def test_case3b_not_now_does_not_persist_and_re_prompts(self):
        """Choosing 'Not now' does not save decline — prompt shows again next time."""
        self._prompt_was_shown(choice=agent_skill.INSTALL_NOT_NOW)
        marker = os.path.join(self.temp_config, agent_skill.DECLINE_MARKER_FILE)
        self.assertFalse(os.path.exists(marker))
        self.assertTrue(self._prompt_was_shown())  # Prompts again

    def test_case4_global_install_detected(self):
        """Skill installed globally is detected by is_skill_installed."""
        self._install_skill_global()
        with self.home_patch, self.cwd_patch:
            agents = agent_skill.detect_agents()
            self.assertTrue(any(agent_skill.is_skill_installed(a) for a in agents))

    def test_case5_prompt_skips_after_global_install(self):
        """Prompt is not shown when skill is installed globally."""
        self._install_skill_global()
        self.assertFalse(self._prompt_was_shown())

    def test_case6_external_removal_re_prompts(self):
        """After external skill removal, prompt shows again (no decline marker)."""
        self._install_skill_global()
        self.assertFalse(self._prompt_was_shown())  # Skipped — installed

        self._remove_skill_global()
        self.assertTrue(self._prompt_was_shown())  # Re-prompted — removed

    def test_case7_project_scope_install_detected(self):
        """Skill installed at project scope is detected by is_skill_installed."""
        self._install_skill_project()
        with self.home_patch, self.cwd_patch:
            agents = agent_skill.detect_agents()
            self.assertTrue(any(agent_skill.is_skill_installed(a) for a in agents))

    def test_case8_prompt_skips_after_project_install(self):
        """Prompt is not shown when skill is installed at project scope."""
        self._install_skill_project()
        self.assertFalse(self._prompt_was_shown())

    # Cross-interaction: CLI install ↔ login prompt

    def test_case9_global_install_via_cli_then_login_skips(self):
        """After 'osmo skills install' (global), login prompt is skipped."""
        self._install_skill_global()  # Simulates osmo skills install --global
        self.assertFalse(self._prompt_was_shown())  # Login doesn't re-prompt

    def test_case10_project_install_via_cli_then_login_skips(self):
        """After 'osmo skills install' (project), login prompt is skipped."""
        self._install_skill_project()  # Simulates osmo skills install (project scope)
        self.assertFalse(self._prompt_was_shown())  # Login doesn't re-prompt

    def test_case11_cli_uninstall_then_login_re_prompts(self):
        """After 'osmo skills uninstall', login prompt re-appears."""
        self._install_skill_global()
        self.assertFalse(self._prompt_was_shown())  # Installed — skipped

        self._remove_skill_global()  # Simulates osmo skills uninstall
        self.assertTrue(self._prompt_was_shown())  # Login re-prompts

    def test_case12_decline_at_cli_install_silences_login(self):
        """Declining via 'osmo skills install --prompt' also silences login prompt."""
        self._prompt_was_shown(choice=agent_skill.INSTALL_NEVER)  # Decline at install time
        self.assertFalse(self._prompt_was_shown())  # Login is silenced too

    def test_case13_not_now_at_cli_install_login_still_prompts(self):
        """'Not now' via CLI install does not silence login prompt."""
        self._prompt_was_shown(choice=agent_skill.INSTALL_NOT_NOW)  # Not now at install
        self.assertTrue(self._prompt_was_shown())  # Login still prompts

    def test_case14_decline_then_explicit_install_then_uninstall_re_prompts(self):
        """Full lifecycle: decline → explicit install → uninstall → re-prompt."""
        # User declines at first login
        self._prompt_was_shown(choice=agent_skill.INSTALL_NEVER)
        self.assertFalse(self._prompt_was_shown())  # Silenced

        # User later runs 'osmo skills install' explicitly (global)
        self._install_skill_global()
        self.assertFalse(self._prompt_was_shown())  # Installed — skipped

        # User uninstalls externally
        self._remove_skill_global()
        # Decline marker still exists, so login stays silenced
        self.assertFalse(self._prompt_was_shown())

    def test_case15_install_in_different_project_login_still_skips(self):
        """Skill installed in one project scope, login skips in that project."""
        self._install_skill_project()
        self.assertFalse(self._prompt_was_shown())

    def test_case16_remove_project_skill_global_still_installed(self):
        """Removing project skill while global is installed — login still skips."""
        self._install_skill_global()
        self._install_skill_project()
        self._remove_skill_project()
        self.assertFalse(self._prompt_was_shown())  # Global still there

    def test_case17_remove_global_skill_project_still_installed(self):
        """Removing global skill while project is installed — login still skips."""
        self._install_skill_global()
        self._install_skill_project()
        self._remove_skill_global()
        self.assertFalse(self._prompt_was_shown())  # Project still there

    def test_case18_remove_both_scopes_login_re_prompts(self):
        """Removing skill from both scopes — login re-prompts."""
        self._install_skill_global()
        self._install_skill_project()
        self._remove_skill_global()
        self._remove_skill_project()
        self.assertTrue(self._prompt_was_shown())  # Both gone — re-prompt


if __name__ == "__main__":
    unittest.main()
