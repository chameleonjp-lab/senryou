# Senryou UI-only checks

Scope: based on main commit a5ac5f4517855ca99d6d285acd148f6417808d38. A passing build or fixture check is not visual acceptance; only captured images that have been inspected can be marked reviewed.

## Product changes

- The four existing product files changed are index.html, src/main.ts, src/control-settings.ts, and src/style.css. The HUD groups notice text and readouts so the flight controls can reserve space around them.
- Four small runtime modules calculate reserved control footprints, HUD geometry, notification-state occupancy, and sight reservations. Three unit-test files cover those modules.
- The game simulation, terrain, weapons, combat loop, ordinary Vite config, package manifest, and lockfile are unchanged.
- The UI fixture reads the product HTML and CSS. It extracts thirteen product UI functions, the existing event-listener block, and eight product Canvas2D painter/projection methods. Source hashes and dependencies are pinned; drift stops the fixture.

## UI-only capture boundary

- The fixture uses the actual ControlSettings, RulesGuide, FlightControls, keyboard settings, product event bindings, and shared Canvas2D HUD painter. Fixed display samples stand in for a running mission, scoring, targets, and audio.
- It replaces only the product script at the private development route /__ui_only__/. It blocks external requests and fails if the fixture asks for WebGL. It does not start a continuous frame loop, game simulation, combat, or physics.
- The 22 representative states are Home, Easy and Normal HUD, notice HUD, touch and keyboard settings, waiting, spectating, Pause, Rules, four result types, startup and paused errors, and a desktop HUD. Three short actions check Home/Pause transitions, result and resize clearing, and settings/Rules return focus.
- The browser records the Canvas2D pixel count, visible control center-hit observations, and screenshots. `centerHit` is data only: a false value does not fail the capture and is not a passing assertion. Every screenshot row carries the batch identity, a fingerprint of the final source-hash map, and that image's SHA-256. The extraction and Vite reports carry the same batch identity and source hashes. Image review is recorded separately from capture. DOM text is measured at 200%; fixed-size Canvas text and native browser zoom are not described as 200%.
- Capture has a 65-second UI limit and a 90-second overall limit. Setup time, UI capture time, and later image review time are reported separately. A captured image is not treated as reviewed or passed automatically.
- Local evidence on 2026-10-08 after the workflow bootstrap and manual-entry updates: the fresh approved-route unit run passed 210 tests; the standard TypeScript/Vite build, fixture strict types, and 15 Vite transforms passed. Fixture/Vite batch `7fb61812-33f3-4a18-8ecc-5b54fae790ff` contains 39 source hashes with fingerprint `67e8dc6e8be1242617ff202fec9158e8011e1d2e910a7940f73853380185d6a5`; extraction did not modify product source. The local browser capture was not run. CI capture is separate: 0 images or uninspected images are not a visual pass. An earlier approved capture on a preceding source batch was blocked before UI-ready because the Playwright Chromium executable was absent (139 ms setup-inclusive, 0 screenshots); it is historical evidence and does not validate this batch. Center-hit observations are absent from local evidence; if captured later, `false` is observational data and does not fail capture. Radar/DOM overlap, Canvas clear/resize, DOM text 200%, Canvas fixed-font behavior, and all other local image observations remain unverified until actual pixels are inspected. A missing image is never treated as a pass.

## Local verification commands

1. node browser-tests/ui-only/check-fixture.mjs
2. npx tsc --noEmit --project tsconfig.ui-only.json
3. node browser-tests/ui-only/validate-vite.mjs
4. npm test
5. npm run build
6. npx playwright install chromium
7. node browser-tests/ui-only/capture.mjs

The generated strict-typecheck modules are stored under browser-tests/ui-only/generated, which is excluded only by this local Git checkout and is not part of the proposed path list. Reports and screenshots go to UI_ONLY_EVIDENCE_DIR or a sibling folder named senryou-ui-only-evidence. Reports and screenshots are outside the repository.

## Proposed pull-request CI

- The existing throttle-lever workflow skips its old full browser/GPU job automatically only for the same-repository branch codex/senryou-ui-only-20261008 targeting main. Forks, other branches, and that branch targeting another base keep the old automatic job. The workflow also has a manual `workflow_dispatch` entry; after this change is merged, choose “Senryou throttle lever checks” in Actions and select the branch to run the old GPU/gameplay suite manually. This PR does not dispatch it.
- The existing throttle workflow contains the bounded UI-only job for pull requests from that same repository, exact branch, and main base. Its condition complements the legacy GPU job's skip condition, with no changed-path filter. The UI-only job runs npm test, the usual build/type check, strict fixture types, Vite transforms, and a bounded Chromium capture. The separate ui-only workflow provides a manual UI capture after it reaches the default branch. Neither route runs test:browser, gameplay, WebKit, native input drivers, or GPU checks.
- Screenshots and reports are uploaded as a short-lived artifact. CI capture still reports images as needing visual review; it cannot replace a human image inspection.

## Restore

Do not use `git clean`, `git reset`, or a mutable `HEAD` reference to restore this local candidate. Use the review bundle's `path-manifest.json` and `restoration/BACKUP-MANIFEST.json` with the six separately saved originals under `restoration/main/`.

Use only the exact relative destinations listed in `path-manifest.json`. Reject absolute paths, `.`/`..` components, normalized aliases, and destinations outside the checkout or newly created quarantine/staging directories. Candidate files, originals, and copies must be regular files, not symlinks or special files. Check every ancestor component with `lstat`; it must be a real directory, not a symlink. Stop if any check fails.

Before restoring, confirm the checkout's nonignored candidate changes are exactly the 26 manifest paths: 21 additions and five modifications. Verify all 26 candidate SHA-256 values, the six saved originals against `restoration/BACKUP-MANIFEST.json`, and each modified path's before-file blob against the manifest's `beforeGitBlob` field. Create new, empty quarantine and staging directories outside the checkout; all exact quarantine destinations and five staging destinations must be absent. If a path is missing, extra, outside the manifest, mismatched, a symlink/special file, or collides, stop without changing the checkout. Leave ignored generated files, build output, and evidence untouched. Copy all 26 candidate files to quarantine with exclusive creation and verify their hashes. Then remove only the 21 verified added paths. For the five modified paths, copy originals from `restoration/main/` into staging, verify each `beforeGitBlob`, recheck each checkout destination is a regular file with no symlink ancestor and its SHA-256 matches that exact path's candidate SHA-256 in `path-manifest.json`, then replace only those five exact destinations. Keep all six originals and the candidate quarantine.

To undo that restore, first verify all 26 quarantined candidate files and six originals. Preflight every destination before writing: each of the 21 added destinations must be absent; each of the five modified destinations must be a regular file with no symlink ancestor and must match its manifest `beforeGitBlob`. Check every ancestor with `lstat` and allow only exact manifest destinations. Stop without changing anything on any mismatch, collision, out-of-scope path, symlink, or special file. Create the 21 additions only at their absent exact destinations with exclusive creation; verify each candidate SHA-256. For each of the five modified paths, keep its saved original under `restoration/main/` unchanged, recheck the exact destination's `beforeGitBlob` immediately before replacement, and verify the matching quarantined candidate hash. Write those candidate bytes to a new regular temporary file in the verified destination directory, replace only that exact modified destination, and verify its candidate SHA-256. Keep the quarantine and all six original backups. This procedure has not been executed.
