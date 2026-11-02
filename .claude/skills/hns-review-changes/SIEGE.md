# Siege

Reached only at `siege`, after `PARTITION.md`'s shard table exists and before anything is spawned. `siege` is `review` plus the three things a partitioned lens pass cannot produce: an understanding of the change that lives off-diff, a trace of every surface it exposes, and an independent attempt to refute every candidate before the overview may call it `confirmed`. It is the level for a change that can break something expensive and quietly, so it also says what it may spend and what stops it.

The parent still reviews nothing. It decides shape, extends the shard table, pools candidates, assigns skeptics and reconciles — from control JSON only. Every satellite is read-only.

## Shape decides strategy

Two booleans, computed from the changed-file list alone with **no agent judgement**, so the same diff always produces the same fan-out.

- `wide` — **product files** number more than `WIDE_FILE_THRESHOLD` = **10**, or the distinct owner zones among them number at least `WIDE_ZONE_THRESHOLD` = **4**. A product file is one not under `tests/`, `docs/`, `.github/`, `.husky/`, not `*.md`, and not a translation catalogue.
- `deep` — any of: a consequence zone owns a changed file (`deletion-guard`, `realtime`, `plugin-surface`, `config`); a dependency manifest changed (`package.json`, `package-lock.json`); the diff is itself a fix pass over an earlier review (more than one commit in the range touching the same product file); the user asked for `siege` above the floor.

| `wide`  | `deep`  | Shape       | Fan-outs, beyond the partition                           |
| ------- | ------- | ----------- | -------------------------------------------------------- |
| `false` | —       | narrow-deep | trace, surface, prosecute, one skeptic set per candidate |
| `true`  | `false` | wide        | surface, prosecute, skeptics batched                     |
| `true`  | `true`  | wide-deep   | trace, surface, prosecute, skeptics batched              |

Record the shape, both booleans, and the counts that produced them in coverage.

## Trace — the perspective fan-out

Runs when the shape carries `deep`. Perspectives run concurrently with the partition shards; each reads the whole diff to answer **one** question, writes `pr-<n>-<perspective>-analysis.md`, and returns the shard JSON from `PARTITION.md` with `"shard": "<perspective>"`, `"zone": null`, and `covered` holding what it actually traced.

- `intent` — reconstruct the _why_ from `git log`, `git blame` on the touched lines, and prior attempts or reverts in the same area. **Not from the PR body or the CHANGELOG as truth**: a gap between what the prose claims and what the code does returns as a candidate, which is the point.
- `blast-radius` — trace every changed symbol to its callers, server and admin sides both, and across the socket. Anything a changed value reaches that the diff did not update returns as a candidate; symbols it could not follow go in `overflow.unreached`.
- `dependency` — **only when a manifest changed**: per package added, removed or bumped, the changelog between the versions, its breaking changes, and how this plugin actually uses the changed surface at real call sites.
- `regression` — **only when the range contains a fix commit**: for each behaviour the range changes, does the new code reintroduce a state the old code handled, and does the fix address the mechanism or the symptom? This is the pass that catches a fix whose own escape hatch is worse than the bug.

A perspective that did not run is named in coverage with its mechanical reason — `dependency: no manifest changed` — never omitted.

## Surface — full tracing

Runs whatever the shape, when a changed file is owned by or rides along on `plugin-surface`, `deletion-guard` or `config`. These are the contracts that break silently and off-diff: an operator's integration breaks, not this plugin's tests.

One `surface-<zone>` shard per such zone, given every file that zone owns or rides along on. It enumerates every symbol the outside can observe and returns one verdict per symbol:

- `plugin-surface` — the `./strapi-admin` and `./strapi-server` exports, the registered routes and their declared auth, the controller response shapes, the widget registration, the published `files` list, and the minimum Strapi version any new API implies. The consumer is the host project, not this repo.
- `deletion-guard` — every request shape matched, and for each: the HTTP status, `error.name`, and every key under `error.details` an API client could parse. A refusal is a public API. Also what the guard now says to an **unauthenticated** caller that it did not say before.
- `config` — every plugin config key, its accepted types, its default and its ceiling. A default change is a behaviour change for everyone upgrading.

```json
{
  "shard": "surface-<zone>",
  "symbols": [
    {
      "symbol": "…",
      "anchor": "<path:line>",
      "consumers": 0,
      "verdict": "compatible | breaking | undocumented-change"
    }
  ],
  "unreached": [{ "symbol": "…", "reason": "…" }],
  "findings": [],
  "analysisPath": "pr-<n>-surface-<zone>-analysis.md"
}
```

Anything not `compatible` returns as a `breaking` candidate; a symbol it could not trace is named in `unreached` with the reason.

## Pool — the candidate ledger

When every partition, trace and surface shard has returned or been re-split, the parent pools every returned finding into one ledger: identical `anchor` values collapse into one candidate with both finders named, each candidate gets `C<n>` in return order, and the ledger records which shard found it. This is the list the adversarial pass attacks. Every `C<n>` leaves it as `confirmed` or as a `## Refuted candidates` entry — there is no third exit.

