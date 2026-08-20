"""Authoritative PostgreSQL schema for the Kubernetes-native MEK lifecycle."""

# SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: Apache-2.0

from typing import Final


MEK_SCHEMA_VERSION: Final = 1
MEK_SCHEMA_SIGNATURE: Final = "osmo-mek-schema-v1"
MEK_SCHEMA_LOCK_ID: Final = 0x4F534D4F4D454B53
LEGACY_MEK_TABLES: Final = (
    "mek_keyring_adoption",
    "mek_rewrap_progress",
    "mek_rewrap_status",
)
PROTECTED_TABLES: Final = ("ueks", "configs")
WRITE_EPOCH_FUNCTION_VERSION: Final = "osmo-mek-write-epoch-v1"
EXPECTED_COLUMNS: Final = {
    "mek_key_registry": frozenset({
        "kid", "fingerprint", "state", "remaining_references",
        "last_scan_started_at", "last_scan_completed_at", "first_seen_at",
    }),
    "mek_lifecycle_state": frozenset({
        "singleton", "schema_version", "adopted_generation", "adopted_current_kid",
        "adopted_kids", "bound_secret_name", "bound_secret_key", "bound_secret_uid",
        "installation_id", "management_mode", "ready", "adopted_at",
        "observed_generation", "observed_current_kid", "persistence_registry_version",
        "rotation_id", "fencing_epoch", "phase", "active_pod_uid",
        "active_service_account", "credential_fenced", "predecessor_generation",
        "candidate_generation", "registry_digest", "rotation_secret_uid",
        "rotation_secret_resource_version", "last_started_at", "last_completed_at",
        "blocker",
    }),
    "mek_write_epoch": frozenset({"singleton", "epoch", "writes_allowed"}),
    "mek_consumer_status": frozenset({
        "consumer_id", "consumer_name", "generation", "current_kid", "loaded_kids",
        "registry_digest", "last_seen_at",
    }),
}
EXPECTED_COLUMN_SHAPES: Final = {
    "mek_key_registry": {
        "kid": ("text", True, None),
        "fingerprint": ("text", True, None),
        "state": ("text", True, None),
        "remaining_references": ("integer", False, None),
        "last_scan_started_at": ("timestamp with time zone", False, None),
        "last_scan_completed_at": ("timestamp with time zone", False, None),
        "first_seen_at": ("timestamp with time zone", True, "now()"),
    },
    "mek_lifecycle_state": {
        "singleton": ("boolean", True, "true"),
        "schema_version": ("integer", True, str(MEK_SCHEMA_VERSION)),
        "adopted_generation": ("text", True, None),
        "adopted_current_kid": ("text", True, None),
        "adopted_kids": ("text[]", True, None),
        "bound_secret_name": ("text", True, "''::text"),
        "bound_secret_key": ("text", True, "''::text"),
        "bound_secret_uid": ("text", True, "''::text"),
        "installation_id": ("text", True, "''::text"),
        "management_mode": ("text", True, "'external'::text"),
        "ready": ("boolean", True, "false"),
        "adopted_at": ("timestamp with time zone", True, "now()"),
        "observed_generation": ("text", True, "''::text"),
        "observed_current_kid": ("text", True, "''::text"),
        "persistence_registry_version": ("integer", True, "1"),
        "rotation_id": ("text", True, "''::text"),
        "fencing_epoch": ("bigint", True, "0"),
        "phase": ("text", True, "'idle'::text"),
        "active_pod_uid": ("text", True, "''::text"),
        "active_service_account": ("text", True, "''::text"),
        "credential_fenced": ("boolean", True, "true"),
        "predecessor_generation": ("text", True, "''::text"),
        "candidate_generation": ("text", True, "''::text"),
        "registry_digest": ("text", True, "''::text"),
        "rotation_secret_uid": ("text", True, "''::text"),
        "rotation_secret_resource_version": ("text", True, "''::text"),
        "last_started_at": ("timestamp with time zone", False, None),
        "last_completed_at": ("timestamp with time zone", False, None),
        "blocker": ("text", True, "''::text"),
    },
    "mek_write_epoch": {
        "singleton": ("boolean", True, "true"),
        "epoch": ("bigint", True, "0"),
        "writes_allowed": ("boolean", True, "true"),
    },
    "mek_consumer_status": {
        "consumer_id": ("text", True, None),
        "consumer_name": ("text", True, None),
        "generation": ("text", True, None),
        "current_kid": ("text", True, None),
        "loaded_kids": ("text[]", True, None),
        "registry_digest": ("text", True, "''::text"),
        "last_seen_at": ("timestamp with time zone", True, "now()"),
    },
}
EXPECTED_CONSTRAINTS: Final = {
    "mek_key_registry": frozenset({
        "mek_key_registry_pkey", "mek_key_registry_kid_valid",
        "mek_key_registry_fingerprint_valid", "mek_key_registry_fingerprint_unique",
        "mek_key_registry_state_valid", "mek_key_registry_references_nonnegative",
    }),
    "mek_lifecycle_state": frozenset({
        "mek_lifecycle_state_pkey", "mek_lifecycle_singleton_true",
        "mek_lifecycle_schema_version_valid", "mek_lifecycle_adopted_generation_valid",
        "mek_lifecycle_adopted_current_valid", "mek_lifecycle_adopted_kids_valid",
        "mek_lifecycle_bound_identity_valid", "mek_lifecycle_management_mode_valid",
        "mek_lifecycle_observed_bundle_valid", "mek_lifecycle_registry_version_positive",
        "mek_lifecycle_fencing_epoch_nonnegative", "mek_lifecycle_phase_valid",
        "mek_lifecycle_rotation_identity_coherent",
        "mek_lifecycle_candidate_phase_coherent", "mek_lifecycle_registry_digest_valid",
        "mek_lifecycle_blocker_bounded",
    }),
    "mek_write_epoch": frozenset({
        "mek_write_epoch_pkey", "mek_write_epoch_singleton_true",
        "mek_write_epoch_epoch_nonnegative",
    }),
    "mek_consumer_status": frozenset({
        "mek_consumer_status_pkey", "mek_consumer_identity_valid",
        "mek_consumer_generation_valid", "mek_consumer_loaded_kids_valid",
        "mek_consumer_registry_digest_valid",
    }),
}
WRITE_EPOCH_FUNCTION_BODY: Final = """
BEGIN
    UPDATE public.mek_write_epoch SET epoch = epoch + 1
    WHERE singleton AND writes_allowed;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'MEK lifecycle write fence is active';
    END IF;
    RETURN NULL;
END;
""".strip()


