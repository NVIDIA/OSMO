# Release Notes - Issue #33

## Support for Loading Local Images into KIND Cluster

This release implements support for loading local Docker images directly into the local Kind cluster and fixes critical test harness regressions.

### New Features
*   **Local Image Loading (`--load-local-images`):** Added flag to `start_service` and `start_backend` to enable direct image loading.
*   **Kind Utility:** New `load_images_to_kind` utility with architecture awareness (`amd64`/`arm64`) and automatic retagging to `osmo.local/`.
*   **Standalone Command:** `bazel run //run:load_images` available for independent image loading operations.

### Fixes & Improvements
*   **macOS Compatibility:** Fixed `OSMOBackendError` and Postgres failures on macOS by implementing dynamic binary resolution and fallback user lookup.
*   **Test Harness Stability:** 
    *   Fixed socket reuse race conditions in `_wait_for_port`.
    *   Corrected Pydantic validation errors by fully populating `default-pool` and `backends` with valid schema.
    *   Patched `SubmitWorkflow` to correctly parse dependencies.
    *   Updated `job_test.py` assertions to accurately reflect DAG state transitions.

### Verification
*   `bazel test //src/utils/job/tests:job_test` passes ensuring reliable local development.
