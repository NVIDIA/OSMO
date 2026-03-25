# SPDX-FileCopyrightText: Copyright (c) 2025-2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: Apache-2.0

from coverage_agent.plugins.base import (
    GeneratedTest,
    TestType,
    ValidationResult,
    WriterPlugin,
    detect_test_type,
    determine_test_path,
    file_path_to_bazel_package,
)

PLUGINS: dict[str, type[WriterPlugin]] = {}
_instances: dict[str, WriterPlugin] = {}


def register_plugin(name: str, plugin_class: type[WriterPlugin]) -> None:
    PLUGINS[name] = plugin_class


def get_writer(provider: str) -> WriterPlugin:
    """Return a cached plugin instance for the given provider."""
    if provider not in PLUGINS:
        raise KeyError(f"Unknown provider: {provider}. Available: {list(PLUGINS.keys())}")
    if provider not in _instances:
        _instances[provider] = PLUGINS[provider]()
    return _instances[provider]


def _register_defaults() -> None:
    """Lazily register built-in plugins to avoid import-time deps on langchain/openai."""
    if PLUGINS:
        return
    from coverage_agent.plugins.claude_code import ClaudeCodeWriter
    from coverage_agent.plugins.nemotron import NemotronWriter
    from coverage_agent.plugins.openai_writer import OpenAIWriter

    register_plugin("nemotron", NemotronWriter)
    register_plugin("claude-code", ClaudeCodeWriter)
    register_plugin("openai", OpenAIWriter)
