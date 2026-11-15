# Upstream compatibility tests

Run from the repository root:

```sh
npm run check-types
npm test
npm run test:compat
npm run package
```

The compatibility suite is an offline CI gate. It uses ordinary assertions;
no expected-failure annotations or skips hide defects. A green helper suite
alone does not establish compiler compatibility.

The corpus contains 1924 independently recorded compiler cases. Together with
parser and project regressions, the suite has 2117 checks. The helper suite has
82 checks. These totals describe the validation-queue repair on 2026-11-15; they are not
proof that every language construct or editor behavior is covered.

Coverage includes root/section/choice structure, quality/info schemas, contextual
scene references, target titles, numeric/boolean coercion, executable property
JavaScript, shorthand grammar/visit dependencies, QDisplay structure and shared
rich-content traversal. The 556 rich-content compiler cases cover expressions,
magic predicates/inserts, nesting, escaping, hidden/emphasis/paragraph structure,
unfinished delimiters, all text locations and linked/unlinked visits. Thirty new
public parser/project regressions check positions and incremental transitions.
Another 21 regressions exercise actual activateCore event wiring and the project
coordinator with fake timers and gated host reads/discovery: multi-file batches,
queued edits, superseded publication, source snapshots, deletion, read recovery,
virtual URI variants and deactivation. The host supplies events/IO only; no queue
or validator implementation is replaced.
QDisplay cases cover ranges, comments, continuations, filenames, reserved IDs
and built-in references; project regressions check retained/cleared diagnostics
and duplicate-ID warnings. Source positions, configuration and incremental edits
are exercised through the public boundaries below.

Focused commands:

```sh
npm run test:compat -- --testNamePattern=shorthand-
npm run test:compat -- src/compatibility/javascript.compat.ts
npm run test:compat -- src/compatibility/qdisplay.compat.ts
npm run test:compat -- src/compatibility/rich-content.compat.ts
npm run test:compat -- src/compatibility/validation-queue.compat.ts
npm test -- src/qdisplay.test.ts
```

Compiler errors and authoring warnings are distinct. Dynamic qualities/functions
are legal; unlinked visit fields and missing startup/call targets warn. Custom
missing-display diagnostics and duplicate-display warnings are authoring policy.
Built-in formatters need no file. Overlap and source order are legal QDisplay
semantics, with the first inclusive matching range selected at runtime.

Engine API/member types and real VS Code activation/events/highlighting remain
outside the established coverage. Ordinary content magic is opaque HTML; content
JavaScript is checked only in inserts and predicates. QDisplay traversal checks
the output actually captured by upstream, including its continuation quirks.
The preserved audit findings and dated developer diary record earlier red
baselines; they do not describe the current implementation status.

## Boundaries and assertions

The user agreed to `parseText(text, filename)` and
`DendryProjectValidator.validateProject(files)` as the public boundaries.
`vscode-host.ts` supplies only host values, configuration defaults and in-memory
documents. All extension language code runs normally. Tests do not inspect
private project caches or call private validators.

`corpus.json` defines shared valid `info.dry` and root inputs. A case replaces
defaults by filename and adds its other files. Every case documents its source.
Project tests compare acceptance with upstream compilation: accepted projects
must have no errors; rejected projects must have an error on the relevant file
about the expected subject. Optional authoring warnings are permitted. Exact
compiler messages are evidence, not the extension's required wording. IO or
host-stand-in exceptions must not count as successful rejection diagnostics.

Parser checks use the upstream raw parser's independently recorded content,
option properties and qualified section IDs. This prevents silence caused by
discarded content or disconnected validation from looking like full support.
Current acceptance of `quality-string-initial`, for example, does not establish
quality support: its missing-name counterpart must also report an error.

The host stand-in exercises real project logic and activation/event scheduling,
including selected incremental transitions and source positions. Fake event emitters,
fake clocks and gated IO do not establish real VS Code host timing, discovery,
highlighting or browser execution, and do not cover every audit finding.

The standalone root missing-display regression preserves an existing extension
diagnostic. The reference compiler accepts an unknown formatter name, so this
case is deliberately outside the compiler acceptance corpus.

## Reference and regeneration

Reference: [aucchen/dendrynexus at
2df80695cbe29743b4d9a1a43f5d9b36eaaac0b7](https://github.com/aucchen/dendrynexus/tree/2df80695cbe29743b4d9a1a43f5d9b36eaaac0b7),
the 2026-11-15 audit revision. Minimal inputs are adapted from its MIT-licensed
parser tests and the local audit probes; source references are attached to each
case. No upstream runtime or dependencies are bundled in this test suite.

Normal tests run offline from the committed recordings. They need neither the
ignored audit directory nor an upstream checkout, and they verify that the
recording matches the corpus hash. JSON file LF/CRLF differences are normalized;
the source strings inside JSON are preserved.

To re-execute upstream and **verify** the recording using the local audit tree:

```sh
node src/compatibility/record-upstream.cjs docs/compat-audit/dendrynexus-2df80695cbe29743b4d9a1a43f5d9b36eaaac0b7 docs/compat-audit/runtime/node_modules
```

The two path arguments may instead point to another copy of that exact upstream
revision and a `node_modules` directory containing **lodash 3.10.1** and
**async 1.5.2**. They are only needed for reference verification/regeneration.
The recorder verifies source hashes against the recording and dependency versions,
then runs the real full compiler in one isolated process per case. This isolation
handles upstream asynchronous throws and repeated callbacks on invalid files.
The worker also calls upstream's raw parser for the selected parser cases.

Fixture paths use portable forward slashes. The worker translates them to the
host separator before invoking upstream, matching its native filesystem inputs.
This is required for nested paths on Windows because dry.js strips only the
native separator. The duplicate-QDisplay fixture retains both folder-qualified
workspace files and independently verifies compiler acceptance plus warnings.

After adding or changing a case, regenerate explicitly:

```sh
node src/compatibility/record-upstream.cjs <upstream-root> <dependency-node_modules> --write
```

Inspect the corpus and recording changes together. Do not regenerate expectations
from extension output or weaken assertions to make the baseline green. Source
changes to the pinned engine require a deliberate reference update; the recorder
refuses a different source hash even with `--write`.
