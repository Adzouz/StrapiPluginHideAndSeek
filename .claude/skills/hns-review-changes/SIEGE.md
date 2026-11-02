# Siege

**Only when the user asks for it by name.** No file, zone, size or risk signal triggers a siege. It costs three to five times a review and ends in the same GO / GO WITH NITS / NO GO verdict, so it is worth it only when the user has a reason — a release, a security-sensitive change, a fix pass they do not trust.

`siege` is `review` plus three things a lens pass cannot produce: a trace of what the change exposes to the outside, an attempt to break it, and an independent attempt to refute every candidate before the overview may assert it.

The parent still reviews nothing. It extends the shard table, pools candidates, assigns skeptics, reconciles — from control JSON only.

## Budget

`SATELLITE_CEILING` = **14** for the whole run, the `review` shards included. Spawn order is fixed so a ceiling hit lands on the least costly loss:

1. the `review` partition (5–6)
2. seams (1)
3. surface (1, only if `plugin-surface`, `deletion-guard` or `config` has changed files)
4. prosecutor and defender (2)
5. skeptics on blockers (1–2)
6. skeptics on the rest, batched (1–3)

When the next spawn would exceed the ceiling, **stop spawning.** An unverified candidate goes to `## Refuted` with reason `not verified: ceiling reached` and is named in the overview. Tunable at run start, never mid-run.

If the arithmetic does not fit, the answer is fewer candidates, not more agents: raise the bar for what enters the ledger rather than raising the ceiling.

## Seams

One shard, no files of its own. It examines the crossings between the product zones the partition handed out, reading `LENSES.md`'s `## Seams`. Returns the same JSON as a partition shard with `"shard": "seams"`.

The crossings worth the budget, as questions: a value produced on one side of the socket and consumed on the other, including when it is absent or newly nullable; a rule enforced in two places; a state the server derives from something only the browser knows; which of a round, a socket, a ticket, a session and a timer can outlive which.

## Surface

One shard, when `plugin-surface`, `deletion-guard` or `config` has changed files. It enumerates what the outside can observe and returns one verdict per symbol — `compatible`, `breaking` or `undocumented-change`:

- the package exports, the published `files` list, peer ranges, every route with its declared auth and response shapes;
- every request shape the deletion guard matches, and every byte of every refusal: status, `error.name`, every key under `error.details`, and what an unauthenticated caller receives;
- every config key: accepted types, default and ceiling, before and after, judged from the position of someone upgrading without touching their config file;
- the socket protocol: every event name and payload shape, since a rolling deploy leaves old bundles running.

```json
{
  "shard": "surface",
  "symbols": [
    {
      "symbol": "…",
      "anchor": "<path:line>",
      "verdict": "compatible | breaking | undocumented-change"
    }
  ],
  "unreached": [{ "symbol": "…", "reason": "…" }],
  "findings": [],
  "analysisPath": "pr-<n>-surface-analysis.md"
}
```

Anything not `compatible` returns as a finding.

## Prosecute and defend

Two concurrent agents, each given the whole diff and the pooled candidate ledger.

**Prosecutor** — briefed to prove the change wrong or incomplete, with the states this tree keeps getting wrong named so the hunt starts somewhere concrete: a player who reloads or opens a second tab _during_ a phase; a tab backgrounded, blurred-but-visible, or waking from sleep believing it still holds the game; two players on one page in manhunt; the last player leaving and a fresh admin arriving; an admin under a sub-path; a Media Library whose folder ids and `pathId`s diverged; a percent-encoded or case-varied path; an unauthenticated caller on every matched route; a config value at its ceiling and past it; a number on one side of the socket and a string on the other. New candidates join the ledger.

**Defender** — briefed to prove it correct: for every candidate, the anchored evidence that it does not hold, or `none found`. A refutation is an **attempt, never a removal** — it becomes prior art in that candidate's skeptic brief, and the parent strikes nothing on the defender's word.

## Skeptics

Every candidate is judged by a skeptic **that did not find it**, briefed to refute it with code evidence. The brief carries the candidate, its finder's satellite, the defender's refutation when one exists, and the zone's lens rows. The finder's own re-check is not evidence.

- A `merge-blocker` gets two, on distinct lenses: **reachability** (can this path execute, from which caller, in which phase) and **consequence** (does the expected/actual pair actually differ where the finder says).
- Everything else gets one, batched up to **six** per skeptic, grouped by zone.

```json
{
  "shard": "skeptic-<id>",
  "candidates": [
    { "id": "C<n>", "verdict": "stands | refuted | unresolved", "evidence": "<path:line>[, …]" }
  ],
  "analysisPath": "…"
}
```

`confirmed` is exactly one thing: **every skeptic assigned returned `stands`.** One `refuted` moves it out. One `unresolved` moves it out too, with the question carried to `## Open questions` — uncertain is refuted, because the overview asserts nothing it cannot anchor.

A skeptic may narrow a finding, correct its anchor, or argue its disposition. Carry those corrections into the overview; they are the most valuable thing a siege produces, and they routinely reverse the parent's framing rather than the finder's facts.

## Coverage at `siege`

Beyond `review`: each extra satellite as a relative link; any that did not run with its mechanical reason; the candidate ledger as a table — id, finder, skeptics, verdicts, resulting `F<n>` or refuted; satellites spent against the ceiling.

## Done when

Everything `PARTITION.md` requires, and: every candidate is `confirmed` by unanimous skeptics or appears under `## Refuted` with its reason; no skeptic judged a candidate it found; the satellite count is within the ceiling; and the verdict is posted the same way a `review` posts it.
