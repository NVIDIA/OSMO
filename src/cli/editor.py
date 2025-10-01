"""
SPDX-FileCopyrightText: Copyright (c) 2025 NVIDIA CORPORATION & AFFILIATES. All rights reserved.

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

import os
import shutil
import subprocess
import sys
import tempfile

from src.lib.utils import osmo_errors


def get_default_editor() -> str:
    """Get the default editor to use based on environment variables and platform."""
    # Check environment variables
    editor = os.environ.get('EDITOR') or os.environ.get('VISUAL')
    if editor:
        return editor

    # Platform-specific fallbacks
    if sys.platform.startswith('win'):
        return 'notepad'
    elif sys.platform.startswith('darwin'):
        return 'open -e'  # Opens TextEdit
    else:
        # Try common editors
        for candidate in ['vi', 'nano']:
            if shutil.which(candidate):
                return candidate
        return 'vi'  # Default fallback


def get_editor_input(content: str | None= None) -> str:
    """
    Get input from the user's default editor.

    Args:
        content: Optional initial content to show in the editor

    Returns:
        The edited content, or None if editor not found
    """
    editor = get_default_editor()
    with tempfile.NamedTemporaryFile(suffix='.tmp', delete=False) as tf:
        if content:
            tf.write(content.encode())
            tf.flush()
        try:
            subprocess.call([editor, tf.name])
        except FileNotFoundError as e:
            raise osmo_errors.OSMOUserError(
                'Error: Editor not found. Please set the EDITOR environment variable.') from e
        with open(tf.name, 'r', encoding='utf-8') as f:
            content = f.read()
    return content


def save_to_temp_file(content: str, prefix: str = 'osmo_', suffix: str = '.json',
                      directory: str = '.') -> str:
    """
    Save content to a temporary file in the current directory.

    Args:
        content: The content to save
        prefix: Prefix for the temporary filename
        suffix: Suffix for the temporary filename

    Returns:
        Path to the temporary file
    """
    with tempfile.NamedTemporaryFile(
        prefix=prefix,
        suffix=suffix,
        dir=directory,
        delete=False,
        mode='w',
        encoding='utf-8'
    ) as temp_file:
        temp_file.write(content)
        return temp_file.name