class MekSchemaError(RuntimeError):
    """Raised when existing MEK metadata cannot be safely adopted."""


def _reject_legacy_schema(cursor) -> None:
    cursor.execute(
        """
        SELECT table_name
        FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = ANY(%s)
        ORDER BY table_name;
        """,
        (list(LEGACY_MEK_TABLES),),
    )
    legacy_tables = [row[0] for row in cursor.fetchall()]
    if legacy_tables:
        raise MekSchemaError(
            "An unsupported pre-merge MEK schema is present. Quiesce OSMO writers, "
            "back up the database, and follow the PR-only MEK schema reset procedure."
        )


def _create_tables(cursor) -> None:
    cursor.execute(
        """
        CREATE TABLE IF NOT EXISTS public.mek_key_registry (
            kid TEXT PRIMARY KEY,
            fingerprint TEXT NOT NULL,
            state TEXT NOT NULL,
            remaining_references INTEGER,
            last_scan_started_at TIMESTAMPTZ,
            last_scan_completed_at TIMESTAMPTZ,
            first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            CONSTRAINT mek_key_registry_kid_valid
                CHECK (char_length(kid) BETWEEN 1 AND 128),
            CONSTRAINT mek_key_registry_fingerprint_valid
                CHECK (fingerprint ~ '^[0-9a-f]{64}$'),
            CONSTRAINT mek_key_registry_fingerprint_unique UNIQUE (fingerprint),
            CONSTRAINT mek_key_registry_state_valid
                CHECK (state IN ('prepared', 'current')),
            CONSTRAINT mek_key_registry_references_nonnegative
                CHECK (remaining_references IS NULL OR remaining_references >= 0)
        );
        """
    )
    cursor.execute(
        """
        CREATE UNIQUE INDEX IF NOT EXISTS mek_key_registry_one_current
        ON public.mek_key_registry ((state)) WHERE state = 'current';
        """
    )
    cursor.execute(
        f"""
        CREATE TABLE IF NOT EXISTS public.mek_lifecycle_state (
            singleton BOOLEAN PRIMARY KEY DEFAULT TRUE,
            schema_version INTEGER NOT NULL DEFAULT {MEK_SCHEMA_VERSION}
                CONSTRAINT mek_lifecycle_schema_version_valid
                CHECK (schema_version = {MEK_SCHEMA_VERSION}),

            adopted_generation TEXT NOT NULL,
            adopted_current_kid TEXT NOT NULL,
            adopted_kids TEXT[] NOT NULL,
            bound_secret_name TEXT NOT NULL DEFAULT '',
            bound_secret_key TEXT NOT NULL DEFAULT '',
            bound_secret_uid TEXT NOT NULL DEFAULT '',
            installation_id TEXT NOT NULL DEFAULT '',
            management_mode TEXT NOT NULL DEFAULT 'external',
            ready BOOLEAN NOT NULL DEFAULT FALSE,
            adopted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

            observed_generation TEXT NOT NULL DEFAULT '',
            observed_current_kid TEXT NOT NULL DEFAULT '',
            persistence_registry_version INTEGER NOT NULL DEFAULT 1,
            rotation_id TEXT NOT NULL DEFAULT '',
            fencing_epoch BIGINT NOT NULL DEFAULT 0,
            phase TEXT NOT NULL DEFAULT 'idle',
            active_pod_uid TEXT NOT NULL DEFAULT '',
            active_service_account TEXT NOT NULL DEFAULT '',
            credential_fenced BOOLEAN NOT NULL DEFAULT TRUE,
            predecessor_generation TEXT NOT NULL DEFAULT '',
            candidate_generation TEXT NOT NULL DEFAULT '',
            registry_digest TEXT NOT NULL DEFAULT '',
            rotation_secret_uid TEXT NOT NULL DEFAULT '',
            rotation_secret_resource_version TEXT NOT NULL DEFAULT '',
            last_started_at TIMESTAMPTZ,
            last_completed_at TIMESTAMPTZ,
            blocker TEXT NOT NULL DEFAULT '',

            CONSTRAINT mek_lifecycle_singleton_true CHECK (singleton),
            CONSTRAINT mek_lifecycle_adopted_generation_valid
                CHECK (adopted_generation ~ '^[0-9a-f]{{16}}$'),
            CONSTRAINT mek_lifecycle_adopted_current_valid
                CHECK (char_length(adopted_current_kid) BETWEEN 1 AND 128),
            CONSTRAINT mek_lifecycle_adopted_kids_valid
                CHECK (
                    cardinality(adopted_kids) BETWEEN 1 AND 32
                    AND adopted_current_kid = ANY(adopted_kids)
                ),
            CONSTRAINT mek_lifecycle_bound_identity_valid
                CHECK (
                    (
                        management_mode = 'external'
                        AND bound_secret_name = ''
                        AND bound_secret_key = ''
                        AND bound_secret_uid = ''
                        AND installation_id = ''
                    )
                    OR (
                        char_length(bound_secret_name) BETWEEN 1 AND 253
                        AND char_length(bound_secret_key) BETWEEN 1 AND 253
                        AND char_length(bound_secret_uid) BETWEEN 1 AND 253
                        AND char_length(installation_id) BETWEEN 1 AND 512
                    )
                ),
            CONSTRAINT mek_lifecycle_management_mode_valid
                CHECK (management_mode IN ('external', 'osmo')),
            CONSTRAINT mek_lifecycle_observed_bundle_valid
                CHECK (
                    (observed_generation = '' AND observed_current_kid = '')
                    OR (
                        observed_generation ~ '^[0-9a-f]{{16}}$'
                        AND char_length(observed_current_kid) BETWEEN 1 AND 128
                    )
                ),
            CONSTRAINT mek_lifecycle_registry_version_positive
                CHECK (persistence_registry_version > 0),
            CONSTRAINT mek_lifecycle_fencing_epoch_nonnegative
                CHECK (fencing_epoch >= 0),
            CONSTRAINT mek_lifecycle_phase_valid
                CHECK (phase IN (
                    'idle', 'claimed', 'prepare-written', 'prepared',
                    'activate-written', 'activated', 'complete'
                )),
            CONSTRAINT mek_lifecycle_rotation_identity_coherent
                CHECK (
                    (rotation_id = '' AND phase = 'idle'
                        AND active_pod_uid = '' AND active_service_account = '')
                    OR
                    (rotation_id <> '' AND phase <> 'idle'
                        AND active_pod_uid <> '' AND active_service_account <> ''
                        AND predecessor_generation <> ''
                        AND rotation_secret_uid <> ''
                        AND rotation_secret_resource_version <> '')
                ),
            CONSTRAINT mek_lifecycle_candidate_phase_coherent
                CHECK (
                    phase IN ('idle', 'claimed')
                    OR candidate_generation <> ''
                ),
            CONSTRAINT mek_lifecycle_registry_digest_valid
                CHECK (registry_digest = '' OR registry_digest ~ '^[0-9a-f]{{64}}$'),
            CONSTRAINT mek_lifecycle_blocker_bounded
                CHECK (char_length(blocker) <= 1024)
        );
        """
    )
    cursor.execute(
        """
        CREATE TABLE IF NOT EXISTS public.mek_write_epoch (
            singleton BOOLEAN PRIMARY KEY DEFAULT TRUE,
            epoch BIGINT NOT NULL DEFAULT 0,
            writes_allowed BOOLEAN NOT NULL DEFAULT TRUE,
            CONSTRAINT mek_write_epoch_singleton_true CHECK (singleton),
            CONSTRAINT mek_write_epoch_epoch_nonnegative CHECK (epoch >= 0)
        );
        """
    )
    cursor.execute(
        """
        INSERT INTO public.mek_write_epoch (singleton, epoch, writes_allowed)
        VALUES (TRUE, 0, TRUE) ON CONFLICT (singleton) DO NOTHING;
        """
    )
    cursor.execute(
        """
        CREATE TABLE IF NOT EXISTS public.mek_consumer_status (
            consumer_id TEXT PRIMARY KEY,
            consumer_name TEXT NOT NULL,
            generation TEXT NOT NULL,
            current_kid TEXT NOT NULL,
            loaded_kids TEXT[] NOT NULL,
            registry_digest TEXT NOT NULL DEFAULT '',
            last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            CONSTRAINT mek_consumer_identity_valid CHECK (
                char_length(consumer_id) BETWEEN 1 AND 253
                AND char_length(consumer_name) BETWEEN 1 AND 253
            ),
            CONSTRAINT mek_consumer_generation_valid
                CHECK (generation ~ '^[0-9a-f]{16}$'),
            CONSTRAINT mek_consumer_loaded_kids_valid CHECK (
                cardinality(loaded_kids) BETWEEN 1 AND 32
                AND current_kid = ANY(loaded_kids)
            ),
            CONSTRAINT mek_consumer_registry_digest_valid
                CHECK (registry_digest ~ '^[0-9a-f]{64}$')
        );
        """
    )


