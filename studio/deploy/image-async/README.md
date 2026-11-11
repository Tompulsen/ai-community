# Image Service Patch

`multi-image-results.patch` contains the backend changes paired with the chat
client's multi-image result support. The existing standalone `image-async`
directory is not a Git repository, so this patch keeps its changes and regression
tests versioned here without duplicating the full service.

The patch separates requested and actual image counts, accepts up to 10 returned
images, expands asynchronous storage reservations, reports specific preparation
errors without private response data, and cleans up incomplete multi-image writes.
Synchronous JSON and SSE paths accept the same result count.

From the matching, unpatched image-service source directory:

```sh
git apply --check /path/to/multi-image-results.patch
git apply /path/to/multi-image-results.patch
python -m pytest -q tests
```

Run the check first; stop on a mismatch. Back up the service and its task database
before deployment. Startup adds nullable `actual_n` and `error_details` columns;
existing task records retain their requested counts.

This patch does not change billing and must not be validated by automatically
repeating a paid generation request. Pushing this repository publishes the chat
image through its existing workflow; the separate image-service container still
requires its own build and deployment.
