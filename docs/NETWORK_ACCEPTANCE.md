# Communication acceptance gate

## Scope

This acceptance-only change enforces the existing R01/R02 no-external-communication boundary. It does not add or change game behavior, persistence, rankings, runtime dependencies, or deployment. The game files and built production artifacts are unchanged from reviewed main `593cddeca36cbda3fec62eacea462667bf1faeab`.

## Required observations

- Keep all three inherited smoke scenarios and their existing UI/game assertions
- Run candidate smoke against the original development server on `http://127.0.0.1:4178`, sharing the existing server with the throttle checks. Both Playwright configurations are restored byte-for-byte to reviewed main. There is no extra server or optimizer override, and the existing DEV-only `window.__senryou` oracle, screenshots, timings and PC assertions remain intact
- Install context-wide HTTP and WebSocket handlers before creating a page, with service workers blocked
- Permit only GET requests for exact existing files in the recursive source, Three.js import graph and Vite-client manifest, on the exact origin with expected resource types. Preserve the original dependency optimizer. A generated script additionally needs an exact import/export URL observed in an already-approved served module plus current metadata binding to a known Three source or its reachable generated chunk. Its real file must remain inside the configured cache directory
- Cached script queries must be the sole exact `v` hash from the observed import. Vite's persisted metadata omits per-entry live hashes, so metadata alone cannot authorize a URL and a served URL alone cannot authorize a file. Reject arbitrary hashes, duplicate/extra queries, credentials, fragments, traversal, unknown files and fetch-style requests. Missing metadata may wait for a bounded optimizer commit before the child fetch, with no wildcard fallback. The browser icon is an explicit inert in-memory response
- Fetch permitted local static responses with `maxRedirects: 0`; reject every 3xx instead of following it and reject non-200 asset responses before they can authorize imports or HMR. Arbitrary loopback ports, API paths, unknown assets, non-GET methods and external destinations are blocked
- Never call `connectToServer()` or forward/send WebSocket messages. Only the exact HMR URL/token observed in the served Vite client is kept as an inert open mock, consuming messages locally to avoid reconnect/pageerror side effects. Every other socket, including wrong-token and pre-observation requests, is recorded and closed before upstream transmission
- Independently reject any recorded forbidden attempt after context teardown, even when the application catches its own error and `pageErrors` stays empty. Preserve evidence after UI, network and teardown failures
- Require `blockedExternal` to be present, an array, and empty in each candidate and pinned-baseline smoke record. Preserve its raw value and a presence flag in the comparison artifact
- Reject candidate evidence containing `failure` or `networkFailure`, independently of a purportedly passed runner report
- Require one actual smoke result for each intended viewport. Cross-check failed result statuses against counts and step outcome; preserve the observed outcome and the separately reported step outcome

A genuine failed historical baseline remains diagnostic. Missing/malformed network evidence, forbidden attempts, missing or incomplete reports, contradictory results, global runner errors, and candidate failures are not waived. This gate does not convert unrun browser checks or historical evidence into current acceptance.

## Regression fixtures

`tests/network-guard.test.ts` invokes the real guard with inert route doubles. It covers exact physical assets including nested `src/battle` files, resource types, methods, alternate origins and ports, query payloads, redirect refusal, HTTP abort, exact observed-token inert HMR, and forbidden WebSocket closure without upstream connection. It also resolves the actual acceptance Vite config in serve mode and verifies that DEV remains true. Forbidden URL values are strings only; no test request is transmitted.

`tests/summarize-throttle-smoke.test.ts` runs the real summarizer on isolated, explicitly synthetic reports. It covers clean evidence; missing, malformed and nonempty network arrays in either version; handled errors with empty `pageErrors`; inconsistent candidate failure evidence; duplicate viewports; failed results concealed by passed counts; baseline diagnostics; and inherited report failure controls.

`tests/optimizer-manifest.test.ts` checks the intersection of exact observed script imports and metadata/physical-file evidence, including all query/method/resource-type negatives, comments and arbitrary strings, unknown chunks, source mismatch, traversal, symlink escape, and metadata revalidation on each child request. Real warm and cold controls use installed Vite in-process with an isolated cache, no listening server or browser. They generate actual optimizer metadata and actual transformed imports without sending HTTP or WebSocket requests.

## Local verification, 2026-10-06

- Full unit suite: 168 passed, zero skipped or failed, using existing installed dependencies through `node --import tsx --test tests/*.test.ts`
- Application typecheck: `node node_modules/typescript/bin/tsc --noEmit` passed
- Production build: `node node_modules/vite/bin/vite.js build` passed; existing bundle-size warning remains
- Unchanged source: all 49 runtime/configuration/dependency source files checked byte-for-byte against the pinned base
- Separate base and candidate production builds: all four output files are byte-identical (HTML, JavaScript, CSS, third-party notices)
- Additional strict typecheck of test-only files was not completed because the existing dependency set has no `@types/node`; no dependency was added
- Initial PR #5 CI at `6c54846240bb36a74e3d1240a9ab0f8f64cbb704` failed all three candidate smoke cases at `ready()`: the production preview had stripped the DEV-only oracle. Their network and error arrays were empty. [Failed run](https://github.com/chameleonjp-lab/senryou/actions/runs/37426202455)
- At `920b59f0af9ae74406e95367d44c66ada5841abd`, both phone smoke cases passed but PC smoke reached a runtime graphics-safety stop after Easy/result, leaving Normal Start disabled. The retained screenshot and error context show the graphics-stopped/reload message; the final queue snapshot was lost when the overall test timed out. [Failed run](https://github.com/chameleonjp-lab/senryou/actions/runs/37428136587)
- The original pre-guard main content had passed this complete PC flow in [PR #4's final run](https://github.com/chameleonjp-lab/senryou/actions/runs/37281545640): head `753644991a7b493229552af0d5109150d6e9cec3` and merged main `593cddeca36cbda3fec62eacea462667bf1faeab` have the same Git tree. The older `71b0e5b` diagnostic baseline is not that main content
- This subsequent correction restores original optimizer and server-load conditions changed by the harness; it is not a demonstrated runtime fix. The 1-second GPU safety bound, logical timing, screenshots, viewport, DPR and all gameplay assertions remain unchanged. Browser verification of this new head is still required; do not rerun an unchanged failed head until it passes or waive PC failure
- Browser suites for this correction were not run locally: bundled engines are absent and the system-browser launch capability is unavailable. Local in-process optimizer controls prove only harness configuration, file binding and route decisions, not browser/game acceptance

The first package-manager-based unit invocation was interrupted after an unexpected registry lookup and is not counted as a pass. Verification used direct installed Node executables with update notifications disabled; no packages or browsers were downloaded. Synthetic regression fixtures prove the acceptance predicates and route decisions, not live browser interception or a full-game acceptance pass.
