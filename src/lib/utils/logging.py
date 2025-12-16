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

"""
Logging utilities.
"""

import contextvars
import contextlib
import datetime
import enum
import functools
import inspect
import logging
import logging.handlers
import os
import queue
import threading
from typing import (
    Callable,
    Concatenate,
    Generator,
    List,
    Optional,
    ParamSpec,
    Protocol,
    Set,
    Type,
    TypeVar,
)
from typing_extensions import Self, assert_never

import pydantic


logger = logging.getLogger(__name__)


class LoggingLevel(enum.IntEnum):
    """
    Logging level enum.
    """
    CRITICAL = logging.CRITICAL
    ERROR = logging.ERROR
    WARNING = logging.WARNING
    INFO = logging.INFO
    DEBUG = logging.DEBUG

    # Aliases
    FATAL = CRITICAL
    WARN = WARNING

    @classmethod
    def parse(cls, value: str | int) -> Self:
        match value:
            case str() as s:
                if s.isdigit():
                    return cls(int(s))
                else:
                    try:
                        return cls.__members__[s.strip().upper()]
                    except KeyError as error:
                        valid_levels = ', '.join(cls.__members__.keys())
                        raise ValueError(
                            f'Invalid logging level: "{s}". Valid levels are: {valid_levels}',
                        ) from error
            case int():
                return cls(value)
            case _ as unreachable:
                assert_never(unreachable)


class WorkflowLogFilter(logging.Filter):
    """
    Sets the workflow_uuid attribute on the log record. If the workflow_uuid attribute is already
    set via the extra parameter, it will not be overridden.

    When used with ServiceFormatter, wf_uuid is injected into the log message.

    When used via WorkflowLogContext, the workflow_uuid attribute is set on all log records.
    """

    def __init__(self, workflow_uuid: str = ''):
        super().__init__()
        self._workflow_uuid = workflow_uuid

    def filter(self, record):
        if self._workflow_uuid and not hasattr(record, 'workflow_uuid'):
            setattr(record, 'workflow_uuid', self._workflow_uuid)
        return True


class WorkflowLogContext:
    """
    Log context for automatically setting the workflow_uuid attribute on the log record.

    All logging, even within subfunctions, inside this context will have the workflow ID
    attribute included with the log. Users should only use this for single threaded instances.
    If 'extra' parameter is used when using logging inside the context, the workflow_uuid attribute
    will not be overridden.
    """

    def __init__(self, workflow_uuid: str):
        self.workflow_uuid = workflow_uuid
        self._filter = WorkflowLogFilter(workflow_uuid)

    def __enter__(self):
        if self.workflow_uuid:
            logging.getLogger().addFilter(self._filter)
        return self

    def __exit__(self, ex_type, ex_value, ex_traceback):
        # pylint: disable=unused-argument
        if self.workflow_uuid:
            logging.getLogger().removeFilter(self._filter)


class LoggingConfig(pydantic.BaseModel):
    """Manages the logging configuration"""
    log_level: LoggingLevel = pydantic.Field(
        command_line='log_level',
        default=LoggingLevel.INFO,
        description='The level of logging errors messages to record.')
    log_dir: Optional[str] = pydantic.Field(
        command_line='log_dir',
        default=None,
        description='The directory to write logs to.')
    log_name: str = pydantic.Field(
        command_line='log_name',
        default='',
        description='The name of the log file.')
    k8s_log_level: LoggingLevel = pydantic.Field(
        command_line='k8s_log_level',
        default=LoggingLevel.WARNING,
        description='The level of k8s logging errors messages to record.')

    @pydantic.validator('log_level', 'k8s_log_level', pre=True)
    @classmethod
    def _parse_logging_levels(cls, v) -> LoggingLevel:
        return LoggingLevel.parse(v)


