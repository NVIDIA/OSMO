<!--
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
-->

# NVIDIA OSMO - Documentation

This is the source code for public documentation about OSMO. The documentation generates both a
static HTML website and markdown files.

## Building the Documentation

You can build the docs by running the following in this directory:

```bash
make build
```

Then you can open the generated HTML and markdown files in your browser. You can find the generated
files in `~/path/to/osmo/docs/_build/public/`. The `public/` directory includes:

- **`out/`** - The generated HTML and markdown files
- **`err/`** - Any warnings or errors produced by the build process

Check if there are any misspelled words with:

```bash
make spelling
```
