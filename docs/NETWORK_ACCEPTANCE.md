# Communication acceptance gate

## Scope

This acceptance-only change enforces the existing R01/R02 no-external-communication boundary. It does not add or change game behavior, persistence, rankings, runtime dependencies, or deployment. The game files and built production artifacts are unchanged from reviewed main `593cddeca36cbda3fec62eacea462667bf1faeab`.

## Required observations

- Keep all three inherited smoke scenarios and their existing UI/game assertions
- Run candidate smoke against the dedicated local development server on `http://127.0.0.1:4179`, using the test-only `vite.browser-tests.config.ts`. This preserves the existing DEV-only `window.__senryou` oracle and all ready/state assertions. Existing throttle and cross-repository checks retain their development servers
- Install context-wide HTTP and WebSocket handlers before creating a page, with service workers blocked
- Permit only GET requests for exact existing files in the recursive source, Three.js import graph and Vite-client manifest, on the exact acceptance origin, with expected resource types and without URL credentials, fragments or query payloads. Dependency prebundling is disabled for this test server so there are no version-query or generated-cache exceptions. The browser icon is an explicit inert in-memory response
- Fetch permitted local static responses with `maxRedirects: 0`; reject every 3xx instead of following it. Arbitrary loopback ports, API paths, unknown assets, non-GET methods and external destinations are blocked
- Never call `connectToServer()` or forward/send WebSocket messages. Only the exact HMR URL/token observed in the served Vite client is kept as an inert open mock, consuming messages locally to avoid reconnect/pageerror side effects. Every other socket, including wrong-token and pre-observation requests, is recorded and closed before upstream transmission
- Independently reject any recorded forbidden attempt after context teardown, even when the application catches its own error and `pageErrors` stays empty. Preserve evidence after UI, network and teardown failures
- Require `blockedExternal` to be present, an array, and empty in each candidate and pinned-baseline smoke record. Preserve its raw value and a presence flag in the comparison artifact
- Reject candidate evidence containing `failure` or `networkFailure`, independently of a purportedly passed runner report
- Require one actual smoke result for each intended viewport. Cross-check failed result statuses against counts and step outcome; preserve the observed outcome and the separately reported step outcome

A genuine failed historical baseline remains diagnostic. Missing/malformed network evidence, forbidden attempts, missing or incomplete reports, contradictory results, global runner errors, and candidate failures are not waived. This gate does not convert unrun browser checks or historical evidence into current acceptance.

## Regression fixtures

`tests/network-guard.test.ts` invokes the real guard with inert route doubles. It covers exact physical assets including nested `src/battle` files, resource types, methods, alternate origins and ports, query payloads, redirect refusal, HTTP abort, exact observed-token inert HMR, and forbidden WebSocket closure without upstream connection. It also resolves the actual acceptance Vite config in serve mode and verifies that DEV remains true. Forbidden URL values are strings only; no test request is transmitted.

`tests/summarize-throttle-smoke.test.ts` runs the real summarizer on isolated, explicitly synthetic reports. It covers clean evidence; missing, malformed and nonempty network arrays in either version; handled errors with empty `pageErrors`; inconsistent candidate failure evidence; duplicate viewports; failed results concealed by passed counts; baseline diagnostics; and inherited report failure controls.

## Local verification, 2026-10-06

- Full unit suite: 156 passed, zero skipped or failed, using existing installed dependencies through `node --import tsx --test tests/*.test.ts`; focused communication/report checks: 34 passed
- Application typecheck: `node node_modules/typescript/bin/tsc --noEmit` passed
- Production build: `node node_modules/vite/bin/vite.js build` passed; existing bundle-size warning remains
- Unchanged source: all 49 runtime/configuration/dependency source files checked byte-for-byte against the pinned base
- Separate base and candidate production builds: all four output files are byte-identical (HTML, JavaScript, CSS, third-party notices)
- Additional strict typecheck of test-only files was not completed because the existing dependency set has no `@types/node`; no dependency was added
- Initial PR #5 CI at `6c54846240bb36a74e3d1240a9ab0f8f64cbb704` failed all three candidate smoke cases at `ready()`: the production preview had stripped the DEV-only oracle. Their network and error arrays were empty. [Failed run](https://github.com/chameleonjp-lab/senryou/actions/runs/37426202455)
- This correction changes only the harness and preserves the original ready/state checks and production behavior. Browser suites for the corrected harness were not run locally: bundled browser engines are absent, and the environment's system-browser launch capability is unavailable. Corrected-head CI remains pending and required, including candidate browser checks and the pinned baseline comparison

The first package-manager-based unit invocation was interrupted after an unexpected registry lookup and is not counted as a pass. Verification used direct installed Node executables with update notifications disabled; no packages or browsers were downloaded. Synthetic regression fixtures prove the acceptance predicates and route decisions, not live browser interception or a full-game acceptance pass.
