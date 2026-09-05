INSERT INTO users (id, created_by) VALUES
    ('manual@example.com', 'test'),
    ('idp-sync@example.com', 'test'),
    ('db-only@example.com', 'test');

INSERT INTO roles (name, description, policies, sync_mode) VALUES
    ('db-only-admin', 'Must remain inert',
     ARRAY['{"effect":"Allow","actions":["*:*"]}'::jsonb], 'force');
INSERT INTO role_external_mappings (role_name, external_role) VALUES
    ('db-only-admin', 'db-admin-group');

INSERT INTO user_roles (user_id, role_name, assigned_by) VALUES
    ('manual@example.com', 'scoped-reader', 'operator@example.com'),
    ('idp-sync@example.com', 'scoped-reader', 'idp-sync'),
    ('db-only@example.com', 'db-only-admin', 'operator@example.com');

INSERT INTO workflows (workflow_id, pool) VALUES
    ('team-a-workflow', 'team-a'),
    ('team-b-workflow', 'team-b');
