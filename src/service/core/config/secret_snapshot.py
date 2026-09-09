"""Coherent reads and cheap change detection for mounted config dependencies.

SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
SPDX-License-Identifier: Apache-2.0
"""

import dataclasses
import os
from pathlib import Path


class DependencyReadError(ValueError):
    """Safe to report: deliberately contains no file contents or exception text."""


class DependencyChangedError(DependencyReadError):
    """A previously observed dependency changed; retry with a fresh snapshot."""


def _file_signature(path: Path) -> tuple:
    info = path.stat()
    return (info.st_dev, info.st_ino, info.st_mtime_ns, info.st_ctime_ns, info.st_size)


def _signature(path: Path) -> tuple:
    """Bounded metadata reads; never recursively scan a dependency tree."""
    signature = _file_signature(path)
    if path.is_dir():
        return signature + (tuple(
            (entry.name, _file_signature(entry))
            for entry in sorted(path.iterdir()) if not entry.name.startswith('..')
        ),)
    return signature


@dataclasses.dataclass
class DependencySnapshot:
    """Provenance only, never credential values; one instance per candidate."""

    signatures: dict[Path, tuple] = dataclasses.field(default_factory=dict)
    projections: dict[Path, Path] = dataclasses.field(default_factory=dict)

    def _track(self, path: Path) -> None:
        signature = _signature(path)
        previous = self.signatures.setdefault(path, signature)
        if previous != signature:
            raise DependencyChangedError('Configuration dependency changed during read')

    def _pin(self, path: Path) -> Path:
        # Find the mounted volume root even for an explicit key in a subdirectory.
        for parent in (path, *path.parents):
            link = parent / '..data'
            if link.is_symlink():
                self._track(link)
                target = self.projections.setdefault(parent, link.resolve(strict=True))
                if not target.is_relative_to(parent.resolve()):
                    raise DependencyReadError('Invalid projected dependency path')
                pinned = target / path.relative_to(parent)
                if not pinned.resolve(strict=True).is_relative_to(target):
                    raise DependencyReadError('Invalid projected dependency key')
                return pinned
        return path

    def read_file(self, path: str) -> str:
        try:
            source = Path(os.path.abspath(path))
            pinned = self._pin(source)
            self._track(source)
            content = pinned.read_text(encoding='utf-8')
            self._track(source)
            return content
        except (OSError, UnicodeError, RuntimeError):
            if self.signatures and not self.unchanged():
                raise DependencyChangedError(
                    'Configuration dependency changed during read') from None
            raise DependencyReadError('Unable to read configuration dependency') from None

    def read_directory(self, path: str) -> dict[str, str]:
        try:
            source = Path(os.path.abspath(path))
            pinned = self._pin(source)
            self._track(source)
            fields = {}
            for entry in sorted(pinned.iterdir()):
                if entry.name.startswith('..'):
                    continue
                if not entry.is_file() or not entry.resolve().is_relative_to(pinned.resolve()):
                    raise DependencyReadError('Invalid credential field')
                fields[entry.name] = entry.read_text(encoding='utf-8').rstrip('\n')
            self._track(source)
            return fields
        except (OSError, UnicodeError, RuntimeError):
            if self.signatures and not self.unchanged():
                raise DependencyChangedError(
                    'Configuration dependency changed during read') from None
            raise DependencyReadError('Unable to read credential dependency') from None

    def unchanged(self) -> bool:
        try:
            return all(_signature(path) == value for path, value in self.signatures.items())
        except (OSError, RuntimeError):
            return False
