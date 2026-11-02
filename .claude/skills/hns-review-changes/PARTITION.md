# Partition

How the parent of `hns-review-changes` turns a changed-file list into zone shards at `review` and `siege`. Read in full before writing the shard table; the table is written before anything is spawned. At `siege`, `SIEGE.md` extends this table — it never replaces it.

## The zone map

There is no intake step here, so the parent assigns zones itself — but **mechanically, from the path alone**, first match wins, top to bottom. No judgement, so the same diff always partitions the same way.

| Pattern                                                                                                                                                                   | Zone             |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| `server/src/middlewares/**`                                                                                                                                               | `deletion-guard` |
| `server/src/realtime/**`, `server/src/services/tickets.js`                                                                                                                | `realtime`       |
| `server/src/config/**`                                                                                                                                                    | `config`         |
| `server/src/index.js`, `server/src/controllers/**`, `server/src/routes/**`, `server/src/services/index.js`, `admin/src/index.js`, `admin/src/pluginId.js`, `package.json` | `plugin-surface` |
| `server/src/services/**`, `server/src/constants.js`                                                                                                                       | `game-engine`    |
| `admin/src/net/**`, `admin/src/store.js`                                                                                                                                  | `admin-client`   |
| `admin/src/overlay/**`, `admin/src/components/**`                                                                                                                         | `admin-ui`       |
| `admin/src/i18n.js`, `admin/src/translations/**`                                                                                                                          | `i18n`           |
| `tests/**`                                                                                                                                                                | `tests`          |
| `README.md`, `CHANGELOG.md`, `docs/**`, any other `*.md`                                                                                                                  | `docs`           |
| `.github/**`, `.husky/**`, `eslint.config.js`, `commitlint.config.js`, `.prettierrc`, `.editorconfig`, `*.yml`                                                            | `ci-release`     |
| anything else                                                                                                                                                             | `unmapped`       |

**Secondary lenses** ride along and are named in the owner shard's brief, never given to a second shard:

- a `game-engine` file also carries `realtime` when the diff touches `tick`, a timer or an emitted payload;
- an `admin-client` file also carries `game-engine` (the state shape is a contract across that wire);
- a `deletion-guard` file also carries `game-engine` (it reads the roster) and `plugin-surface` (it answers HTTP);
- every `admin-ui` file also carries `i18n`;
- `package.json` carries `ci-release` as well as `plugin-surface`.

An `unmapped` path means the repo grew a shape this map has not seen. Say so in coverage — it is a map bug as much as a review finding.

## Partition

1. **Exactly one owner per file** — its first match in the table. No file is reviewed twice, and no lens is lost, because secondary lenses go in the owner's brief.
2. **Split each zone group into ordered batches of at most `ZONE_FILE_CEILING` files**, in changed-file order. `ZONE_FILE_CEILING` is **5**. This repo's largest file is ~1300 lines and its diffs concentrate there, so five files is one analysis' worth of attention. It is a named constant, restated in the overview's coverage, tunable at the start of a run and never renegotiated mid-run.
3. **A file over 600 lines is a batch of its own** when it is the zone's only changed file with a substantial hunk — `server/src/services/game.js` and `admin/src/net/client.js` both qualify.
4. **Every `unmapped` path gets its own shard**, read directly. Never silently waived.
5. **One cross-cutting shard, at most, and only when two or more zone shards hold product code** — `tests`, `docs`, `i18n`, `ci-release` and `unmapped` shards do not count toward that two. It reviews no file of its own: it examines the seams _between_ those zones, reading `LENSES.md`'s `## Seams`. One product zone, or only tests and docs, spawns none.
6. **Shards run concurrently, default `MAX_CONCURRENT_LENS_SHARDS` = 4.** They are read-only — nothing installed, built, bound or executed.

Write the shard table down — shard id, zone, files, secondary lenses, batch order — **before spawning anything**. It is the parent's ledger of what must come back, and the only thing that makes a dropped file visible.

## What a shard gets, and what it returns

Its brief carries: the diff range (`<base>...HEAD`), its own file list with each file's owner zone and secondary lenses, `LENSES.md` with the zone ids it owns and rides along on, the absolute review-folder path plus its own satellite filename in it, the lint/format/unit facts the parent gathered, the tooling hazards from `SKILL.md`, and read access to the tree.

**Pointers, not payloads.** The parent hands paths down; the shard hands paths back. And nothing from the author: no finding list, no hypothesis, no description of what the change is meant to fix. See the neutrality contract in `SKILL.md`.

```json
{
  "shard": "<zone>#<n>",
  "zone": "<zone-id>",
  "covered": ["<relative path>"],
  "analysisPath": "pr-<n>-<zone>-analysis.md",
  "findings": [
    {
      "rank": "correctness | security | breaking | structure | convention | test-docs",
      "status": "confirmed | refuted",
      "disposition": "merge-blocker | should-fix | non-blocking",
      "anchor": "<path:line>[, …]",
      "trigger": "…",
      "path": "<path:line> → <path:line>",
      "expected": "…",
      "actual": "…",
      "fix": "…"
    }
  ],
  "overflow": { "unreached": ["<relative path>"], "reason": "…" }
}
```

**A shard that returns prose is a defect** — no transcript, no file dump, no reasoning log, no summary. Findings are the deliverable, every field capped at a sentence or two, `path` carrying anchors with arrows rather than narrative. The long-form mechanism trace, the ruled-out candidates and the callers actually read live in the satellite. `overflow` is `null` when it does not apply.

The keys are the overview's schema keys minus `runtime`, which the parent stamps, and minus the `F<n>` id, which the parent assigns across all shards in rank order — a shard that numbers its own findings collides with every other shard. At `siege`, a shard's `status` is the finder's own re-check and is provisional: `SIEGE.md`'s skeptics decide what the overview asserts.

## Satellites

Each shard writes `pr-<n>-<zone>-analysis.md` into the review folder before returning — `pr-<n>-<zone>-<k>-analysis.md` when its zone split into more than one batch, and `pr-<n>-seams-analysis.md` for the cross-cutting shard. Every satellite name is a bare filename relative to the review folder. A returned finding with no satellite behind it has nowhere to put its evidence, so the analysis is written first and named in the return.

**Overflow rather than limp.** A shard whose batch turns out heavier than it looked returns `overflow` naming the paths it did not reach, and stops. The parent re-splits those paths into a fresh shard on the same zone rather than letting a saturated agent finish badly. The parent then reconciles every return against the shard table: a path in neither `covered` nor `overflow` has been dropped, and any path still unreached after the last shard is named in the overview's coverage with its reason. **Never absent.**

**Done when** every shard in the table returned or was re-split, every returned finding carries an anchor, every satellite named in a return exists on disk, and every changed path is covered, waived with a concrete reason, or named as unreached.
