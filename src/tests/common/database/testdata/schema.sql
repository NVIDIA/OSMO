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
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role_name TEXT NOT NULL REFERENCES roles(name) ON DELETE CASCADE,
    assigned_by TEXT NOT NULL DEFAULT '',
    assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (user_id, role_name)
);

CREATE TABLE IF NOT EXISTS access_token (
    user_name TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_name TEXT NOT NULL,
    access_token BYTEA,
    expires_at TIMESTAMP,
    description TEXT,
    last_seen_at TIMESTAMP WITH TIME ZONE,
    PRIMARY KEY (user_name, token_name),
    CONSTRAINT unique_access_token UNIQUE (access_token)
);

CREATE TABLE IF NOT EXISTS access_token_roles (
    user_name TEXT NOT NULL,
    token_name TEXT NOT NULL,
    user_role_id UUID NOT NULL REFERENCES user_roles(id) ON DELETE CASCADE,
    assigned_by TEXT NOT NULL,
    assigned_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_name, token_name, user_role_id),
    FOREIGN KEY (user_name, token_name)
        REFERENCES access_token(user_name, token_name) ON DELETE CASCADE
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