def _ensure_write_epoch_function(cursor) -> None:
    cursor.execute(
        f"""
        CREATE OR REPLACE FUNCTION public.bump_mek_write_epoch()
        RETURNS trigger LANGUAGE plpgsql AS $$
        {WRITE_EPOCH_FUNCTION_BODY}
        $$;
        """
    )
    cursor.execute(
        """
        COMMENT ON FUNCTION public.bump_mek_write_epoch()
        IS 'osmo-mek-write-epoch-v1';
        """
    )
    cursor.execute(
        """
        SELECT p.prosrc, obj_description(p.oid, 'pg_proc')
        FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public' AND p.proname = 'bump_mek_write_epoch'
          AND pg_get_function_identity_arguments(p.oid) = '';
        """
    )
    row = cursor.fetchone()
    if row is None or row[0].strip() != WRITE_EPOCH_FUNCTION_BODY or row[1] != (
        WRITE_EPOCH_FUNCTION_VERSION
    ):
        raise MekSchemaError("The MEK write-fence function failed verification.")


def _existing_mek_tables(cursor) -> set[str]:
    cursor.execute(
        """
        SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = ANY(%s);
        """,
        (list(EXPECTED_COLUMNS),),
    )
    return {row[0] for row in cursor.fetchall()}


def _stamp_fresh_schema(cursor) -> None:
    """Mark definitions created together by this installer, never arbitrary existing DDL."""
    for table_name, constraint_names in EXPECTED_CONSTRAINTS.items():
        cursor.execute(
            f"COMMENT ON TABLE public.{table_name} IS %s;", (MEK_SCHEMA_SIGNATURE,))
        for constraint_name in constraint_names:
            cursor.execute(
                f"COMMENT ON CONSTRAINT {constraint_name} ON public.{table_name} IS %s;",
                (MEK_SCHEMA_SIGNATURE,),
            )
    cursor.execute(
        "COMMENT ON INDEX public.mek_key_registry_one_current IS %s;",
        (MEK_SCHEMA_SIGNATURE,),
    )


