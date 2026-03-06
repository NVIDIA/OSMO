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

-- User role: workflow read/create, pool read
INSERT INTO roles (name, description, policies, immutable) VALUES (
    'osmo-user',
    'Standard user with workflow access',
    ARRAY[
        '{"actions": ["workflow:Read", "workflow:Create", "pool:Read", "pool:List", "profile:Read", "resources:Read"], "resources": ["*"]}'::jsonb
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

-- User role assignments
INSERT INTO user_roles (user_id, role_name, assigned_by, assigned_at) VALUES
    ('admin@example.com', 'osmo-admin', 'seed', NOW()),
    ('user@example.com', 'osmo-user', 'seed', NOW()),
    ('restricted@example.com', 'osmo-restricted', 'seed', NOW());
