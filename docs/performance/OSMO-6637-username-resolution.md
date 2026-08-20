# OSMO-6637 username resolution performance

## Result

The resolver now reads only `users`. A warm-cache PostgreSQL 15.1 run on
representative data reduced the base-name plan from 40.626 ms and 836 shared
buffer hits to 0.070 ms and 3 shared buffer hits. Fifty repeated calls fell
from 1218.978 ms to 1.313 ms.

| Query | Execution time | Shared hits | Historical table scans |
| --- | ---: | ---: | --- |
| Previous base-name resolver | 40.626 ms | 836 | `workflows`, `apps`, `app_versions` |
| New base-name resolver | 0.070 ms | 3 | None |
| New exact resolver | 0.058 ms | 3 | None |

The second run of every plan was recorded after a warm-up query. No shared
reads or temporary blocks were reported on the warm-cache plans. The repeated
measurement ran each base-name query 50 times in one PL/pgSQL block, making the
per-call averages 24.380 ms before and 0.026 ms after. These local timings are
not a production latency forecast; they demonstrate that database work now
scales with matching current users instead of historical resource volume.

The old plan contained sequential scans of all 100,000 workflow rows, 10,000
app rows, and 20,000 app-version rows, followed by hash aggregation. The new
base plan used `users_base_username_id_idx`; the new exact plan used
`users_pkey`. Each unused lookup branch was eliminated by its one-time filter.

## Revision confirmation

The deployed production fingerprint still included legacy `dataset` and
`dataset_version` branches. Commit `cf0245edd86e301c1e6fb01c4b3f27d77fca67cb`
removed those tables and resolver branches. The target base revision for this
change, `02b98aec22bc527063fbe26cd4a37730c58d74c2`, contains only `users`,
`workflows`, `apps`, and `app_versions` in the previous resolver, so those four
relations are the baseline reproduced below.

## Representative data

Run against an empty PostgreSQL 15 database:

```sql
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
```

## Before query

Run once to warm the cache, then rerun with `EXPLAIN`:

```sql
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
```

Important nodes from the captured plan:

```text
Seq Scan on users                    actual rows=1000    Buffers: shared hit=7
Seq Scan on workflows                actual rows=100000  Buffers: shared hit=637
Seq Scan on apps                     actual rows=10000   Buffers: shared hit=64
Seq Scan on app_versions             actual rows=20000   Buffers: shared hit=128
Execution Time: 40.626 ms
```

## After queries

The following is the shipped resolver shape. Use `user500` for the base plan
and `user500@nvidia.com` for the exact plan:

```sql
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
SELECT input_username, user_name
FROM resolved
ORDER BY input_username, user_name;
```

Important nodes from the captured base plan:

```text
Index Only Scan using users_base_username_id_idx on users
  Index Cond: (split_part(id, '@'::text, 1) = split_part(input.username, '@'::text, 1))
Buffers: shared hit=3
Execution Time: 0.070 ms
```

Important nodes from the captured exact plan:

```text
Index Only Scan using users_pkey on users
  Index Cond: (id = input.username)
Buffers: shared hit=3
Execution Time: 0.058 ms
```

## Repeated local comparison

The companion benchmark contains the complete schema, data load, warm-up,
plans, and 50-call PL/pgSQL loops. Run it against an empty disposable database:

```bash
psql --set ON_ERROR_STOP=on --file \
  docs/performance/OSMO-6637-benchmark.sql
```

The representative run recorded 1218.978 ms for the previous query and
1.313 ms for the new query.

## Production comparison

Do not reset shared production statistics. Capture this query at the beginning
and end of equivalent traffic windows, then compare counter deltas:

```sql
SELECT queryid, calls, total_exec_time, mean_exec_time, rows,
       shared_blks_hit, shared_blks_read, temp_blks_read, temp_blks_written
FROM pg_stat_statements
WHERE query LIKE '%normalized_usernames%'
ORDER BY total_exec_time DESC;
```

Compare `calls`, `total_exec_time`, shared-block, and temporary-block deltas for
windows with similar list-filter request volume. During rollout, the old and new
fingerprints may coexist; group measurements by `queryid` and confirm the old
fingerprint stops accumulating after old pods terminate.
