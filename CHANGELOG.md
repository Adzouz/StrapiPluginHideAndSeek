# Changelog

All notable changes to this plugin are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.3.0] — 2026-10-30

### Four defaults changed

Upgrading from 0.2.0 changes how a round plays even if you touch no config. All
four are overridable in `config/plugins.ts`; the old values are in brackets.

- `lockdownMs` is now **15000** (was `4000`). A standoff lasts fifteen seconds,
  not four. This is the big one: with the old value a cornered hider could
  usually wait the seeker out.
- `hiderSpeedLimit` is now **0.3** (was `0.55`). A cornered hider's marker moves
  at roughly half the speed it used to.
- `catchRadius` is now **0.09** (was `0.06`). Catches land from half again as
  far away.
- `pageQueryKeys` now defaults to **`['folder', 'folderPath']`** (was unset).
  Every Media Library folder is its own room. Previously everybody in the Media
  Library shared one room regardless of the folder they had opened.

Together these make hiders markedly easier to catch. Set all four back to the
old values for 0.2.0's feel.

### Added

- **Manhunt mode.** One named player against the entire room; everybody else is
  a seeker. Pick the mode and the hunted player from the lobby widget. Two rules
  change to keep it playable: the prey is exempt from the lockdown
  (`preyEscapesLockdown`), and the homepage is not a safe zone.
- **Spectator follow.** A player who is out can tag along with somebody still
  in, and cycle through the roster from the overlay.
- **Hints.** A seeker who has drawn a blank for `hintAfterMs` is pointed at a
  page somebody is on — never at a person.
- **One tab per player.** Opening the admin in a second tab hands the game to
  the newest tab and tells the older one why. Clicking the older tab takes it
  back. This applies to any two admin tabs on the same account, in every phase.
- **Long rounds survive idle sessions.** While a round runs the plugin polls an
  authenticated endpoint once a minute so a hider who stops clicking is not
  logged out mid-round. Operators who depend on short idle sessions should know
  this is deliberate.
- **Deleting the room somebody is in is refused.** The existing 409 on deleting
  or deactivating a player now also covers deleting a content entry, a single
  type, or a Media Library folder a player is standing on. See
  [What a 409 means for your API](README.md#what-a-409-means-for-your-api).
- A unit suite (`npm run test:unit`) covering the game engine, the deletion
  guard's request matchers and the config validator without a running Strapi,
  alongside the existing live-server suites. It runs in CI and before publish.

### Fixed

- **A percent-encoded path no longer walks past the deletion guards.** Koa's
  router decodes a route parameter before the controller sees it; the guards
  read the raw path, so `DELETE /admin/users/%37` was user 7 to Strapi and an
  unknown id to the guard, which let it through mid-round.
- **The folder guard matches the right numbers.** A Media Library URL carries
  the folder's row id in `folder` and a chain of `pathId`s in `folderPath` —
  two independent counters that stop agreeing the first time any folder is
  deleted. The subtree is now resolved from the database instead of read off
  the URL, so deleting a parent folder is refused for real.
- **Catching a hider no longer freezes the seeker.** The lockdown survived the
  catch, leaving the winner of a standoff stuck in an empty room for the rest of
  `lockdownMs` while the player they had just caught walked free.
- **The lockdown now lifts when the round ends.** The deadline was only ever fed
  by a frame that stops being sent the moment the hunt is over, so every link in
  the admin stayed dead for the rest of the window, with nothing on screen to
  explain it.
- **Reloading while locked down no longer erases you.** A player who refreshed
  mid-standoff came back with no page at all: invisible, uncatchable, and
  credited with surviving the round. The page now outlives the socket for as
  long as the lockdown holds them to it, so a reload is neither an erasure nor
  an escape, and does not earn a second lockdown either.
- **A lockdown lifts for whoever is left standing.** It already lifted for a
  seeker whose room emptied; a hider frozen by a seeker who closed their tab
  stayed frozen for the full fifteen seconds.
- **A `preyId` set in `config/plugins.ts` works.** Admin user ids are numbers
  there and strings in the game, and `'3' === 3` is false — which, with the new
  start check, made manhunt permanently unstartable rather than quietly random.
- **Every phase of a round has a ceiling**, not just the three the lobby can
  change. `countdownSeconds` had none, so it could hold the guards open just as
  effectively as `roundSeconds`.
- **The admin root is read from `admin.absoluteUrl`.** `admin.path` has the part
  it shares with `server.url` stripped out, so on a Strapi served under a
  sub-path it reports `/admin` while browsers are on `/cms/admin` — and the
  entry guard matched nothing at all.
- **A tab that lost the game stops acting like it still has it.** A superseded
  tab kept a frozen overlay, kept every link dimmed, and went on refreshing the
  admin session once a minute for as long as it stayed open.
- **A backgrounded tab can reconnect.** A hider who tabbed away to hide and then
  lost the socket could never reconnect, and was forfeited where they stood. The
  licence to reconnect unseen expires after a minute, so a tab that slept
  through a handover cannot wake up and take the game off the tab in use.
- **A reconnect re-announces whether the tab is in the background**, so a hider
  who tabbed away after losing the socket comes back parked and findable rather
  than frozen at a stale cursor.
- **Naming an un-ready player as the prey is now an error** rather than a silent
  substitution that dealt the named player spectator.
- **A prey who quits is reported as quitting**, not as having "got away after
  0:00".
- **Spectator follow cannot be steered off-origin.** A page id is now resolved
  rather than prefix-matched, on the server as well as in the browser:
  `/\evil.example` looks like a local path to `startsWith('/')` and is not one.
- **The deletion guard says less.** It runs ahead of Strapi's authentication, so
  it no longer returns player names, and a request with no bearer token is
  passed through to the 401 it was going to get. **Response-shape change for
  anyone parsing it:** `error.details.players` is gone and the message no
  longer names anyone. `error.details.action` is unchanged. What a caller with
  a token-shaped header can still infer is written down in the README.
- **A throw in the game loop cannot throw again while being logged**, and is
  rate-limited rather than written twenty times a second for ever. A state
  frame is marked sent only once it has been sent.
- **A player with no page is no longer scored as having sat in the safe zone**
  on projects whose admin is mounted at `/`.
- **`roundSeconds` is capped on the config path too**, not only from the lobby.
  An unbounded round kept admin sessions open and the deletion guards armed for
  as long as it lasted.
- The content-entry guard now works on projects that mount the admin somewhere
  other than `/admin`.
- A throw inside the game loop is logged instead of taking the host Strapi
  process down with it.
- `safePath` is no longer advertised in manhunt, where the homepage is an
  ordinary hiding spot — the hint highlighter was refusing to point at it.
- The clock offset refreshes during a quiet hunt instead of going stale.
- A finished round no longer outlives everyone who played it, so the next admin
  to open the panel gets a lobby rather than a stranger's results card.

### Changed

- `mode` and `preyId` joined the settings the lobby can change between rounds.
- `mode`, `preyEscapesLockdown` and `corsOrigin` are now validated at boot.
  `preyEscapesLockdown: 'false'` used to turn the exemption on.
- `@strapi/sdk-plugin` is no longer a peer dependency, so installing this
  package no longer pulls Vite and Rollup into your project.

## [0.2.0] — 2026-09-18

Published by hand. See the
[releases](https://github.com/Adzouz/StrapiPluginHideAndSeek/releases) page.

## [0.1.0] — 2026-09-16

First release.
