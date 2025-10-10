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
import pathlib
import sys

import fastapi
import fastapi.staticfiles
import uvicorn  # type: ignore

from docs.service import objects


app = fastapi.FastAPI(docs_url='/api/docs')
app_dir = os.path.dirname(os.path.abspath(__file__))

def main():
    config = objects.DocsConfig.load()

    docs_dir = f'{pathlib.Path(app_dir).parent}/_internal/docs'
    if config.docs_dir:
        docs_dir = str(pathlib.Path(config.docs_dir).parent)

    # Mount the user docs
    app.mount('/docs',
              fastapi.staticfiles.StaticFiles(directory=f'{docs_dir}/user_docs',
                                              html=True), name='user-docs')
    # Mount the setup docs
    app.mount('/setup',
              fastapi.staticfiles.StaticFiles(directory=f'{docs_dir}/deployment_docs',
                                              html=True), name='deployment-docs')

    try:
        uvicorn.run(app, host=config.host, port=config.port)
    except KeyboardInterrupt:
        sys.exit(0)


if __name__ == '__main__':
    main()