class ServiceFormatter(logging.Formatter):
    """
    Formats log records for the service. Time is formatted in ISO 8601 format including
    milliseconds. If the workflow_uuid attribute is set, the workflow_uuid_formatted attribute
    is set to wf_uuid=<workflow_uuid><space>.
    """

    def formatTime(self, record, datefmt=None):
        # pylint: disable=unused-argument
        # pylint: disable=invalid-name
        """
        Format the time of the record in ISO 8601 format including milliseconds.
        """
        return datetime.datetime.fromtimestamp(record.created).astimezone().isoformat(
            timespec='milliseconds')

    def format(self, record):
        """
        Format the record. Before formatting, set the workflow_uuid_formatted attribute to
        wf_uuid=<workflow_uuid> if the workflow_uuid exists as an attribute.

        Note: formatters can be called multiple times for each handler, so do not modify
        the msg attribute before formatting.
        """
        if hasattr(record, 'workflow_uuid') and record.workflow_uuid:
            setattr(record, 'workflow_uuid_formatted', f'wf_uuid={record.workflow_uuid} ')
        else:
            # Omit if workflow_uuid is not set by setting to an empty string
            setattr(record, 'workflow_uuid_formatted', '')
        return super().format(record)


def init_logger(
    name: str,
    config: LoggingConfig,
    default_handler: logging.Handler | None = None,
    start_message: bool = True,
    extra_handlers: Optional[List] = None,
):
    handlers: List[logging.Handler] = [default_handler or logging.StreamHandler()]
    if config.log_dir is not None:
        os.makedirs(config.log_dir, exist_ok=True)

        # Add a timestamp to the filename to make it easier to associate the log file with
        # the service.
        now = datetime.datetime.now()
        # Replace colons with dashes for CloudWatch log stream compatibility.
        timestamp = now.isoformat(sep='_', timespec='seconds').replace(':', '-')
        log_name = config.log_name if config.log_name else name
        # Add process ID to the filename to avoid log file name collisions when multiple
        # processes exist. FileHandler is thread-safe but not process-safe.
        pid = os.getpid()
        file_path = os.path.join(config.log_dir, f'{timestamp}_{pid}_{log_name}.txt')

        handlers.append(logging.FileHandler(file_path, encoding='utf-8'))
    if extra_handlers:
        handlers += extra_handlers

    formatter = ServiceFormatter(
        f'%(asctime)s {name} [%(levelname)s] %(module)s: %(workflow_uuid_formatted)s%(message)s')
    for handler in handlers:
        handler.setFormatter(formatter)

    root_logger = logging.getLogger()
    root_logger.setLevel(config.log_level.name)
    for handler in handlers:
        root_logger.addHandler(handler)

    if start_message:
        logging.info('Starting service ...')
    # Disable the printing of the response body
    logging.getLogger('kubernetes.client.rest').setLevel(config.k8s_log_level.name)


def get_backend_logger(name: str, backend: str, config: LoggingConfig) -> logging.Logger:
    if name in logging.Logger.manager.loggerDict:
        return logging.getLogger(name)

    event_logger = logging.getLogger(name)
    if config.log_dir is not None:
        if not os.path.exists(config.log_dir):
            os.makedirs(config.log_dir)

        # The service worker is single-process, so no need to use a microsecond timestamp.
        log_name = config.log_name if config.log_name else name
        file_path = os.path.join(config.log_dir, f'{log_name}.txt')

        event_log_handler = logging.FileHandler(file_path, encoding='utf-8')
        event_log_handler.setLevel(config.log_level.name)

        formatter = ServiceFormatter(
            f'%(asctime)s {name} [%(levelname)s] {backend}: %(workflow_uuid_formatted)s%(message)s')
        event_log_handler.setFormatter(formatter)
        event_logger.addHandler(event_log_handler)

    # Do not send logs to main logger
    event_logger.propagate = False

    return event_logger


# Utility classes and functions for scoping the log level of a "context".
# This allows the log level for all loggers of a Python context (e.g. a function call stack) to
# be scoped to a desired log level.

_scoped_log_level = contextvars.ContextVar(
    'scoped_log_level',
    default=logging.ERROR,
)


class _ScopedFilter(logging.Filter):
    """
    Filter logs to the scoped log level.
    """

    def filter(self, record) -> bool:
        """
        Filter the log record.
        """
        level = _scoped_log_level.get()
        if level is None:
            return True
        return record.levelno >= level


