# Scoped browser acceptance rebuild candidate

Base: successful minimal native-driver branch head `ab82835a538d46801662d8a5f5cbce062c0a2da3`.
All original product/runtime files, original logical/security tests, network guard,
minimal proof and its original workflow remain unchanged. This is an additive
candidate, not a replacement of the historical acceptance record. It has not
been pushed, run in a browser, or accepted. Static contract review must finish
before the maintainer combines any publication and CI run.

## Classification and current scope

The authoritative case registry is `browser-tests/acceptance/contracts.ts`.
There are 13 scoped cases:
- F (2): Easy and Normal native input/audit/render completion, Pause with
  settings/rules, explicit resume, DOM-requested aborted Result, retry/restart/Home
  and fresh-accumulator 501 ms safety stop. Aborted Result does not establish
  natural victory, defeat or campaign completion.
- C (4): four Normal/two Easy controls, v2 draft/Cancel/Save/reload/reset,
  v1 raw-preserving read migration/no implicit write, future-schema refusal and
  explicit session-only use/reload, duplicate/cancel/save PC key binding connected
  to a consumed simulation tick. Reset changes draft only. A no-change Save does
  not have to create v2. Future data in an unchanged mode is not globally rejected.
- S (3): real mouse capture/outside drag/resize/release/fresh press; actual browser
  focus loss and explicit resume; native WEBGL_lose_context fault and reload-only
  recovery. The context-loss case pumps real queued app callbacks after loss,
  explicitly without claiming a GPU completion is possible on the lost context.
- D (4): 393x648 portrait, 568x320 landscape, 1280x720 PC, and measured 200% text
  at 393x648. Home, both HUDs, Pause, touch settings, keyboard settings, rules and
  aborted Result are visited. This is not fixed-reference visual comparison.

The adopted throttle contract supersedes old R20 v1 / A18 five-control wording:
Normal has fire/loop/throttle/bomb, Easy loop/bomb; v2 is the save target and legacy
v1 raw bytes remain protected. No fullscreen feature is invented.

## Observation contract

Gameplay uses only native mouse/keyboard and the product's DOM actions. The
proven controlled rAF/performance clock and separate real WebGL2 fence driver are
reused. No test calls the app's step/render/fixture, replaces render or fence APIs,
or resets app queues. Every standard frame waits for its own native fence.

Pause freezes simulation tick/hash and input; it does not promise drawing stops.
The 501 ms test starts a fresh mission with zero accumulator and drains the real
GPU before injection, then requires the accumulation-stop reason, ready=true and
unchanged tick. The >0.5 threshold is accumulated time, not just frame delta.

DOM geometry, clipping, text ranges and hit tests come from one evaluation per
batch. A concrete element gets one owner identity; aliases cannot manufacture
independent targets. Required fixed HUD information is never relabeled as
scrollable detail. Every declared HUD text fragment must be positive, visible and
inside its own full ancestor/descendant effective clip and viewport. HUD controls
and text share one atomic batch; control rectangles cannot cover another owner’s
text, and text collisions within and across owners fail. aria-hidden affects
accessibility, not visibility: visible preview labels remain inspected.
Intentional inactive `[hidden]` descendants are not current visible copy, while
an explicitly required hidden owner fails. Button checks require positive 44px
bounds, a name, and five unoccluded hit points.

Only actual overflow owners in Home/Pause/settings/rules/Result are traversed for
detailed text and major action reachability. Major buttons, mode labels, native
selects/reset controls and keyboard binding actions receive separate 44px/name/
hit/overlap checks at the reachable scroll positions. They are scrolled through their real DOM scroll API, not synthetic
wheel-event dispatch. Every original fragment must become visible in a fresh,
stable post-scroll observation. Stop positions derive from actual fragment
centers, avoiding a fixed increment skipping a narrow full-visibility interval.
A zero-width fragment, stale batch, changed
wrapping/content, hidden owner, absent route or incomplete traversal fails.
This is document reachability, not a claim that scrolling itself is native game
input. The actual game input route is verified separately.

