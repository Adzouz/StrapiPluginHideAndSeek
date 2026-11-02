# Partition

How the parent of `hns-review-changes` turns a changed-file list into shards at `review`. Read before writing the shard table; the table is written before anything is spawned.

**The whole point of this file is to produce FEW shards.** Six agents review a 46-file diff perfectly well. The failure mode is a shard per zone per batch, which buys overlapping findings, three agents reporting the same defect, and a bill the user did not ask for.

## The zone map

Mechanical, from the path alone, first match wins.

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

## Partition

1. **Group changed files by zone.**
2. **Collapse the low-risk zones into ONE shard**, always: `tests`, `docs`, `i18n`, `ci-release`, `unmapped`. Call it `repo-meta`. Its job is the claim check — every behaviour claim the diff adds to the README or CHANGELOG, checked against the code — plus key parity, CI wiring, and whether the new tests can fail for the reason they claim.
3. **One shard per remaining product zone**, up to `MAX_PRODUCT_SHARDS` = **4**. If more than four zones have changed files, merge the smallest by diff size until four remain, and say in the brief that the shard owns two zones.
4. **No per-batch splitting.** A zone's files go to one shard however many there are. `server/src/services/game.js` at 1300 lines is one shard's work; it does not need two.
5. **No seams shard at `review`.** Seam questions go in the briefs of both shards that touch the seam, with `LENSES.md`'s `## Seams` named. A dedicated cross-cutting shard is a `siege` fan-out.
6. **Shards run concurrently**, default `MAX_CONCURRENT` = 4 — which, at four product shards plus `repo-meta`, is the whole run in two waves.

**Total at `review`: five shards, six at the outside.** Write the table down before spawning: shard id, zones, files. It is the ledger of what must come back and the only thing that makes a dropped file visible.

## What a shard gets, and what it returns

Its brief carries: the diff range, its file list with owner zone, `LENSES.md` by absolute path with the zone ids it owns, the review-folder path plus its own satellite filename, the lint/format/unit facts, the tooling hazards, and read access to the tree.

**Pointers, not payloads.** And nothing from the author: no finding list, no hypothesis, no description of what the change is meant to fix.

```json
{
  "shard": "<zone>",
  "covered": ["<relative path>"],
  "analysisPath": "pr-<n>-<zone>-analysis.md",
  "findings": [
    {
      "rank": "correctness | security | breaking | structure | convention | test-docs",
      "disposition": "merge-blocker | should-fix | non-blocking",
      "anchor": "<path:line>[, …]",
      "trigger": "…",
      "path": "<path:line> → <path:line>",
      "expected": "…",
      "actual": "…",
      "fix": "…"
    }
  ],
  "overflow": null
}
```

**A shard that returns prose is a defect** — no transcript, no file dump, no reasoning log. Every field is capped at a sentence or two. The long form lives in the satellite.

The parent assigns `F<n>` across all shards in rank order; a shard that numbers its own findings collides with every other.

**Disposition discipline, in every brief:** `merge-blocker` is for a change that ships a broken install, loses data, or regresses security — not for a defect the reviewer finds interesting. A pre-existing defect the diff did not introduce is reported and is never a blocker. If a shard returns more than two blockers, the parent re-reads them against that bar before carrying them into the verdict.

## Overflow

A shard whose batch turns out heavier than it looked returns `overflow` naming what it did not reach, and stops. The parent re-splits those paths into one fresh shard rather than letting a saturated agent finish badly — and counts it against the six.

The parent reconciles every return against the table: a path in neither `covered` nor `overflow` has been dropped, and any path still unreached is named in the overview's coverage with its reason. **Never absent.**

## Done when

Every shard returned or was re-split, every finding carries an anchor, every satellite named in a return exists on disk, and every changed path is covered, waived with a concrete reason, or named as unreached.
