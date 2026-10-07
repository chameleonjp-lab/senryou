# Isolated native driver proof

This candidate workflow runs only pushes to `test/native-driver-proof-20261007`.
It does not run for pull requests, main, tags or other branches. Do not open a PR
at this stage: the two existing PR workflows are unchanged. No workflow has been
published or dispatched as part of preparing this candidate.

The job checks out the exact push SHA, uses read-only contents permission,
Node 24, standard `ubuntu-latest`, no package cache, no larger runner and no
artifact upload. Under the public-repository standard-runner scope confirmed for
this task, estimated runner charges are zero. Logs and job summaries are outside
artifact storage usage under [GitHub's Actions billing documentation](https://docs.github.com/en/billing/concepts/product-billing/github-actions)
(checked 2026-10-07). This estimate is not permission to use paid runners, private
repository billing or artifact storage. There is a 15-minute job timeout, one
proof case and zero Playwright retries. Record the actual run URL, exact SHA,
duration and job/step conclusions after the authorized run; none are known yet.

Before browser execution, the job runs the locked unit suite and product build,
checks dedicated discovery is one case, and checks standard discovery matches
the exact pinned-base list (34 tests/four files, SHA256
`b1e3f402b4cecb3f3ef67474314b80f4a115a88379cbafd1f17605662c206288`).
The normal build checks `src`; it does not type-check browser proof files.
The separate local strict proof type-check passed using existing isolated
`@types/node` 24.19.1. This workflow does not install that type-only dependency
or claim to repeat that wider check.

The real native-browser step preserves its own failing exit code. An `always()`
step prints the complete Playwright JSON report and every `application/json`
attachment, including the native driver proof, to the run log. Each block has
byte count and SHA256 framing so the root can retrieve it and verify complete
bytes before saving to Drive under the existing authorization. Workflow-command
interpretation is disabled while printing evidence. No environment or credential
dump is included. A missing report, missing native proof or unreadable JSON
attachment fails evidence extraction rather than claiming preservation.

After the run, verify both Easy and Normal records, report and attachment hashes,
browser exit status and log completeness before reporting success. Logs may be
truncated or expired, and a cancelled job/runner failure may prevent the final
step; any incomplete evidence must be reported as unsaved. Images and traces are
not uploaded or copied to logs and must not be described as saved. Local runner
paths in the report do not make those files retrievable after teardown.

Passing this single-PC controlled-clock proof is not full acceptance, mobile or
zoom coverage, normal-clock responsiveness or performance validation. Do not
change runtime behavior, old tests, the network guard, or app-owned GPU fences
to make the proof pass.
