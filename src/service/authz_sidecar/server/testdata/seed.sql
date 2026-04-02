-- Seed data for authz_sidecar integration tests.

-- Default role: grants access to health/version/login endpoints
INSERT INTO roles (name, description, policies, immutable) VALUES (
    'osmo-default',
    'Default role for all users',
    ARRAY[
        '{"actions": ["version:Read", "health:Read", "auth:Read"], "resources": ["*"]}'::jsonb
    ],
    TRUE
);

-- Admin role: full access
INSERT INTO roles (name, description, policies, immutable) VALUES (
    'osmo-admin',
    'Full admin access',
    ARRAY[
        '{"actions": ["*:*"], "resources": ["*"]}'::jsonb
    ],
    TRUE
);

-- User role: workflow read/create, pool read, app CRUD
INSERT INTO roles (name, description, policies, immutable) VALUES (
    'osmo-user',
    'Standard user with workflow and app access',
    ARRAY[
        '{"actions": ["workflow:Read", "workflow:Create", "pool:Read", "pool:List", "profile:Read", "resources:Read", "app:Create", "app:Read", "app:Update", "app:Delete"], "resources": ["*"]}'::jsonb
    ],
    FALSE
);

-- Restricted role: only workflow read on a specific pool
INSERT INTO roles (name, description, policies, immutable) VALUES (
    'osmo-restricted',
    'Restricted to specific pool',
    ARRAY[
        '{"actions": ["workflow:Read"], "resources": ["pool/production"]}'::jsonb
    ],
    FALSE
);

-- Pools
INSERT INTO pools (name) VALUES ('production'), ('staging'), ('development');

-- Users
INSERT INTO users (id, created_at, created_by) VALUES
    ('admin@example.com', NOW(), 'seed'),
    ('user@example.com', NOW(), 'seed'),
    ('restricted@example.com', NOW(), 'seed');

-- User role assignments (explicit UUIDs so access_token_roles can reference them)
INSERT INTO user_roles (id, user_id, role_name, assigned_by, assigned_at) VALUES
    ('a0000000-0000-0000-0000-000000000001', 'admin@example.com', 'osmo-admin', 'seed', NOW()),
    ('a0000000-0000-0000-0000-000000000002', 'user@example.com', 'osmo-user', 'seed', NOW()),
    ('a0000000-0000-0000-0000-000000000003', 'user@example.com', 'osmo-restricted', 'seed', NOW()),
    ('a0000000-0000-0000-0000-000000000004', 'restricted@example.com', 'osmo-restricted', 'seed', NOW());

-- Access tokens for user@example.com
INSERT INTO access_token (user_name, token_name, description) VALUES
    ('user@example.com', 'my-api-token', 'Token with only restricted role'),
    ('user@example.com', 'full-access-token', 'Token with full user role');

-- Token role assignments: my-api-token only gets osmo-restricted (a subset of the user's roles)
INSERT INTO access_token_roles (user_name, token_name, user_role_id, assigned_by) VALUES
    ('user@example.com', 'my-api-token', 'a0000000-0000-0000-0000-000000000003', 'seed'),
    ('user@example.com', 'full-access-token', 'a0000000-0000-0000-0000-000000000002', 'seed');

-- Role granted via the osmo-default external mapping. sync_mode='import' allows
-- IDP sync to assign this role when the external role "osmo-default" is present.
-- This is separate from osmo-user to avoid affecting existing test expectations.
-- Only grants read-level access (workflow:Read, pool:Read, pool:List).
INSERT INTO roles (name, description, policies, immutable, sync_mode) VALUES (
    'osmo-default-mapped',
    'Role auto-assigned via osmo-default external mapping',
    ARRAY[
        '{"actions": ["workflow:Read", "pool:Read", "pool:List"], "resources": ["*"]}'::jsonb
    ],
    FALSE,
    'import'
);

-- External role mappings: osmo-default external role maps to osmo-default-mapped.
-- The authz server appends "osmo-default" to every request before SyncUserRoles,
-- so this mapping fires for every user who goes through role sync.
INSERT INTO role_external_mappings (role_name, external_role) VALUES
    ('osmo-default-mapped', 'osmo-default');