def _unsupported_schema() -> MekSchemaError:
    return MekSchemaError(
        "The installed MEK schema definition is unsupported. Quiesce OSMO writers, "
        "back up the database, and follow the PR-only MEK schema reset procedure."
    )


def _verify_table_shapes(cursor) -> None:
    cursor.execute(
        """
        SELECT relation.relname, attribute.attname,
               pg_catalog.format_type(attribute.atttypid, attribute.atttypmod),
               attribute.attnotnull,
               pg_get_expr(default_value.adbin, default_value.adrelid)
        FROM pg_attribute attribute
        JOIN pg_class relation ON relation.oid = attribute.attrelid
        JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
        LEFT JOIN pg_attrdef default_value
          ON default_value.adrelid = relation.oid
         AND default_value.adnum = attribute.attnum
        WHERE namespace.nspname = 'public' AND relation.relname = ANY(%s)
          AND attribute.attnum > 0 AND NOT attribute.attisdropped;
        """,
        (list(EXPECTED_COLUMN_SHAPES),),
    )
    observed: dict[str, dict[str, tuple[str, bool, str | None]]] = {
        table_name: {} for table_name in EXPECTED_COLUMN_SHAPES
    }
    for table_name, column_name, data_type, not_null, default in cursor.fetchall():
        observed[table_name][column_name] = (data_type, not_null, default)
    if observed != EXPECTED_COLUMN_SHAPES:
        raise _unsupported_schema()

    cursor.execute(
        """
        SELECT relation.relname, obj_description(relation.oid, 'pg_class')
        FROM pg_class relation
        JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
        WHERE namespace.nspname = 'public' AND relation.relname = ANY(%s)
          AND relation.relkind = 'r';
        """,
        (list(EXPECTED_COLUMN_SHAPES),),
    )
    if dict(cursor.fetchall()) != {
        table_name: MEK_SCHEMA_SIGNATURE for table_name in EXPECTED_COLUMN_SHAPES
    }:
        raise _unsupported_schema()

    cursor.execute(
        """
        SELECT relation.relname, constraint_record.conname,
               constraint_record.contype, constraint_record.convalidated,
               obj_description(constraint_record.oid, 'pg_constraint')
        FROM pg_constraint constraint_record
        JOIN pg_class relation ON relation.oid = constraint_record.conrelid
        JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
        WHERE namespace.nspname = 'public' AND relation.relname = ANY(%s);
        """,
        (list(EXPECTED_CONSTRAINTS),),
    )
    observed_constraints: dict[str, dict[str, tuple[str, bool, str | None]]] = {
        table_name: {} for table_name in EXPECTED_CONSTRAINTS
    }
    for table_name, name, constraint_type, validated, signature in cursor.fetchall():
        observed_constraints[table_name][name] = (constraint_type, validated, signature)
    for table_name, names in EXPECTED_CONSTRAINTS.items():
        if set(observed_constraints[table_name]) != names:
            raise _unsupported_schema()
        for name, (constraint_type, validated, signature) in observed_constraints[
                table_name].items():
            expected_type = (
                "p" if name.endswith("_pkey")
                else "u" if name == "mek_key_registry_fingerprint_unique"
                else "c"
            )
            if (
                constraint_type != expected_type
                or not validated
                or signature != MEK_SCHEMA_SIGNATURE
            ):
                raise _unsupported_schema()

    cursor.execute(
        """
        SELECT table_relation.relname, index_record.indisunique,
               index_record.indisvalid, index_record.indisready,
               pg_get_indexdef(index_relation.oid, 1, TRUE),
               index_record.indpred IS NOT NULL,
               obj_description(index_relation.oid, 'pg_class')
        FROM pg_index index_record
        JOIN pg_class index_relation ON index_relation.oid = index_record.indexrelid
        JOIN pg_class table_relation ON table_relation.oid = index_record.indrelid
        JOIN pg_namespace namespace ON namespace.oid = index_relation.relnamespace
        WHERE namespace.nspname = 'public'
          AND index_relation.relname = 'mek_key_registry_one_current';
        """
    )
    index_row = cursor.fetchone()
    if index_row != (
        "mek_key_registry", True, True, True, "state", True, MEK_SCHEMA_SIGNATURE
    ):
        raise _unsupported_schema()

    cursor.execute(
        "SELECT schema_version FROM public.mek_lifecycle_state WHERE singleton;"
    )
    row = cursor.fetchone()
    if row is not None and row != (MEK_SCHEMA_VERSION,):
        raise _unsupported_schema()


