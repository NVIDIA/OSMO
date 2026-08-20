-- SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
-- SPDX-License-Identifier: Apache-2.0

\set ON_ERROR_STOP on
\timing on

CREATE TABLE users (id TEXT PRIMARY KEY);
CREATE TABLE workflows (submitted_by TEXT);
CREATE TABLE apps (owner TEXT);
CREATE TABLE app_versions (created_by TEXT);
CREATE INDEX users_base_username_id_idx
ON users ((split_part(id, '@', 1)), id);

INSERT INTO users (id)
SELECT 'user' || value || '@nvidia.com'
FROM generate_series(1, 1000) AS value;

INSERT INTO workflows (submitted_by)
SELECT 'user' || ((value - 1) % 1000 + 1) || '@nvidia.com'
FROM generate_series(1, 100000) AS value;

INSERT INTO apps (owner)
SELECT 'user' || ((value - 1) % 1000 + 1) || '@nvidia.com'
FROM generate_series(1, 10000) AS value;

INSERT INTO app_versions (created_by)
SELECT 'user' || ((value - 1) % 1000 + 1) || '@nvidia.com'
FROM generate_series(1, 20000) AS value;

ANALYZE;

\echo OLD_WARM
WITH normalized_usernames AS (
    SELECT DISTINCT username, split_part(username, '@', 1) AS base_username
    FROM unnest(ARRAY['user500']) AS username(username)
), all_users AS (
    SELECT DISTINCT id FROM users
    UNION SELECT DISTINCT submitted_by FROM workflows
    UNION SELECT DISTINCT owner FROM apps
    UNION SELECT DISTINCT created_by FROM app_versions
)
SELECT normalized.username, min(all_users.id), count(all_users.id)
FROM normalized_usernames AS normalized
LEFT JOIN all_users ON
    all_users.id = normalized.username OR
    (normalized.username = normalized.base_username
     AND all_users.id LIKE normalized.base_username || '@%')
GROUP BY normalized.username;

\echo OLD_PLAN
EXPLAIN (ANALYZE, BUFFERS, TIMING OFF, SUMMARY ON)
WITH normalized_usernames AS (
    SELECT DISTINCT username, split_part(username, '@', 1) AS base_username
    FROM unnest(ARRAY['user500']) AS username(username)
), all_users AS (
    SELECT DISTINCT id FROM users
    UNION SELECT DISTINCT submitted_by FROM workflows
    UNION SELECT DISTINCT owner FROM apps
    UNION SELECT DISTINCT created_by FROM app_versions
)
SELECT normalized.username, min(all_users.id), count(all_users.id)
FROM normalized_usernames AS normalized
LEFT JOIN all_users ON
    all_users.id = normalized.username OR
    (normalized.username = normalized.base_username
     AND all_users.id LIKE normalized.base_username || '@%')
GROUP BY normalized.username;

\echo NEW_BASE_WARM
WITH normalized_usernames AS (
    SELECT DISTINCT username, split_part(username, '@', 1) AS base_username
    FROM unnest(ARRAY['user500']::text[]) AS input(username)
), resolved AS (
    SELECT normalized.username AS input_username, matches.id AS user_name
    FROM normalized_usernames AS normalized
    LEFT JOIN LATERAL (
        SELECT id FROM users
        WHERE normalized.username <> normalized.base_username
          AND id = normalized.username
        UNION ALL
        SELECT id FROM users
        WHERE normalized.username = normalized.base_username
          AND split_part(id, '@', 1) = normalized.base_username
    ) AS matches ON TRUE
)
SELECT input_username, user_name FROM resolved ORDER BY input_username, user_name;

\echo NEW_BASE_PLAN
EXPLAIN (ANALYZE, BUFFERS, TIMING OFF, SUMMARY ON)
WITH normalized_usernames AS (
    SELECT DISTINCT username, split_part(username, '@', 1) AS base_username
    FROM unnest(ARRAY['user500']::text[]) AS input(username)
), resolved AS (
    SELECT normalized.username AS input_username, matches.id AS user_name
    FROM normalized_usernames AS normalized
    LEFT JOIN LATERAL (
        SELECT id FROM users
        WHERE normalized.username <> normalized.base_username
          AND id = normalized.username
        UNION ALL
        SELECT id FROM users
        WHERE normalized.username = normalized.base_username
          AND split_part(id, '@', 1) = normalized.base_username
    ) AS matches ON TRUE
)
SELECT input_username, user_name FROM resolved ORDER BY input_username, user_name;

\echo NEW_EXACT_PLAN
EXPLAIN (ANALYZE, BUFFERS, TIMING OFF, SUMMARY ON)
WITH normalized_usernames AS (
    SELECT DISTINCT username, split_part(username, '@', 1) AS base_username
    FROM unnest(ARRAY['user500@nvidia.com']::text[]) AS input(username)
), resolved AS (
    SELECT normalized.username AS input_username, matches.id AS user_name
    FROM normalized_usernames AS normalized
    LEFT JOIN LATERAL (
        SELECT id FROM users
        WHERE normalized.username <> normalized.base_username
          AND id = normalized.username
        UNION ALL
        SELECT id FROM users
        WHERE normalized.username = normalized.base_username
          AND split_part(id, '@', 1) = normalized.base_username
    ) AS matches ON TRUE
)
SELECT input_username, user_name FROM resolved ORDER BY input_username, user_name;

\echo OLD_50_CALLS
DO $$
BEGIN
    FOR iteration IN 1..50 LOOP
        PERFORM * FROM (
            WITH normalized_usernames AS (
                SELECT DISTINCT username,
                    split_part(username, '@', 1) AS base_username
                FROM unnest(ARRAY['user500']) AS username(username)
            ), all_users AS (
                SELECT DISTINCT id FROM users
                UNION SELECT DISTINCT submitted_by FROM workflows
                UNION SELECT DISTINCT owner FROM apps
                UNION SELECT DISTINCT created_by FROM app_versions
            )
            SELECT normalized.username, min(all_users.id), count(all_users.id)
            FROM normalized_usernames AS normalized
            LEFT JOIN all_users ON
                all_users.id = normalized.username OR
                (normalized.username = normalized.base_username
                 AND all_users.id LIKE normalized.base_username || '@%')
            GROUP BY normalized.username
        ) AS old_resolution;
    END LOOP;
END $$;

\echo NEW_BASE_50_CALLS
DO $$
BEGIN
    FOR iteration IN 1..50 LOOP
        PERFORM * FROM (
            WITH normalized_usernames AS (
                SELECT DISTINCT username,
                    split_part(username, '@', 1) AS base_username
                FROM unnest(ARRAY['user500']::text[]) AS input(username)
            ), resolved AS (
                SELECT normalized.username AS input_username, matches.id AS user_name
                FROM normalized_usernames AS normalized
                LEFT JOIN LATERAL (
                    SELECT id FROM users
                    WHERE normalized.username <> normalized.base_username
                      AND id = normalized.username
                    UNION ALL
                    SELECT id FROM users
                    WHERE normalized.username = normalized.base_username
                      AND split_part(id, '@', 1) = normalized.base_username
                ) AS matches ON TRUE
            )
            SELECT input_username, user_name FROM resolved
        ) AS new_resolution;
    END LOOP;
END $$;
