# Communication acceptance gate

## Scope

This acceptance-only change enforces the existing R01/R02 no-external-communication boundary. It does not add or change game behavior, persistence, rankings, runtime dependencies, or deployment. The game files and built production artifacts are unchanged from reviewed main `593cddeca36cbda3fec62eacea462667bf1faeab`.

## Required observations

- Keep all three inherited smoke scenarios and their existing UI/game assertions
- Run candidate smoke against the local production preview on `http://127.0.0.1:4179`, without a development/HMR WebSocket exception. Existing throttle and cross-repository checks retain their development servers
- Install context-wide HTTP and WebSocket handlers before creating a page, with service workers blocked
- Permit only GET requests for files actually present in `dist`, on the exact preview origin, without URL credentials or query payloads
- Fetch permitted local static responses with `maxRedirects: 0`; reject every 3xx instead of following it. Arbitrary loopback ports, API paths, unknown assets, non-GET methods and external destinations are blocked
- Never call `connectToServer()` for a WebSocket. Record the attempt and close the routed socket before upstream transmission
- Independently reject any recorded forbidden attempt after context teardown, even when the application catches its own error and `pageErrors` stays empty. Preserve evidence after UI, network and teardown failures
- Require `blockedExternal` to be present, an array, and empty in each candidate and pinned-baseline smoke record. Preserve its raw value and a presence flag in the comparison artifact
- Reject candidate evidence containing `failure` or `networkFailure`, independently of a purportedly passed runner report
- Require one actual smoke result for each intended viewport. Cross-check failed result statuses against counts and step outcome; preserve the observed outcome and the separately reported step outcome

A genuine failed historical baseline remains diagnostic. Missing/malformed network evidence, forbidden attempts, missing or incomplete reports, contradictory results, global runner errors, and candidate failures are not waived. This gate does not convert unrun browser checks or historical evidence into current acceptance.

## Regression fixtures

`tests/network-guard.test.ts` invokes the real guard with inert route doubles. It covers exact static assets, methods, alternate origins and ports, query payloads, missing build output, redirect refusal, HTTP abort, and WebSocket closure without upstream connection. Forbidden URL values are strings only; no test request is transmitted.

`tests/summarize-throttle-smoke.test.ts` runs the real summarizer on isolated, explicitly synthetic reports. It covers clean evidence; missing, malformed and nonempty network arrays in either version; handled errors with empty `pageErrors`; inconsistent candidate failure evidence; duplicate viewports; failed results concealed by passed counts; baseline diagnostics; and inherited report failure controls.

## Local verification, 2026-10-06

- Full unit suite: 154 passed, zero skipped or failed, using existing installed dependencies through `node --import tsx --test tests/*.test.ts`
- Application typecheck: `node node_modules/typescript/bin/tsc --noEmit` passed
- Production build: `node node_modules/vite/bin/vite.js build` passed; existing bundle-size warning remains
- Unchanged source: all 49 runtime/configuration/dependency source files checked byte-for-byte against the pinned base
- Separate base and candidate production builds: all four output files are byte-identical (HTML, JavaScript, CSS, third-party notices)
- Additional strict typecheck of test-only files was not completed because the existing dependency set has no `@types/node`; no dependency was added
- Browser suites and CI were not run in this local verification. Bundled browser engines are absent, and the environment's system-browser launch capability is unavailable. Existing required CI remains required, including candidate browser checks and the pinned baseline comparison

The first package-manager-based unit invocation was interrupted after an unexpected registry lookup and is not counted as a pass. Verification used direct installed Node executables with update notifications disabled; no packages or browsers were downloaded. Synthetic regression fixtures prove the acceptance predicates and route decisions, not live browser interception or a full-game acceptance pass.