## Prosecute — the adversarial pair

Always at `siege`, once the ledger exists. Two concurrent satellites, each given the whole diff, `LENSES.md` with the aggregate zones, and the ledger.

- `prosecutor` — briefed to prove the change wrong or incomplete. Its brief names the states this plugin keeps getting wrong, so the hunt starts somewhere concrete rather than at "think of an edge case":
  - a player who reloads, disconnects, or opens a second tab **during** the phase the change touches, rather than between phases;
  - a tab that is backgrounded, or that slept through a packet and wakes up believing it still holds the game;
  - two players on the same page, one of them the prey, in manhunt rather than classic;
  - the last player leaving, and the first player arriving into a finished round;
  - an admin mounted somewhere other than `/admin`, and a Strapi served under a sub-path;
  - a Media Library whose folder ids and `pathId`s have diverged, and a percent-encoded id;
  - an unauthenticated caller hitting every route the guard matches;
  - a config value at its ceiling, and one just past it;
  - a value that is a number on one side of the socket and a string on the other.
    Every claim anchored. Returns new candidates in the shard JSON; the parent appends them with the next `C<n>`.
- `defender` — briefed to prove the change correct: for every ledger candidate, the anchored code evidence that it does not hold, or `none found`. Returns `refutations[]` of `{ "id": "C<n>", "evidence": "<path:line>[, …]" }`. A refutation is an **attempt, never a removal** — it becomes prior art in that candidate's skeptic brief, and the parent strikes nothing on the defender's word.

Satellites: `pr-<n>-prosecutor-analysis.md`, `pr-<n>-defender-analysis.md`. A prosecutor candidate the defender never saw goes to its skeptic without prior art.

## Skeptics — how `confirmed` is earned

Every ledger candidate is judged by at least one skeptic **that did not find it**, briefed to refute it with code evidence. The brief carries the candidate's block, its finder's satellite path, the defender's refutation when one exists, `LENSES.md` with the candidate's zone, and read access to the tree. The finder's own re-check is not evidence here.

- A `merge-blocker` ranked `correctness` or `security` gets `SKEPTICS_PER_BLOCKER` = **2**, on distinct lenses: one on **reachability** — can this path execute, from which caller, in which phase, with which player state — and one on **consequence** — does the `expected`/`actual` pair actually differ where the finder says it does. Two identical skeptics are one skeptic run twice.
- Every other candidate gets one skeptic. When the shape is `wide` or `wide-deep`, non-blocker candidates are batched at most `SKEPTIC_BATCH_CEILING` = **4** per skeptic, grouped by owner zone; a blocker is never batched.

```json
{
  "shard": "skeptic-C<n>-<reachability|consequence>",
  "candidates": [
    { "id": "C<n>", "verdict": "stands | refuted | unresolved", "evidence": "<path:line>[, …]" }
  ],
  "analysisPath": "pr-<n>-skeptic-C<n>-<lens>-analysis.md"
}
```

A batched skeptic is `skeptic-<zone>-batch-<n>` with the matching satellite name. `confirmed` is exactly one thing: **every skeptic assigned to the candidate returned `stands`**. One `refuted` moves it to `## Refuted candidates` with the skeptic's evidence as the reason. One `unresolved` moves it there too, with `unresolved: <the skeptic's question>` as the reason and the same question under `## Open questions` — uncertain is refuted, never confirmed, because the overview asserts nothing it cannot anchor. Two skeptics disagreeing resolve to `refuted`.

## Budget

`SATELLITE_CEILING` = **14** satellites per run, counting every partition, seams, trace, surface, prosecutor, defender and skeptic satellite, and every re-split. Concurrency stays at `MAX_CONCURRENT_LENS_SHARDS`.

Spawn order is fixed so a ceiling hit lands on the least costly loss: partition and seams → surface → trace → prosecutor and defender → skeptics on blockers → remaining skeptics. When the next spawn would exceed the ceiling, the parent stops spawning. An unspawned partition shard's paths become unreached with reason `SATELLITE_CEILING`; an unverified candidate goes to `## Refuted candidates` with reason `not verified: SATELLITE_CEILING reached` and heads `## Leftovers`, because an unverified blocker is the first thing the next run must settle. The ceiling is restated in coverage, tunable at run start, never mid-run.

## Coverage at `siege`

Beyond what `review` writes: the shape with both booleans and their counts; every trace and surface satellite as a relative link, and every one that did not run with its mechanical reason; the candidate ledger as a table — `C<n>`, finder, skeptics, verdicts, resulting `F<n>` or refuted; satellites spent against `SATELLITE_CEILING`.

## Done when

Everything `PARTITION.md` requires, and: the shape is recorded with its counts; every conditional fan-out was spawned or named with the mechanical reason it was not; every observable symbol in a surface zone carries a verdict or is named unreached; every `C<n>` is `confirmed` by unanimous skeptics or appears under `## Refuted candidates` with its reason; no skeptic was the finder of the candidate it judged; and the satellite count is within `SATELLITE_CEILING`.
