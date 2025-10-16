#
# This file is derived from https://github.com/jbms/sphinx-immaterial/blob/main/sphinx_immaterial/code_annotations.py.
# Copyright 2021 The Sphinx-Immaterial Authors.
# Licensed under the MIT License.
#
# SPDX-FileCopyrightText: Copyright (c) 2025 NVIDIA CORPORATION. All rights reserved.
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
# http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.
#
# SPDX-License-Identifier: Apache-2.0


"""Defines HTMLTranslatorMixin for overriding HTML translation.

Other extensions included with this theme add methods to the mixin.
"""

from typing import TYPE_CHECKING, Callable, List, Type, TypeVar

import docutils.nodes
import sphinx.writers.html5
from sphinx.application import Sphinx

if TYPE_CHECKING:
    HTMLTranslatorMixinBase = sphinx.writers.html5.HTML5Translator
else:
    HTMLTranslatorMixinBase = object


class HTMLTranslatorMixin(HTMLTranslatorMixinBase):
    pass


InitCallback = Callable[[HTMLTranslatorMixin], None]

_init_callbacks: List[InitCallback] = []


Element = TypeVar("Element", bound=docutils.nodes.Element)

BaseVisitCallback = Callable[
    [HTMLTranslatorMixin, Element],
    None,
]

VisitCallback = Callable[
    [
        HTMLTranslatorMixin,
        Element,
        BaseVisitCallback[Element],
    ],
    None,
]


def _override_visit_or_depart(method: str, callback: VisitCallback) -> None:
    prev_func = getattr(HTMLTranslatorMixin, method, None)

    def super_func(
        self: sphinx.writers.html5.HTML5Translator, node: docutils.nodes.Element
    ):
        if prev_func is not None:
            prev_func(self, node)
            return
        super_func = getattr(super(HTMLTranslatorMixin, self), method, None)
        if super_func is not None:
            super_func(node)

    def handler(self: HTMLTranslatorMixin, node: docutils.nodes.Element) -> None:
        callback(self, node, super_func)

    setattr(HTMLTranslatorMixin, method, handler)


def override(callback: VisitCallback):
    _override_visit_or_depart(callback.__name__, callback)


def init(callback: Callable[[HTMLTranslatorMixin], None]):
    _init_callbacks.append(callback)


def get_html_translator(
    base_translator: Type[sphinx.writers.html5.HTML5Translator],
) -> Type[sphinx.writers.html5.HTML5Translator]:
    class CustomHTMLTranslator(
        HTMLTranslatorMixin,
        base_translator,  # type: ignore
    ):
        def __init__(self, *args, **kwargs):
            super().__init__(*args, **kwargs)

            # Ensure all tables are marked as data tables.  The material CSS only
            # applies to tables with this class, in order to leave tables used for
            # layout purposes alone.
            self.settings.table_style = ",".join(
                self.settings.table_style.split(",") + ["data"]
            )

            for callback in _init_callbacks:
                callback(self)

    return CustomHTMLTranslator


def setup(app: Sphinx):
    """
    Set up the HTML translator mixin extension.
    """

    def on_builder_inited(app: Sphinx):
        """
        Hook to set the custom HTML translator after builder initialization.
        """
        if app.builder.name == 'html' or app.builder.name.startswith('html'):
            base_translator = app.builder.get_translator_class()
            custom_translator = get_html_translator(base_translator)
            app.set_translator(app.builder.name, custom_translator, override=True)

    app.connect('builder-inited', on_builder_inited)

    return {
        'parallel_read_safe': True,
        'parallel_write_safe': True,
    }
