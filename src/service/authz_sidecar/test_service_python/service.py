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

from fastapi import FastAPI, Request, Response, status
from fastapi.responses import JSONResponse
import argparse
import uvicorn
from middleware import AccessControlMiddleware

app = FastAPI()

# Global middleware instance
authz_middleware = None


@app.middleware("http")
async def access_control_middleware(request: Request, call_next):
    """ASGI middleware for access control - mimics production AccessControlMiddleware."""
    global authz_middleware

    # Skip auth for health check
    if request.url.path == "/health":
        return await call_next(request)

    # Extract headers
    path = request.url.path
    method = request.method
    roles_header = request.headers.get("x-osmo-roles", "")

    # Check access
    allowed = authz_middleware.check_access(path, method, roles_header)

    if not allowed:
        return JSONResponse(
            status_code=status.HTTP_403_FORBIDDEN,
            content={"detail": "Access denied"}
        )

    # Continue to next handler
    response = await call_next(request)
    return response


@app.get("/health")
async def health():
    """Health check endpoint."""
    return {"status": "healthy"}


@app.get("/api/version")
async def version():
    """Public endpoint - accessible by osmo-default role."""
    return {"version": "1.0.0"}


@app.get("/api/workflow")
async def get_workflows():
    """Protected endpoint - requires osmo-user role."""
    return {"workflows": []}


@app.post("/api/workflow")
async def create_workflow():
    """Protected endpoint - requires osmo-user role."""
    return {"id": "workflow-123"}


@app.get("/api/workflow/{workflow_id}")
async def get_workflow(workflow_id: str):
    """Protected endpoint - requires osmo-user role."""
    return {"id": workflow_id, "status": "running"}


def main():
    parser = argparse.ArgumentParser(description="Test Python service with AccessControlMiddleware")
    parser.add_argument("--port", type=int, default=8000, help="Port to listen on")
    parser.add_argument("--postgres-host", default="localhost", help="PostgreSQL host")
    parser.add_argument("--postgres-port", type=int, default=5432, help="PostgreSQL port")
    parser.add_argument("--postgres-db", default="osmo_db", help="PostgreSQL database")
    parser.add_argument("--postgres-user", default="postgres", help="PostgreSQL user")
    parser.add_argument("--postgres-password", default="osmo", help="PostgreSQL password")

    args = parser.parse_args()

    # Initialize middleware with database config
    global authz_middleware
    authz_middleware = AccessControlMiddleware({
        'host': args.postgres_host,
        'port': args.postgres_port,
        'database': args.postgres_db,
        'user': args.postgres_user,
        'password': args.postgres_password,
    })

    print(f"Starting Python test service on port {args.port}")
    print(f"PostgreSQL: {args.postgres_host}:{args.postgres_port}/{args.postgres_db}")

    uvicorn.run(app, host="127.0.0.1", port=args.port, log_level="error")


if __name__ == "__main__":
    main()

