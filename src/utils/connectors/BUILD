load("//bzl:py.bzl", "osmo_py_library")
load("@osmo_python_deps//:requirements.bzl", "requirement")

osmo_py_library(
    name = "connectors",
    srcs = glob(["*.py"]),
    deps = [
        requirement("jwcrypto"),
        requirement("kombu"),
        requirement("kubernetes"),
        requirement("psycopg2-binary"),
        requirement("pydantic"),
        requirement("redis"),
        requirement("aiofiles"),
        requirement("pyyaml"),
        "//src/lib/data/storage",
        "//src/lib/data/storage/constants",
        "//src/lib/utils:cache",
        "//src/lib/utils:common",
        "//src/lib/utils:credentials",
        "//src/lib/utils:login",
        "//src/lib/utils:osmo_errors",
        "//src/lib/utils:role",
        "//src/utils:auth",
        "//src/utils:notify",
        "//src/utils/secret_manager",
    ],
    visibility = ["//visibility:public"],
)
