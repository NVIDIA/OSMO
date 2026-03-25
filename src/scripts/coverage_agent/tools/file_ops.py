# SPDX-FileCopyrightText: Copyright (c) 2025-2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.  # pylint: disable=line-too-long
# SPDX-License-Identifier: Apache-2.0
"""File read and write operations with error handling."""

import os


def read_file(path: str) -> str:
    """Read a file and return its contents. Returns error message if file not found."""
    try:
        with open(path, encoding="utf-8") as file:
            return file.read()
    except FileNotFoundError:
        return f"Error: File not found: {path}"
    except PermissionError:
        return f"Error: Permission denied: {path}"


def write_file(path: str, content: str) -> str:
    """Write content to a file, creating parent directories if needed."""
    try:
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w", encoding="utf-8") as file:
            file.write(content)
        return f"Written {len(content)} bytes to {path}"
    except OSError as exception:
        return f"Error writing {path}: {exception}"
