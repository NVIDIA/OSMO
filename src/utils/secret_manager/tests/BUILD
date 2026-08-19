load("//bzl:py.bzl", "osmo_py_test")
load("@osmo_python_deps//:requirements.bzl", "requirement")

osmo_py_test(
    name = "test_secret_manager",
    srcs = ["test_secret_manager.py"],
    deps = [
        requirement("jwcrypto"),
        "//src/lib/utils:osmo_errors",
        "//src/utils/secret_manager",
    ],
)
