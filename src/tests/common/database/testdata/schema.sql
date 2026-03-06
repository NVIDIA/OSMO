-- Schema for authz_sidecar integration tests.
-- This creates the minimal set of tables needed by the roles and authz packages.
-- The source of truth for the schema is in the src/utils/connectors/postgres.py file

CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS roles (
    name TEXT PRIMARY KEY,
    description TEXT NOT NULL DEFAULT '',
    policies JSONB[] NOT NULL DEFAULT '{}',
    immutable BOOLEAN NOT NULL DEFAULT FALSE,
    sync_mode TEXT NOT NULL DEFAULT 'ignore'
);

CREATE TABLE IF NOT EXISTS user_roles (
    user_id TEXT NOT NULL REFERENCES users(id),
    role_name TEXT NOT NULL REFERENCES roles(name),
    assigned_by TEXT NOT NULL DEFAULT '',
    assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, role_name)
);

CREATE TABLE IF NOT EXISTS role_external_mappings (
    role_name TEXT NOT NULL REFERENCES roles(name),
    external_role TEXT NOT NULL,
    PRIMARY KEY (role_name, external_role)
);

CREATE TABLE IF NOT EXISTS pools (
    name TEXT PRIMARY KEY
);

CREATE TABLE IF NOT EXISTS workflows (
    workflow_id TEXT PRIMARY KEY,
    pool TEXT NOT NULL DEFAULT ''
);
