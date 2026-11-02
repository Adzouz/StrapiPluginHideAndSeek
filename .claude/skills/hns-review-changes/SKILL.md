---
name: hns-review-changes
description: Reviews a pull request or branch of strapi-plugin-hide-and-seek through the plugin's own failure modes, with agents that have never seen the author's reasoning, then posts a GO / GO WITH NITS / NO GO review to GitHub with inline comments. Use when the user wants this plugin's PR, branch or working tree reviewed, wants a neutral second opinion on changes an agent just wrote, or wants a verdict posted on a PR.
---

# Hide and Seek — Review Changes

Reviews a candidate against the code it will ship beside, then posts the verdict. A generic checklist misses what actually breaks this plugin — a Koa middleware mounted ahead of authentication, two Media Library counters that look like one number, a game loop whose throw takes the host Strapi down, a second React root that outlives the page it drew on — so the review reads the diff through the plugin's own architecture.

## Why this skill exists

Because the author of the change is usually the agent being asked to review it, and an agent grading its own homework finds its own reasoning persuasive. **Neutrality is the deliverable.** If the briefs leak the author's conclusions, the run is worthless however many agents it spawns — it has bought agreement, not review.

## What it should cost

**A review is four to six agents.** That is the budget, not a target to grow into. A 46-file diff with 2700 added lines is a `review`, not a siege. If you find yourself planning more than six, the partition is wrong — merge shards, do not add them.

`siege` exists for the rare change that can break something expensive and quietly, and **it only runs when the user asks for it by name.** No file, zone or size triggers it. A siege costs three to five times a review and ends in the same verdict.

## Entry

| Given         | First step                                                              |
| ------------- | ----------------------------------------------------------------------- |
| a PR number   | `gh pr view <n> --json headRefOid,baseRefName,title,files`              |
| a branch name | `git rev-parse <branch>`, base is `main` unless the user says otherwise |
| nothing       | review the current branch against `main`                                |

`<base>...HEAD` three-dot is the diff under review, always. Two-dot drags in everything `main` gained since the branch left.

## Preflight

Read-only and mechanical. Before anything is spawned.

```bash
/usr/bin/git rev-parse --abbrev-ref HEAD
/usr/bin/git rev-parse HEAD
/usr/bin/git status --short
/usr/bin/git diff --name-only <base>...HEAD
gh pr view <n> --json headRefOid --jq .headRefOid   # when a PR number was given
```

Three hard stops, each reported rather than worked around:

- **A dirty tree.** Uncommitted work is not in the PR.
- **`HEAD` ≠ the PR's `headRefOid`.** Say which commits GitHub does not have and ask which to review. **Never silently review one and label it the other.**
- **No changed files.**

Then run the checks once and hand the result down as a fact: `npm run lint`, `npm run format:check`, `npm run test:unit`. The seven live-server suites need a running Strapi with real admin users; they are never run from here, and the verdict says so.

## Neutrality contract

Binds the parent. Every rule exists because breaking it is cheap and invisible.

1. **Fresh agents, never forks.** Spawn with `subagent_type: "general-purpose"`. A fork inherits this conversation, including every conclusion the author already reached.
2. **Briefs carry files and questions, never answers.** No finding list, no hypothesis, no "check whether X is still broken".
3. **The commit messages, CHANGELOG and README are claims under test, not evidence.** A claim the code does not implement is itself a finding.
4. **Prior review output stays out of every brief.**
5. **The parent reviews nothing.** It preflights, partitions, briefs, reconciles, assembles and posts.
6. **Read-only subagents.** No edits, no server, no port, no install, no test run, no git writes, no HTTP requests.

## Depth

Derived from the changed-file list, with no judgement.

| Depth    | When                                                                  | Shape                                                                |
| -------- | --------------------------------------------------------------------- | -------------------------------------------------------------------- |
| `scan`   | five or fewer product files, or only tests, docs, i18n and CI changed | one agent, no fan-out                                                |
| `review` | **the default, everything else**                                      | one agent per shard, at most six, per [`PARTITION.md`](PARTITION.md) |
| `siege`  | **only when the user asks for it by name**                            | `review` plus the adversarial machinery in [`SIEGE.md`](SIEGE.md)    |

A product file is one not under `tests/`, `docs/`, `.github/`, `.husky/`, and not `*.md` or a translation catalogue.

Never label a run deeper than the work it did. A `siege` that spawned no skeptic is a `review`.

## Lenses

Every reviewing agent reads [`LENSES.md`](LENSES.md) — the zone-lens table, the seams, the always-on checks and the risk signals that fix rank. The parent never applies a row itself. A path no zone claims is read directly and named in coverage.

Hand each agent the file by absolute path. It lives on whichever branch the skill is installed on, which is **not** necessarily the branch under review — check it is readable from the working tree before briefing, and extract it to a temporary path if it is not.

## Reading discipline

In every brief.

- **Read surrounding code, not only the diff.** In this repo the bug is usually in the caller.
- **Anchored or unconfirmed.** Every finding is anchored at `path:line` and re-checked against real callers before it is reported.
- **Claim-check the prose.** Every behaviour claim this diff adds to `README.md` or `CHANGELOG.md` is checked against the code that must implement it.
- **Both sides of a wire.** A value crossing the socket is defined in the engine, serialised in `publicState()`, read in the client and rendered in the overlay.
- **Self-reported is untrusted.** The browser tells the server its page, cursor and visibility.

### Tooling hazards

Say these in every brief; each has cost a run.