def _verify_complete_table_set(existing_tables: set[str]) -> None:
    if existing_tables and existing_tables != set(EXPECTED_COLUMNS):
        raise MekSchemaError(
            "The installed MEK schema shape is incomplete. Quiesce OSMO writers, "
            "back up the database, and follow the PR-only MEK schema reset procedure."
        )


def _ensure_write_epoch_triggers(cursor) -> None:
    for table_name in PROTECTED_TABLES:
        cursor.execute("SELECT to_regclass(%s);", (f"public.{table_name}",))
        if cursor.fetchone()[0] is None:
            continue
        cursor.execute(
            """
            SELECT trigger.tgenabled, trigger.tgtype,
                   procedure.oid = 'public.bump_mek_write_epoch()'::regprocedure
            FROM pg_trigger trigger
            JOIN pg_class relation ON relation.oid = trigger.tgrelid
            JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
            JOIN pg_proc procedure ON procedure.oid = trigger.tgfoid
            WHERE namespace.nspname = 'public' AND relation.relname = %s
              AND trigger.tgname = 'bump_mek_write_epoch'
              AND NOT trigger.tgisinternal;
            """,
            (table_name,),
        )
        row = cursor.fetchone()
        if row is None:
            cursor.execute(
                f"""
                CREATE TRIGGER bump_mek_write_epoch
                AFTER INSERT OR UPDATE OR DELETE OR TRUNCATE ON public.{table_name}
                FOR EACH STATEMENT EXECUTE FUNCTION public.bump_mek_write_epoch();
                """
            )
            continue
        # tgtype 60 is AFTER STATEMENT for INSERT, DELETE, UPDATE, and TRUNCATE.
        if row != ("O", 60, True):
            raise MekSchemaError(
                f"The MEK write-fence trigger on {table_name} is disabled or invalid."
            )


def ensure_mek_schema(cursor) -> None:
    """Install and verify the final unversioned MEK schema in one transaction."""
    cursor.execute("SELECT pg_advisory_xact_lock(%s);", (MEK_SCHEMA_LOCK_ID,))
    _reject_legacy_schema(cursor)
    existing_tables = _existing_mek_tables(cursor)
    _verify_complete_table_set(existing_tables)
    _create_tables(cursor)
    if not existing_tables:
        _stamp_fresh_schema(cursor)
    _verify_table_shapes(cursor)
    _ensure_write_epoch_function(cursor)
    _ensure_write_epoch_triggers(cursor)
