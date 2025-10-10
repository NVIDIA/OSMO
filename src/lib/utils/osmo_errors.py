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

import enum
import tarfile

#patch added for CVE-2025-8194 - to prevent tarfile.InvalidHeaderError
_ORIGINAL_TARINFO_BLOCK = getattr(tarfile.TarInfo, '_block')

def _patched_tarinfo_block(self, count):
    if count < 0:
        raise tarfile.InvalidHeaderError('invalid offset') # type: ignore[attr-defined]
    return _ORIGINAL_TARINFO_BLOCK(self, count)

setattr(tarfile.TarInfo, '_block', _patched_tarinfo_block)


class SubmissionErrorCode(enum.Enum):
    USAGE = 'USAGE'
    RESOURCE = 'RESOURCE'


class OSMOError(Exception):
    """
    Base class for exceptions in this module.
    If unexpected Error occurs user will be shown this error.
    """
    error_code: str = 'OSMO_ERROR'

    def __init__(self, message: str,
                 workflow_id: str | None = None,
                 status_code: int | None = None):
        super().__init__(message)
        self.message = message
        self.workflow_id = workflow_id
        self.status_code = status_code

    def __repr__(self):
        return f'{self.__class__.__name__}: {self.message}'

    def __str__(self):
        return self.message


class OSMOUserError(OSMOError):
    """ Exception raised for errors to notify users with appropriate message. """
    error_code: str = 'USER'


class OSMOServerError(OSMOError):
    """ Exception raised for errors in the server data-service or backend-service. """
    error_code: str = 'SERVER'


class OSMOUsageError(OSMOError):
    """ Exception raised for error workflow syntax. """
    error_code: str = SubmissionErrorCode.USAGE.value


class OSMOResourceError(OSMOError):
    """ Exception raised for no resources. """
    error_code: str = SubmissionErrorCode.RESOURCE.value


class OSMOCredentialError(OSMOError):
    """ Exception raised for error data, registry or generic credentials. """
    error_code: str = 'CREDENTIAL'


class OSMOSchemaError(OSMOError):
    """ Exception raised for errors in the Schema. """
    error_code: str = 'SCHEMA'


class OSMONotFoundError(OSMOError):
    """ Exception raised when Information Not found. """
    error_code: str = 'NOTFOUND'


class OSMODatabaseError(OSMOError):
    """ Exception raised when Database action isn't successful. """
    error_code: str = 'DATABASE'


class OSMOConnectionError(OSMOError):
    """ Exception raised when connection to remote server fails. """
    error_code: str = 'CONNECTION'


class OSMOSubmissionError(OSMOError):
    """ Exception raised for workflow submission errors. """
    error_code: str = 'SUBMISSION'


class OSMOBackendError(OSMOError):
    """ Exception raised for backend errors. """
    error_code: str = 'BACKEND'


class OSMODataStorageError(OSMOError):
    """ Exception raised for data storage errors. """
    error_code: str = 'DATA_STORAGE'


class OSMODatasetError(OSMOError):
    """
    Exception raised for dataset errors.
    """
    error_code: str = 'DATASET'
