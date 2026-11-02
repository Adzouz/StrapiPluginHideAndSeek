---
name: hns-review-changes
description: Reviews a pull request or branch of strapi-plugin-hide-and-seek through the plugin's own failure modes, with subagents that have never seen the author's reasoning, and emits an anchored overview. Use when the user wants this plugin's PR, branch or working tree reviewed, wants a neutral second opinion on changes an agent just wrote, or wants findings ranked as merge-blockers.
---

# Hide and Seek — Review Changes

Reviews a candidate against the code it will ship beside. A generic checklist misses what actually breaks this plugin — a Koa middleware mounted ahead of authentication, two Media Library counters that look like one number, a game loop whose throw takes the host Strapi down, a second React root that outlives the page it drew on — so the review reads the diff through the plugin's own architecture.

It posts nothing to GitHub. It writes no code. Its output is an overview the author reads, plus the satellite analyses behind it.

Adapted from `strapi-review-changes` in cms-brain, minus the intake contract that skill depends on: this repo has no ingest step, so this skill does its own preflight and derives its own depth.

## Why this skill exists at all

Because the author of the change is usually the agent being asked to review it, and an agent grading its own homework finds its own reasoning persuasive. **Neutrality is the deliverable**, not the findings. If the briefs leak the author's conclusions, the run is worthless however many agents it spawns — it has bought agreement, not review.

## Entry

| Given         | First step                                                              |
| ------------- | ----------------------------------------------------------------------- |
| a PR number   | `gh pr view <n> --json headRefOid,baseRefName,title,body,files`         |
| a branch name | `git rev-parse <branch>`, base is `main` unless the user says otherwise |
| nothing       | review the current branch against `main`                                |

`<base>...HEAD` three-dot is the diff under review, always. Two-dot drags in everything `main` gained since the branch left.

## Preflight

Read-only, and mechanical. Run it before anything is spawned.

```bash
/usr/bin/git rev-parse --abbrev-ref HEAD
/usr/bin/git rev-parse HEAD
/usr/bin/git status --short
/usr/bin/git diff --name-only <base>...HEAD
gh pr view <n> --json headRefOid --jq .headRefOid   # when a PR number was given
```

Three hard stops, each reported rather than worked around:

- **A dirty tree.** Uncommitted work is not in the PR; reviewing it produces findings nobody can act on and misses code that is shipping. Stop and say so.
- **`HEAD` ≠ the PR's `headRefOid`.** Local commits that were never pushed are not in the PR. Say which commits GitHub does not have, and ask whether to review the local branch or the pushed head. **Never silently review one and label it the other.**
- **No changed files.** Nothing to review.

Record `head`, `base` and the changed-file list; they go in the overview's provenance block verbatim.

## Neutrality contract

Binds the parent. Every rule here exists because breaking it is cheap and invisible.

1. **Fresh agents, never forks.** Spawn with `subagent_type: "general-purpose"`. A fork inherits this conversation — including every conclusion the author already reached — which is the one thing a neutral review cannot contain.
2. **Briefs carry files and questions, never answers.** A brief may name paths, zones, lens rows, the diff range and the run's constants. It may not carry the author's finding list, a hypothesis, a "check whether X is still broken", or a summary of what the change is supposed to fix. Hand the agent the diff and the lens; let it find what it finds.
3. **The commit messages and the CHANGELOG are claims under test, not evidence.** They may be read — a claim that the code does not implement is itself a finding — but a shard that treats "the CHANGELOG says this is fixed" as proof has reviewed nothing.
4. **Prior review output is out of scope.** Any earlier overview in the review folder stays out of every brief. The parent may compare afterwards, in chat, once this run's findings exist.
5. **The parent reviews nothing.** It preflights, partitions, briefs, reconciles and assembles. A parent that "just checks one file itself" has reintroduced the anchoring the rest of this is built to avoid.
6. **Read-only.** No subagent edits a file, starts a Strapi, binds a port, installs anything, or runs a test suite. The parent may run `npm run lint`, `npm run format:check` and `npm run test:unit` before spawning, and hands the **result** down as a fact. The seven live-server suites need a running Strapi with real admin users and are therefore never run from here; the overview says so.

## The review folder

