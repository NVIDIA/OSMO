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
from typing import Any, Dict, Literal, Union

from opentelemetry import metrics
from opentelemetry.exporter.otlp.proto.grpc.metric_exporter import OTLPMetricExporter
from opentelemetry.sdk.resources import Resource, Attributes
from opentelemetry.sdk.metrics import MeterProvider
from opentelemetry.sdk.metrics.view import View, ExplicitBucketHistogramAggregation
from opentelemetry.sdk.metrics.export import (
    PeriodicExportingMetricReader, ConsoleMetricExporter
)
import pydantic

from src.lib.utils import osmo_errors, version


DEFAULT_INTERVAL_IN_MILLISECONDS = 6000

class InstrumentType(enum.Enum):
    """Describes the execution status of a job"""
    # sync instruments
    COUNTER = 1
    UP_DOWN_COUNTER = 2
    HISTOGRAM = 3
    # async instruments
    OBSERVABLE_GAUGE = 4
    OBSERVABLE_COUNTER = 5
    OBSERVABLE_UP_DOWN_COUNTER = 6


class MetricsCreatorConfig(pydantic.BaseModel):
    """ Manages the config for the Metrics Creator. """
    metrics_otel_collector_host: str = pydantic.Field(
        command_line='metrics_otel_collector_host',
        env='METRICS_OTEL_COLLECTOR_HOST',
        default='localhost',
        description='The hostname of the OTEL collector to connect to.')
    metrics_otel_collector_port: int = pydantic.Field(
        command_line='metrics_otel_collector_port',
        env='METRICS_OTEL_COLLECTOR_PORT',
        default=12345,
        description='The port of the OTEL collector to connect to.')
    metrics_otel_collector_interval_in_millis: int = pydantic.Field(
        command_line='metrics_otel_collector_interval_in_millis',
        env='METRICS_OTEL_COLLECTOR_INTERVAL_IN_MILLIS',
        default=DEFAULT_INTERVAL_IN_MILLISECONDS,
        description='The interval in which the otel collector sends values')
    metrics_otel_collector_component: str = pydantic.Field(
        command_line='metrics_otel_collector_component',
        env='METRICS_OTEL_COLLECTOR_COMPONENT',
        default='osmo_service_component',
        description='The osmo service component')
    metrics_otel_enable: bool = pydantic.Field(
        command_line='metrics_otel_enable',
        env='METRICS_OTEL_ENABLE',
        default=True,
        description='If set false, will disable metrics')
    method: Literal['dev'] | None = pydantic.Field(
        command_line='method',
        default=None,
        description='If set to "dev", use ConsoleMetricExporter')

    @property
    def metrics_url(self):
        return f'http://{self.metrics_otel_collector_host}:{self.metrics_otel_collector_port}/'