@contextlib.contextmanager
def scoped_log_level(level: int):
    """
    Context manager for logging.
    """
    previous_level = _scoped_log_level.set(level)
    scoped_filter = _ScopedFilter()

    handlers: Set[logging.Handler] = set()
    root_logger = logging.getLogger()

    for h in root_logger.handlers:
        handlers.add(h)

    for logger_obj in logging.Logger.manager.loggerDict.values():
        if isinstance(logger_obj, logging.Logger):
            for h in logger_obj.handlers:
                handlers.add(h)

    for h in handlers:
        h.addFilter(scoped_filter)

    try:
        yield
    finally:
        for h in handlers:
            h.removeFilter(scoped_filter)
        _scoped_log_level.reset(previous_level)


class ScopedLogger(Protocol):
    """
    Protocol for objects that can be scoped to a log level.
    """

    @property
    def logging_level(self) -> int:
        ...


P = ParamSpec('P')  # Parameter specification of the decorated function
R = TypeVar('R')    # Return type of the decorated function
L = TypeVar('L', bound=ScopedLogger)  # Self type of the decorated function


def scope_logging(cls: Type[L]) -> Type[L]:
    """
    Decorator to scope the log level of a class that implements the ScopedLogger protocol.

    All instance methods will be scoped to the log level.

    Example usage:

    ```python
    import logging

    logger = logging.getLogger(__name__)

    @logging_utils.scope_logging
    class MyClass:
        def __init__(self, logging_level: int):
            self._logging_level = logging_level

        # IMPORTANT: This property is required to be defined in the class.
        @property
        def logging_level(self) -> int:
            return self._logging_level

        def my_method(self):
            logger.debug('Debug log message')
            logger.info('Info log message')
            logger.warning('Warning log message')
            logger.error('Error log message')
            logger.critical('Critical log message')


    my_class_info = MyClass(logging_level=logging.INFO)
    my_class_info.my_method()

    # Output:
    # INFO:my_class:Info log message
    # WARNING:my_class:Warning log message
    # ERROR:my_class:Error log message
    # CRITICAL:my_class:Critical log message

    my_class_error = MyClass(logging_level=logging.ERROR)
    my_class_error.my_method()

    # Output:
    # ERROR:my_class:Error log message
    # CRITICAL:my_class:Critical log message
    ```

    :param obj: The ScopedLogger class to decorate.
    :return: The decorated object.
    """
    def _decorate(obj: Type[L]) -> Type[L]:

        # Create a wrapper to scope the log level of an instance method.
        def _wrap_instance(fn: Callable[Concatenate[L, P], R]) -> Callable[Concatenate[L, P], R]:
            @functools.wraps(fn)
            def _wrap(self: L, *args: P.args, **kwargs: P.kwargs) -> R:
                with scoped_log_level(self.logging_level):
                    return fn(self, *args, **kwargs)
            return _wrap

        # Apply the wrappers to the object's methods.
        for name, attr in inspect.getmembers(obj, predicate=inspect.isfunction):
            if name.startswith('__') and name.endswith('__'):
                # Skip dunder methods (__init__, __repr__, etc.)
                continue
            # Only wrap methods defined in this class, not inherited ones
            if name in obj.__dict__:
                setattr(obj, name, _wrap_instance(attr))
        return obj

    return _decorate(cls)


def configure_process_worker_logging(log_queue: queue.Queue[logging.LogRecord | None]) -> None:
    """
    Configure the logging to write to the log queue handler.

    To be used in a process worker in a multiprocess job.
    """
    h = logging.handlers.QueueHandler(log_queue)
    root = logging.getLogger()
    root.addHandler(h)


@contextlib.contextmanager
def multiprocess_logging_listener(
    log_queue: queue.Queue[logging.LogRecord | None],
) -> Generator[None, None, None]:
    """
    Context manager for listening to the log queue and dispatching the log records to the
    appropriate loggers.
    """
    def _dispatch_thread() -> None:
        while True:
            record = log_queue.get()
            if record is None:
                break
            dispatch_logger = logging.getLogger(record.name)
            try:
                dispatch_logger.handle(record)
            except Exception as error:  # pylint: disable=broad-except
                logger.error('Error handling log record: %s', error)

    dispatch_thread = threading.Thread(target=_dispatch_thread, daemon=True)
    dispatch_thread.start()

    try:
        yield
    finally:
        log_queue.put(None)
        dispatch_thread.join()