```
.reviews/pr-<n>/<YYYY-MM-DD-HH:MM>/
```

`<n>` is the PR number, or the branch name with `/` replaced by `-` when there is no PR. Local time, 24-hour. Resolve it **once, before anything is spawned** — shards write into it. A fresh folder per run; append `-2`, `-3` if the name is taken; never rename one.

`.reviews/` is gitignored: these are working notes, and this repo is a published package. Say in the closing summary where the folder is, so an unmentioned directory is not a surprise.

**Absolute paths belong in briefs, never in artifacts.** Each subagent gets the absolute review-folder path so it can write; every path inside a written file is relative to the repo root.

## Depth

Derived mechanically from the changed-file list, with no judgement, so the same diff always lands on the same depth. Each depth is the one above it plus one more kind of fan-out.

| Depth    | Shape                                                                                                                                  | Read before spawning                                        |
| -------- | -------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| `scan`   | one subagent, no fan-out — cheap triage                                                                                                | this file                                                   |
| `review` | zone lenses through a partition fan-out, one satellite per shard                                                                       | [`PARTITION.md`](PARTITION.md)                              |
| `siege`  | `review`, plus off-diff perspectives, full public-surface tracing, and an adversarial pass that alone may call a candidate `confirmed` | [`PARTITION.md`](PARTITION.md), then [`SIEGE.md`](SIEGE.md) |

**Floor:**

- `siege` when any changed path is owned by a consequence zone: `deletion-guard`, `realtime`, `plugin-surface`, `config`. These four decide whether a stranger can reach the plugin, whether the host process survives, and what a published version promises — each breaks expensively and quietly.
- `review` when any product file changed (anything not under `tests/`, `docs/`, `.github/`, and not `*.md` or a translation catalogue).
- `scan` otherwise.

A user may ask for a different depth. Honour it, and record the override in coverage. **Never label a run deeper than the work it did** — a `siege` that spawned no skeptic is a `review`, and its depth line says so.

## Lenses

Every reviewing subagent reads [`LENSES.md`](LENSES.md) — the zone-lens table, the seams, the always-on checks and the risk signals that fix rank. The parent never applies a row itself; the brief names the file and the zone ids the subagent owns. A path no zone claims is read directly and named in coverage, never silently waived.

## Reading discipline

Binds every subagent, at every depth.

- **Read surrounding code, not only the diff.** In this repo the bug is usually in the caller: the engine's state machine, the socket handler that calls it, and the overlay that renders it disagree about one value.
- **Anchored or unconfirmed.** Every candidate is anchored at `path:line` and re-checked against real callers before it is called `confirmed` — by the finder at `scan` and `review`, by an independent skeptic at `siege`, where the finder's own re-check earns nothing.
- **Claim-check the prose.** Every behaviour claim added to `README.md` or `CHANGELOG.md` by this diff is checked against the code that must implement it. A claim with no implementation ranks `test-docs`, or `correctness` when an operator would make a security decision on it.
- **Both sides of a wire.** A value that crosses the socket is defined in `server/src/services/game.js`, serialised in `publicState()`, read in `admin/src/net/client.js` and rendered in the overlay. A finding that looked at one end has not finished.
- **Self-reported is untrusted.** The browser tells the server its page, its cursor and its visibility. Any server behaviour keyed on those is reachable by a player with a console.

### Tooling hazards in this environment

Say these in every brief; they have each cost a run before.

- The shell is behind a token-reducing proxy that **silently truncates output**. Multi-file `grep` collapses to the first matching file, and `git diff` gets cut. Use `/usr/bin/git` explicitly, grep one file at a time, and read a file with `cat`/`sed -n` rather than trusting a summarised search.
- `node --test tests/unit/*.test.mjs` needs the shell to expand the glob; quoting it fails on Node 18.
- Invoke eslint as `node ./node_modules/eslint/bin/eslint.js .` if the wrapper reports something that does not reproduce.

## The scan pass

One subagent, no fan-out. The parent briefs, then edits the result into the overview. Hand it: the diff range, the changed-file list with each file's zones, `LENSES.md`, the absolute review folder, and the lint/test facts.

**Done when** every changed file is covered by a lens or waived with a concrete reason, and every surviving candidate carries an anchor plus a mechanism trace.

