# SPDX-FileCopyrightText: Copyright (c) 2025 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
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

# Minimal makefile for Sphinx documentation
#

# You can set these variables from the command line, and also
# from the environment for the first two.
SPHINXOPTS  ?=
SPHINXBUILD ?= sphinx-build
SOURCEDIR   = .
OUT_DIR     = _build/public/out
ERR_DIR     = _build/public/err

# Put it first so that "make" without argument is like "make help".
help:
	@$(SPHINXBUILD) -M help "$(SOURCEDIR)" "$(BUILDDIR)" $(SPHINXOPTS) $(O)

.PHONY: help generate build generate-and-build Makefile

build:
	export OSMO_DOMAIN=public && sphinx-build -b html user_guide -w $(ERR_DIR)/user_guide.log  $(OUT_DIR)/user_guide
	export OSMO_DOMAIN=public && sphinx-build -b html deployment_guide -w $(ERR_DIR)/deployment_guide.log $(OUT_DIR)/deployment_guide
	export OSMO_DOMAIN=public && sphinx-build -b markdown user_guide $(OUT_DIR)/user_guide -w $(ERR_DIR)/user_guide_markdown.log
	export OSMO_DOMAIN=public && sphinx-build -b markdown deployment_guide $(OUT_DIR)/deployment_guide -w $(ERR_DIR)/deployment_guide_markdown.log
	rm -rf $(OUT_DIR)/user_guide/_sources
	rm -rf $(OUT_DIR)/deployment_guide/_sources


spelling:
	export OSMO_DOMAIN=public && sphinx-build -b spelling -j auto -w $(ERR_DIR)/user_guide.log -N user_guide $(OUT_DIR)/user_guide
	export OSMO_DOMAIN=public && sphinx-build -b spelling -j auto -w $(ERR_DIR)/deployment_guide.log -N deployment_guide $(OUT_DIR)/deployment_guide


# Catch-all target: route all unknown targets to Sphinx using the new
# "make mode" option.  $(O) is meant as a shortcut for $(SPHINXOPTS).
%: Makefile
	@$(SPHINXBUILD) -M $@ "$(SOURCEDIR)" "$(OUT_DIR)" $(SPHINXOPTS) $(O)
