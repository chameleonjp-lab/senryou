# Layout reservation diagnostic — not product acceptance

The one diagnostic test measures 4 viewport/text profiles × both modes. Each
record includes the current real HUD and two detached-clone full-width alert-band
alternatives. Real DOM input starts the product; a real tick and native WebGL2
fence completion precede measurement. Normal's actual initialized pilot supplies
projectGunSight; missing pilot is an error, never a center-screen fallback.

The clones replace only documented notification/control text. They do not call
step, alter game state, fake render/GPU completion, or dispatch warning events.
They are layout envelopes, not proof of naturally occurring game warnings. The
four notification fields are warning, reload, prediction, and control status.
The current source never writes ally-announcements; the empty node remains in
the record and no fictional maximum is assigned to it. Source bounds and this
limitation are included in the evidence.

Every HUD element, direct nonempty text node (including empty Range results),
fragment rectangle, client/scroll boundary, own/ancestor clipping boundary,
control rectangle, font/viewport and actual sight+8px reservation is retained.
Recorded collisions are diagnostic findings, not removed or converted to pass.

`playwright.layout-diagnostic.config.ts` collects one test, with an independent
8-record × 3-scenario registry and output. Its checker validates completeness,
native preconditions, page/console/runner errors, and absence of retries. It
always sets productAcceptance=false and naturalWarningOccurrence=false. The
existing formal 13-case report remains missing/failing because that suite is
not executed in this diagnostic run. The old 34-test collection is unchanged.

The product layout candidate is unfinished: the dynamic full-width reservation
has not yet been adopted or proven feasible at 393×648 with text 200%. It is not
ready for merge or full acceptance. Font sizes/44px minima and the original D
validator are unchanged. Shared throttle/storage/security fixtures and source
parity manifest are unchanged. Runtime layout moves preserve valid custom
coordinates, keep migration peers at their minimum display clamp, defer ordinary
captured/preview-drag updates, and clear real input on viewport/font changes.
The formal S case contains additional real-input stability assertions, but is
not run by this diagnostic and must be verified before product acceptance.

The existing branch-scoped public standard Ubuntu/Node24 workflow is reused.
No artifact/cache/larger runner is added. Raw diagnostic JSON is logged once;
a small index records byte/SHA and base64 JSON pointers. Images/traces are not
saved. Source and evidence are preserved in the existing private recovery folder,
excluding CI setup/checkout logs. Actual CI duration and recovered byte hashes
will be recorded after the single run, not predicted here.

## Style-preserving diagnostic revision

The first measurement remains unchanged and separately preserved. In this
revision, every moved notification first receives its envelope text in the
original parent. Computed font family/size/weight, line height, spacing,
white-space, padding, margin, borders and related paint properties are recorded
and fixed on the detached node before reparenting. A before/after difference
fails the diagnostic; those metrics cannot be used as a required-height claim.

All raw nodes and raw geometric conflicts remain available. A separate visual
classification intersects client overflow clips and supported inset clip paths.
An offscreen clone uses host opacity zero only for measurement isolation; this
artificial host opacity is explicitly ignored for equivalent visibility, while
real CSS visibility:hidden (including a blocked lever) is not ignored. Hidden
accessibility descriptions keep their full text and ARIA relationships. Unknown
clip shapes remain uncertain, not silently successful. Fully clipped nonhidden
text and unavailable required controls are explicit findings.

The product's copied flag is now named liveSourceControlLayoutFits and is never
a clone verdict. Circle relations include nearest distance, actual/margin
penetration and overlap rectangle. The 0.05 CSS-pixel diagnostic classification
tolerance distinguishes subpixel contacts from true overlap; no original raw
measurement or formal acceptance threshold is changed.

src/layout-diagnostic-math.ts is imported only by this diagnostic and its unit
test, never by product runtime. It uses the existing exact source-file manifest
route; no network-guard permission is widened. Product source/UI from the first
candidate is unchanged in this revision and remains unaccepted.

Nonempty envelope text requires exact text and positive raw range geometry. A
known viewport clip may leave a zero visible intersection: that is a measured
overflow finding, not missing measurement and never product acceptance. Hidden
or display:none envelopes, absent raw ranges and unsupported clip shapes fail
measurement completeness.