class MetricCreator:
    """
    An osmo specific metric creator class
    """
    _meter_instance = None

    @staticmethod
    def get_meter_instance():
        """ Static access method. """
        if not MetricCreator._meter_instance:
            raise osmo_errors.OSMOError(
                'MetricCreator has not been created!')
        return MetricCreator._meter_instance

    def __init__(self, config: MetricsCreatorConfig):
        # pylint: disable=consider-using-with
        if MetricCreator._meter_instance:
            raise osmo_errors.OSMOError(
                'Only one instance of MetricCreator can exist!')
        self._config = config
        # get value from env to test in dev
        exporter: Any = OTLPMetricExporter(endpoint=config.metrics_url, insecure=True)
        if self._config.method == 'dev':
            exporter = ConsoleMetricExporter(
                out=open('/dev/null', 'w', encoding='utf-8')
            )
        reader = PeriodicExportingMetricReader( \
            exporter=exporter, export_interval_millis= \
            self._config.metrics_otel_collector_interval_in_millis
            )
        # add all labels to the metrics common to service
        service_name = self._config.metrics_otel_collector_component
        service_version = str(version.VERSION)
        service_label: Attributes = {
            'service.name': service_name,
            'service.version': service_version
        }
        resource = Resource.create(service_label)

        # view specific for instrument_name='http.server.duration',
        histogram_view_for_duration_metrics = View(
            instrument_name='http.server.duration',
            aggregation=ExplicitBucketHistogramAggregation(
                boundaries=(0, 5, 10, 25, 50, 75, 100, 250, 500, 750, \
                            1000, 2500, 5000, 7500, 10000, 15000, 30000, 45000, 60000)
            )
        )

        self.meter_provider = MeterProvider(metric_readers=[reader],
                                            views=[histogram_view_for_duration_metrics,],
                                            resource=resource)
        metrics.set_meter_provider(self.meter_provider)
        # Since opentelemetry implementation of opentelemetry metrics api does
        # not have an implementation of NoOpMeterProvider we are forcing the NoOpMeter call
        # by defining the service_name as None
        # Ignore warning [WARNING] __init__: Meter name cannot be None or empty.
        if not self._config.metrics_otel_enable:
            service_name = None # type: ignore
        self._meter = metrics.get_meter_provider().get_meter(name=service_name,
                                                             version=service_version)
        self._cache: Dict[str, Any] = {}
        self._global_tags: Dict[str, str] = {}
        MetricCreator._meter_instance = self

    def _get_merged_tags(self, tags: Dict[str, str] | None = None):
        merged = self._global_tags.copy()
        if tags is not None:
            merged.update(tags)
        return merged

    def _get_sync_instrument(self,
                             name: str,
                             instrument_type: InstrumentType,
                             unit: str = '',
                             description: str = '',
                            ) -> Any:
        if name not in self._cache:
            if instrument_type == InstrumentType.COUNTER:
                self._cache[name] = self._meter.create_counter(name=name,
                                                               unit=unit,
                                                               description=description)
            elif instrument_type == InstrumentType.UP_DOWN_COUNTER:
                self._cache[name] = self._meter.create_up_down_counter(name=name,
                                                                       unit=unit,
                                                                       description=description)
            elif instrument_type == InstrumentType.HISTOGRAM:
                self._cache[name] = self._meter.create_histogram(name=name,
                                                                 unit=unit,
                                                                 description=description)
        return self._cache[name]

    def _get_async_instrument(self,
                        name: str,
                        instrument_type: InstrumentType,
                        callbacks: metrics.CallbackT,
                        unit: str = '',
                        description: str = '',
                        ) -> Any:
        if name not in self._cache:
            if instrument_type == InstrumentType.OBSERVABLE_COUNTER:
                self._cache[name] = \
                    self._meter.create_observable_counter(name=name,
                                                          unit=unit,
                                                          description=description,
                                                          callbacks=[callbacks])
            elif instrument_type == InstrumentType.OBSERVABLE_UP_DOWN_COUNTER:
                self._cache[name] = \
                    self._meter.create_observable_up_down_counter(name=name,
                                                                  unit=unit,
                                                                  description=description,
                                                                  callbacks=[callbacks])
            elif instrument_type == InstrumentType.OBSERVABLE_GAUGE:
                self._cache[name] = \
                    self._meter.create_observable_gauge(name=name,
                                                        unit=unit,
                                                        description=description,
                                                        callbacks=[callbacks])
        return self._cache[name]

    # Synchronous
    def send_counter(self,
                     name: str,
                     value: Union[int, float],
                     unit: str = '',
                     description: str = '',
                     tags: Dict[str, str] | None = None):
        """
        Record the monotonically increasing delta value
        (therefore: the delta value is always non-negative)
        Default aggregation: Sum aggregation

        Args:
            name: name of the metrics. This value will be uniquely identifiable
            value: Pass values as positive delta
            unit: case sensitive string to define the count/kilobytes, etc.
                    Defaults to ''. Maximum of 63 chars
            description: description of the metrics. Defaults to ''.
            tags: metadata to define dictionary values to identify data points
        """
        counter = self._get_sync_instrument(name=name,
                                            unit=unit,
                                            description=description,
                                            instrument_type=InstrumentType.COUNTER)
        counter.add(value, self._get_merged_tags(tags))

    def send_up_down_counter(self,
                             name: str,
                             value: Union[int, float],
                             unit: str = '',
                             description: str = '',
                             tags: Dict[str, str] | None = None):
        """
        Record the delta values
        the value is NOT monotonically increasing
        (therefore: the delta value can be positive, negative or zero)
        Default aggregation: Sum aggregation

        Args:
            name: name of the metrics. this value will be uniquely visible
            value: Pass values as positive delta
            unit: case sensitive string to define the count/kilobytes, etc.
                    Defaults to ''. Maximum of 63 chars
            description: description of the metrics. Defaults to ''.
            tags: metadata to define dictionary values to identify data points
        """
        up_down_counter = self._get_sync_instrument(name=name,
                                                    unit=unit,
                                                    description=description,
                                                    instrument_type=InstrumentType.UP_DOWN_COUNTER)
        up_down_counter.add(value, self._get_merged_tags(tags))

    def send_histogram(self,
                       name: str,
                       value: Union[int, float],
                       unit: str = '',
                       description: str = '',
                       tags: Dict[str, str] | None = None):
        """
        Records discrete non monotonic values using record.
        Default aggregation: Explicit Bucket Histogram aggregation

        Args:
            name: name of the metrics. this value will be uniquely visible
            value: Discrete values
            unit: case sensitive string to define the count/kilobytes, etc.
                    Defaults to ''. Maximum of 63 chars
            description: description of the metrics. Defaults to ''.
            tags: metadata to define dictionary values to identify data points
        """
        histogram = self._get_sync_instrument(name=name,
                                              unit=unit,
                                              description=description,
                                              instrument_type=InstrumentType.HISTOGRAM)
        histogram.record(amount = value, attributes = self._get_merged_tags(tags))

    # Asynchronous
    def send_observable_counter(self,
                                name: str,
                                callbacks: metrics.CallbackT,
                                unit: str = '',
                                description: str = ''):
        """
        Adds up the values across different sets of attributes
        value generated by callback is monotonically increasing
        Default aggregation: sum aggregation

        Args:
            name: name of the metrics. this value will be uniquely visible
            callbacks: callback functions should pass values as discrete
            unit: case sensitive string to define the count/kilobytes, etc.
                    Defaults to ''. Maximum of 63 chars
            description: description of the metrics. Defaults to ''.
        """
        _ = self._get_async_instrument(name=name,
                                       instrument_type=InstrumentType.OBSERVABLE_COUNTER,
                                       callbacks=callbacks,
                                       unit=unit,
                                       description=description)

    def send_observable_up_down_counter(self,
                                        name: str,
                                        callbacks: metrics.CallbackT,
                                        unit: str = '',
                                        description: str = ''):
        """
        Adds values across different sets of attributes
        value generated by callback is NOT monotonically increasing
        Default aggregation: sum aggregation

        Args:
            name: name of the metrics. this value will be uniquely visible
            callbacks: callback functions should pass values as discrete
            unit: case sensitive string to define the count/kilobytes, etc.
                    Defaults to ''. Maximum of 63 chars
            description: description of the metrics. Defaults to ''.
        """
        _ = self._get_async_instrument(name=name,
                                       instrument_type=InstrumentType.OBSERVABLE_UP_DOWN_COUNTER,
                                       callbacks=callbacks,
                                       unit=unit,
                                       description=description)

    def send_observable_gauge(self,
                        name: str,
                        callbacks: metrics.CallbackT,
                        unit: str = '',
                        description: str = ''):
        """

        Reports an last absolute value or measure
        values generated by callback is NOT monotonically increasing
        Default aggregation: Last value aggregation

        Args:
            name: name of the metrics. this value will be uniquely visible
            callbacks: callback functions should pass values as discrete
            unit: case sensitive string to define the count/kilobytes, etc.
                    Defaults to ''. Maximum of 63 chars
            description: description of the metrics. Defaults to ''.
        """
        _ = self._get_async_instrument(name=name,
                                       instrument_type=InstrumentType.OBSERVABLE_GAUGE,
                                       callbacks=callbacks,
                                       unit=unit,
                                       description=description)