- The shell is behind a token-reducing proxy that **silently truncates output**. Multi-file `grep` collapses to the first matching file. Use `/usr/bin/git`, grep one file at a time, read with `cat`/`sed -n`.
- `node --test tests/unit/*.test.mjs` needs the shell to expand the glob.
- Invoke eslint as `node ./node_modules/eslint/bin/eslint.js .` if the wrapper reports something that does not reproduce.

## The review folder

```
.reviews/pr-<n>/<YYYY-MM-DD-HH:MM>/
```

Resolve it once, before anything is spawned. `.reviews/` is gitignored. Each shard writes one satellite into it; the parent writes the overview beside them.

## Rank, disposition, verdict

Rank is the heading: `correctness` → `security` → `breaking` → `structure` → `convention` → `test-docs`. **No High/Medium/Low — a severity word anywhere is a defect.**

Disposition is blocking force, and it decides the verdict:

| Disposition     | Means                                                         |
| --------------- | ------------------------------------------------------------- |
| `merge-blocker` | ships a broken install, a data loss, or a security regression |
| `should-fix`    | real defect, worth a follow-up commit, does not block         |
| `non-blocking`  | nit, polish, missing test, wording                            |

| Verdict          | Rule                                                    |
| ---------------- | ------------------------------------------------------- |
| **NO GO**        | one or more `merge-blocker`                             |
| **GO WITH NITS** | no blockers, one or more `should-fix` or `non-blocking` |
| **GO**           | nothing confirmed                                       |

A pre-existing defect the diff did not introduce is reported, never a blocker. A documentation defect blocks only when acting on the prose breaks something.

## The overview

Write `pr-<n>-<depth>-overview.md` into the review folder. Assembled by the parent from the returned records, never by pasting a shard's analysis in. No absolute paths.

Order: **verdict line**, provenance, coverage, `## Findings`, `## Refuted`, `## Open questions`.

```
verdict: NO GO | GO WITH NITS | GO
pr:      <number or branch>
head:    <sha reviewed>
base:    <baseRef>
checks:  lint <pass|fail> · format <pass|fail> · unit <n/n> · live suites not run
agents:  <n>
```

Findings use these keys exactly:

```
### F<n> — <rank> — <one-line claim>
disposition: merge-blocker | should-fix | non-blocking
anchor:      <path:line>[, ...]
trigger:     ...
path:        ...
expected:    ...
actual:      ...
fix:         ...
```

Full blocks for blockers and `should-fix`; a one-row table for the nits. **Target 80–200 lines.** Depth belongs in the satellites.

A finding that only reproduces in a browser says so — this repo has no browser harness, and pretending otherwise is how an untested fix ships looking verified.

## Posting

**The verdict goes on the PR.** A review that stops at a local file has not been delivered.

Draft the comment bodies in chat first and let the user react — wording and which findings survive are theirs to tune. Then post, in two steps.

**1. Inline comments**, one per actionable finding — blockers and `should-fix`. Nits go in the summary body as a list, not as twenty inline comments nobody will read. Build the payload as JSON with the Write tool (never a heredoc — it mangles markdown), and pass it with `--input`:

```jsonc
// <review folder>/pending-review.json
{
  "commit_id": "<headRefOid>",
  "comments": [
    {
      "path": "server/src/config/index.js",
      "line": 120,
      "side": "RIGHT",
      "body": "**Lead claim in one bold line.**\n\nThe concrete failure.\n\nThe ask.\n\n_Posted by AI (Claude), on behalf of @<user>._",
    },
  ],
}
```

```bash
gh api --method POST repos/<owner>/<repo>/pulls/<n>/reviews --input <path> --jq '{id, state}'
```

Omitting `event` leaves it `PENDING`. Anchors must be lines **in the diff**; use `side: RIGHT` with the new-file line, `LEFT` with the old. For a finding whose anchor is not in the diff, use `subject_type: "file"` or move it to the summary.

**2. The summary**, which submits the review:

```bash
gh api --method POST repos/<owner>/<repo>/pulls/<n>/reviews/<id>/events \
  -f event=COMMENT -f body="$(cat <path-to-body>)"
```

**Always `event=COMMENT`.** Never `APPROVE`, never `REQUEST_CHANGES` — the verdict is stated in the body, and the merge decision stays a human's. Say so when reporting.

Summary body shape:

```markdown
## NO GO

One sentence saying what works before what blocks.

**Blockers**

1. **<claim>** — `path:line`. <one line>.

**Should fix** — <n>, inline above.

**Nits** — <n>: <comma-separated one-liners with anchors>.

**Not verified:** lint/format/unit results, and what did not run.

_Posted by AI (Claude), on behalf of @<user>._
```

Comment style: simple English, lead with the claim in one bold line, then the failure, then the ask. State confidence honestly — a design question is not a defect. Tie every comment to a real line. Skip praise and anything a bot already said.

## After posting

Report the verdict and the review URL in chat, then **ask what to fix**, offering three options: blockers only, blockers and nits, or nothing for now.

On a yes, fix on the PR branch, run `npm run lint && npm run format:check && npm run test:unit && npm run build`, commit with the repo's conventional-commit style (scope from `server`, `admin`, `overlay`, `widget`, `i18n`, `game`, `tests`, `docs`, `deps`, `ci`), and push. Then reply in the threads that were fixed — one line each, naming the commit — rather than editing the original comments.

**Do not fix and post in the same breath without asking.** The user may disagree with a finding, and arguing with it after it is fixed is more expensive than before.

## Done when

The overview exists in `.reviews/pr-<n>/<iso>/` with a verdict line and every anchor a real `path:line`; the review is posted as a single `COMMENT` review carrying that verdict; the user has been told the URL and asked what to fix; and every agent spawned was a fresh `general-purpose` agent briefed without the author's conclusions.
