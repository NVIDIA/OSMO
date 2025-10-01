#!/bin/bash
docker run -it -p 10000:10000 -v $PWD/envoy_config.yaml:/config.yaml envoyproxy/envoy:v1.25.11  -c /config.yaml --log-level trace