200% text is an explicit test font-size injection with measured 2x computed sizes
and a fresh witness after layout; it is not CSS zoom, pinch zoom, DPR substitution,
or native browser page zoom. Native browser zoom200 remains a separate required
unverified gate. It cannot be claimed from the text test.

## Fail-closed results and CI proposal

The proposed workflow is scoped only to pushes to
`test/browser-acceptance-rebuild-20261007`; the maintainer owns any publication/run. It does not
modify main, create a PR, trigger the old PR jobs or modify the successful proof.
It uses the same pinned checkout/setup-node, exact pushed SHA, contents:read,
standard ubuntu-latest/Node24, no cache/artifact upload/larger runner, and a
30-minute job cap. The browser group has a separate 20-minute limit: SIGINT
requests Playwright cleanup/reporting, then a 30-second kill bound leaves the
always step time to produce a formal failed summary even if raw evidence is
missing. Runner loss or platform cancellation can still prevent the step. One worker and zero retries are configured. Per-case totals are separate from
product/individual-operation limits: F 360s (multiple missions and native frames),
C 300s (multiple preparations/reloads and native editor operations), S 240s
(native fault/recovery sequence), D 480s (eight screens, native frames and bounded
200-position document traversals). The existing 15s per-native-fence and 35s
preparation watchdogs are unchanged, as are every product safety/performance
threshold. Total harness/job expiration is incomplete evidence, not proof of a
product performance regression or permission to retry silently.

Unit/build and exact registry discovery must pass; historical default collection
must remain byte-identical to the original 34-test/four-file list. Product build
checks src only. The wider local strict check uses an existing separate
@types/node 24.19.1 installation; the workflow does not silently install it.

After browser execution, an always step emits the complete raw Playwright report
exactly once and a metadata-only index/summary with byte count/SHA256 markers.
Each case is saved as its own exact-byte local JSON file, indexed by RFC6901
pointer to its base64 body in the one raw report. The maintainer can reconstruct those
files exactly from the raw log without duplicate decoded payloads in that log.
Neither the index nor summary nests full case bodies or full error strings.
Missing/malformed raw reports still produce a formal failed index/summary.
It disables Actions command interpretation around raw evidence. Missing cases,
missing/duplicate/unknown checks, retry/skip, inconsistent counts, browser failure,
missing evidence or case errors prevent scoped success. `fullAcceptance` is always
false. The maintainer must retrieve, hash-check and archive logs before claiming preservation.
Images/traces are disabled and are not saved. Runner loss/cancellation/log expiry
can prevent evidence preservation and must be disclosed.

## Independent gates, not proved here

- Native select selected-option glyph clipping: value/selected label/disabled
  state/positive geometry/clip/44px/hit are recorded, but DOM Range does not
  expose native internal glyph paint
- Actual native browser zoom 200%, including measured browser layout/DPR change
- All multi-touch owner combinations, native pointercancel, visibility/orientation
  and lifecycle variants beyond the scoped mouse/resize/blur cases
- Every partial write/failed rollback/recovery-journal combination: existing
  logical unit tests are preserved; native storage scope above is narrower
- Natural campaign victory/defeat, 30 seeds and true physical side mirroring
- Normal-clock execution without clock or fault injection
- Designated real-device performance, maximum-combat loads and repeated-mission
  resource stability
- Fixed Kaisen/FF appearance/aircraft/camera comparisons and all GPU fault boundaries

## Native-widget and environment limits

Native option/optgroup text is explicitly classified outside ordinary Range
fragments: unselected options are not visible body text of a closed select.
The select itself remains a required native-widget observation/action with its
actual selected value/label, disabled state, geometry, clip and hit checks. Native
selected-glyph clipping is an explicit unverified gate, never silently passed or
used to claim all text is visually accepted. Zero-width ordinary required DOM
text remains a failure.

If this headless environment cannot produce a trusted window blur or provide the
native context-loss extension, that case is blocked, not passed and not asserted
to be a product defect. Playwright still fails the scoped run; raw case evidence
identifies the environment blocker. No automatic skip, retry or synthetic event
substitution is allowed.