## The review pass

Same lenses, with fan-out. The parent partitions the changed files into zone shards, each shard reads its files through its zone's lens, writes a satellite, and returns control JSON. `PARTITION.md` holds the algorithm, the brief, the return contract and the overflow rule. The shard table is written down before anything is spawned.

**Done when** every shard in the table returned or was re-split, every returned finding carries an anchor, every satellite named in a return exists on disk, and every changed path is covered, waived, or named as unreached.

## The siege pass

`review`'s shard table, plus what a partitioned lens pass cannot produce: intent reconstructed off-diff, every changed public symbol traced to its consumers, and an adversarial pass — prosecutor, defender, then skeptics. `SIEGE.md` holds the shape rule, each fan-out's trigger and return, the verdict that earns `confirmed`, and the budget that stops a run. **A candidate no skeptic tried to refute is not a finding.**

**Done when** `review`'s condition holds, and: shape is recorded, every conditional fan-out ran or is named with the mechanical reason it did not, every candidate is `confirmed` by unanimous skeptics or listed under `## Refuted candidates`, and the satellite count is within `SATELLITE_CEILING`.

## The overview

Write `pr-<n>-<depth>-overview.md` into the review folder, beside the satellites it links. Assembled by the parent from the shard table, the returned records and its own listing of the folder — never by pasting a shard's analysis in. No absolute paths.

Order: **verdict**, provenance, coverage, `## Findings`, `## Refuted candidates`, `## Open questions`, `## Leftovers`.

The **verdict** is a bold one-liner stating what works before what blocks.

```
pr:      <number or branch>
head:    <sha reviewed>
base:    <baseRef>
pushed:  <yes | no — local commits not on the PR: sha, sha>
checks:  lint <pass|fail> · format <pass|fail> · unit <n pass/n fail> · live suites not run
```

**Coverage** carries: depth and any override, the shard table with each satellite as a relative link, the named constants in force, waived files with reasons, unreached files with reasons. At `scan` the shard table and constants are absent, which is what a scan looks like. At `siege` it also carries the shape and the candidate ledger.

Findings are ranked by heading in this order: `correctness` → `security` → `breaking` → `structure` → `convention` → `test-docs`. Fixed keys, exactly this schema:

```
### F<n> — <correctness|security|breaking|structure|convention|test-docs> — <one-line claim>
status:      confirmed
disposition: merge-blocker | should-fix | non-blocking
anchor:      <path:line>[, ...]
trigger:     ...
path:        ...
expected:    ...
actual:      ...
runtime:     not-exercised (read-only review)
fix:         ...
```

Rules:

- Only `status: confirmed` findings appear under `## Findings`. Anything unproven moves to `## Refuted candidates` with the same block and the reason it did not survive.
- **No `High`/`Medium`/`Low`.** Rank is the heading; blocking force is `disposition`. A severity word anywhere in the overview is a defect.
- `anchor` needs at least one real `path:line`. `path` is the mechanism trace, `path:line` per step; the satellite holds the long form.
- `runtime` is `not-exercised (read-only review)` unless a suite the parent ran actually exercises the finding, in which case name the suite and what it showed.
- A finding that only reproduces in a browser says so in `runtime` — this repo has no browser harness, and pretending otherwise is how an untested fix ships looking verified.

Target 120–300 lines at every depth. Depth belongs in satellites, never in a longer overview.

## Stop for a human

Emit the overview, summarise the verdict and the merge-blockers in chat, name the review folder, and **stop**. Nothing here touches GitHub. Posting is a separate, explicit step — `pr-pending-review` in cms-brain stages comments as a GitHub pending review without submitting them.

## Stub on abort

A refused or aborted run still writes the overview file, carrying its status, the stop that caused it, and the concrete next step. A run with no overview is a run nobody can find.

## Done when

The overview exists in `.reviews/pr-<n>/<iso>/`, with a bold verdict, a provenance block naming the sha it judged, every finding matching the schema keys exactly, every anchor a real `path:line`, no severity vocabulary, no absolute path, no GitHub write attempted — and every subagent it spawned was a fresh `general-purpose` agent briefed without the author's conclusions.
