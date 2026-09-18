import * as React from 'react';

import { t } from '../i18n';
import { cycleFollow, dismissResults, serverNow } from '../net/client';
import { ROLE, STATUS } from '../pluginId';
import { getState, setState, toggleMuted, useGameStore } from '../store';
import { createGhostLayer } from './ghosts';
import { guardExternalLinks, releaseExternalLinks } from './external';
import { applyHint, clearHint } from './hints';

const REVEAL_MS = 2500;
const CAUGHT_NOTICE_MS = 5000;

const useNow = (intervalMs = 200) => {
  const [, force] = React.useReducer((n) => n + 1, 0);

  React.useEffect(() => {
    const id = window.setInterval(force, intervalMs);

    return () => window.clearInterval(id);
  }, [intervalMs]);

  return serverNow();
};

const secondsLeft = (deadline, now) => Math.max(0, Math.ceil((deadline - now) / 1000));

const formatClock = (seconds) =>
  `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;

const roleIcon = {
  [ROLE.SEEKER]: '🔦',
  [ROLE.HIDER]: '🥷',
  [ROLE.SPECTATOR]: '👻',
};

const youAreLabel = (role) => {
  if (role === ROLE.SEEKER) {
    return t('overlay.youAreSeeker');
  }

  if (role === ROLE.HIDER) {
    return t('overlay.youAreHider');
  }

  return t('overlay.youAreSpectator');
};

const GhostLayer = () => {
  const ref = React.useRef(null);

  React.useEffect(() => createGhostLayer(ref.current), []);

  return <div className="hns-ghosts" ref={ref} />;
};

/** Always on, on every page: you should never have to remember what you are. */
const StatusPill = ({ role, safe }) => (
  <>
    <div className={`hns-pill hns-pill--${role ?? ROLE.SPECTATOR}`}>
      {`${roleIcon[role] ?? roleIcon[ROLE.SPECTATOR]} ${youAreLabel(role)}`}
    </div>
    {safe ? <div className="hns-pill hns-pill--safe">{`🛟 ${t('overlay.safeZone')}`}</div> : null}
  </>
);

const HintPill = ({ path, matched }) => (
  <div className="hns-pill hns-pill--hint">
    {matched ? `✨ ${t('overlay.hintHere')}` : `✨ ${t('overlay.hintPath', { path })}`}
  </div>
);

const Hud = ({ game, now }) => {
  const { muted } = getState();
  const hiders = game.players.filter((p) => p.role === ROLE.HIDER || p.caught);
  const found = hiders.filter((p) => p.caught).length;

  return (
    <div className="hns-hud">
      <span>{t('lobby.foundCount', { found, total: hiders.length })}</span>
      {game.roundEndsAt ? (
        <>
          <span className="hns-hud__sep" />
          <span>{formatClock(secondsLeft(game.roundEndsAt, now))}</span>
        </>
      ) : null}
      <span className="hns-hud__sep" />
      <button
        type="button"
        className="hns-hud__mute"
        onClick={toggleMuted}
        aria-label={t(muted ? 'overlay.unmute' : 'overlay.mute')}
      >
        {muted ? '🔇' : '🔊'}
      </button>
    </div>
  );
};

const Lockdown = ({ lockedUntil, lockdownMs, now }) => {
  const remaining = Math.max(0, lockedUntil - now);

  return (
    <div className="hns-pill hns-lock">
      <span>{`🔒 ${t('overlay.lockedIn')}`}</span>
      <span className="hns-lock__bar">
        <span style={{ width: `${(remaining / lockdownMs) * 100}%` }} />
      </span>
      <span>{(remaining / 1000).toFixed(1)}s</span>
    </div>
  );
};

/** Spectators tag along with somebody rather than wandering a dead admin. */
const FollowPill = ({ roster, followId }) => {
  const target = roster.find((entry) => entry.id === followId);

  return (
    <div className="hns-follow">
      <button
        type="button"
        className="hns-follow__btn"
        onClick={() => cycleFollow(-1)}
        disabled={roster.length < 2}
        aria-label={t('overlay.followPrev')}
      >
        ‹
      </button>
      <span className="hns-follow__label">
        {target ? (
          <>
            {`${roleIcon[target.role] ?? roleIcon[ROLE.SPECTATOR]} ${t('overlay.follow')} ${target.name}`}
            <span className="hns-follow__sub">{target.page ?? '—'}</span>
          </>
        ) : (
          t('overlay.followNobody')
        )}
      </span>
      <button
        type="button"
        className="hns-follow__btn"
        onClick={() => cycleFollow(1)}
        disabled={roster.length < 2}
        aria-label={t('overlay.followNext')}
      >
        ›
      </button>
    </div>
  );
};

const CaughtScreen = ({ notice }) => (
  <div className="hns-fullscreen">
    <div className="hns-huge">{notice.becomes === ROLE.SEEKER ? '🔦' : '👻'}</div>
    <div className="hns-title">{t('overlay.caughtTitle')}</div>
    <div className="hns-sub">
      {`${t('overlay.caughtBy', { name: notice.seekerName })} ${t('overlay.lastedFor', {
        time: formatClock(Math.round(notice.survivedMs / 1000)),
      })}`}
    </div>
    <div className="hns-title" style={{ fontSize: 22 }}>
      {notice.becomes === ROLE.SEEKER ? t('overlay.nowSeeker') : t('overlay.nowSpectator')}
    </div>
  </div>
);

const Countdown = ({ game, now }) => (
  <div className="hns-fullscreen">
    <div className="hns-huge">{secondsLeft(game.phaseEndsAt, now) || t('overlay.go')}</div>
    <div className="hns-sub">{t('status.countdown')}</div>
  </div>
);

const Reveal = ({ me }) => {
  if (me.role === ROLE.SEEKER) {
    return (
      <div className="hns-fullscreen">
        <div className="hns-title">{`🔦 ${t('overlay.youAreSeeker')}`}</div>
        <div className="hns-sub">{t('overlay.seekerIntro')}</div>
      </div>
    );
  }

  return (
    <div className="hns-fullscreen hns-fullscreen--soft">
      <div className="hns-title">{`🥷 ${t('overlay.runAndHide')}`}</div>
      <div className="hns-sub">{t('overlay.hiderIntro')}</div>
    </div>
  );
};

const Blindfold = ({ game, now }) => (
  <div className="hns-fullscreen">
    <div className="hns-huge">🙈</div>
    <div className="hns-title">{t('overlay.noPeeking')}</div>
    <div className="hns-sub">
      {t('overlay.huntOpens', { seconds: secondsLeft(game.phaseEndsAt, now) })}
    </div>
  </div>
);

const HidingBanner = ({ game, now }) => (
  <div className="hns-hud">
    <span>{`🥷 ${t('overlay.hideNow')}`}</span>
    <span className="hns-hud__sep" />
    <span>{secondsLeft(game.phaseEndsAt, now)}s</span>
  </div>
);

const Results = ({ game, me }) => {
  const { result } = game;
  const won =
    (result.winner === 'seekers' && me.role === ROLE.SEEKER && !me.caught) ||
    (result.winner === 'hiders' && result.survivors.some((s) => s.id === me.id));

  return (
    <div className="hns-fullscreen hns-fullscreen--soft">
      <div className="hns-card">
        <div className="hns-title" style={{ marginBottom: 4 }}>
          {result.winner === 'seekers'
            ? `🔦 ${t('overlay.seekersWin')}`
            : `🥷 ${t('overlay.hidersWin')}`}
        </div>
        <div className="hns-sub" style={{ marginBottom: 16 }}>
          {`${t(won ? 'overlay.youMadeIt' : 'overlay.betterLuck')} ${t('overlay.roundLasted', {
            time: formatClock(Math.round(result.durationMs / 1000)),
          })}`}
        </div>

        {result.scores
          .slice()
          .sort((a, b) => b.foundCount - a.foundCount)
          .map((score) => (
            <div className="hns-score" key={score.id}>
              <span>
                <span className="hns-dot" style={{ background: score.color }} />
                {score.name}
              </span>
              <span>{t('overlay.foundTotal', { count: score.foundCount })}</span>
            </div>
          ))}

        <button type="button" className="hns-btn" onClick={dismissResults}>
          {t('lobby.backToLobby')}
        </button>
      </div>
    </div>
  );
};

export const Overlay = () => {
  const {
    game,
    playerId,
    danger,
    toast,
    lockedUntil,
    you,
    followId,
    caughtNotice,
    hintMatched,
    resultsDismissed,
  } = useGameStore();
  const now = useNow(lockedUntil > serverNow() ? 60 : 200);

  const status = game?.status;
  const hintPath = you?.hint?.path ?? null;
  const safePath = game?.safePath ?? null;

  // Pulling the lobby widget off the homepage mid-round would strand everyone.
  React.useEffect(() => {
    const playing = [STATUS.COUNTDOWN, STATUS.HIDING, STATUS.HUNTING].includes(status);

    document.body.classList.toggle('hns-in-game', playing);

    // The admin grows outbound links as you navigate, so re-sweep rather than
    // tagging once.
    guardExternalLinks(playing);

    const id = playing ? window.setInterval(() => guardExternalLinks(true), 2000) : null;

    return () => {
      if (id) {
        window.clearInterval(id);
      }

      document.body.classList.remove('hns-in-game');
      releaseExternalLinks();
    };
  }, [status]);

  // The admin re-renders constantly, so the highlight has to be re-applied.
  React.useEffect(() => {
    if (!hintPath) {
      clearHint();

      if (getState().hintMatched) {
        setState({ hintMatched: false });
      }

      return undefined;
    }

    const run = () => {
      const matched = applyHint(hintPath, safePath) > 0;

      if (matched !== getState().hintMatched) {
        setState({ hintMatched: matched });
      }
    };

    run();

    const id = window.setInterval(run, 1500);

    return () => {
      window.clearInterval(id);
      clearHint();
    };
  }, [hintPath, safePath]);

  if (!game || !playerId) {
    return null;
  }

  const me = game.players.find((player) => player.id === playerId);

  if (!me) {
    return null;
  }

  const hidingStartedAt = game.phaseEndsAt
    ? game.phaseEndsAt - game.settings.hideSeconds * 1000
    : 0;
  const revealing = game.status === STATUS.HIDING && now - hidingStartedAt < REVEAL_MS;
  const blindfolded = game.status === STATUS.HIDING && me.role === ROLE.SEEKER && !revealing;
  const showCaught = caughtNotice && now - caughtNotice.at < CAUGHT_NOTICE_MS;
  const inRound = [STATUS.HIDING, STATUS.HUNTING].includes(game.status);
  const showPills = inRound && !revealing && !blindfolded && !showCaught;
  const roster = you?.follow ?? [];

  return (
    <>
      {game.status === STATUS.COUNTDOWN ? <Countdown game={game} now={now} /> : null}
      {revealing ? <Reveal me={me} /> : null}
      {blindfolded ? <Blindfold game={game} now={now} /> : null}

      {game.status === STATUS.HIDING && me.role !== ROLE.SEEKER && !revealing ? (
        <HidingBanner game={game} now={now} />
      ) : null}

      {game.status === STATUS.HUNTING ? (
        <>
          <GhostLayer />
          {danger ? <div className="hns-danger" /> : null}
          <Hud game={game} now={now} />
        </>
      ) : null}

      {showPills ? (
        <div className="hns-topcentre">
          <StatusPill role={me.role} safe={you?.safe} />
          {lockedUntil > now ? (
            <Lockdown lockedUntil={lockedUntil} lockdownMs={game.lockdownMs ?? 4000} now={now} />
          ) : null}
          {hintPath ? <HintPill path={hintPath} matched={hintMatched} /> : null}
        </div>
      ) : null}

      {game.status === STATUS.HUNTING && me.role === ROLE.SPECTATOR && roster.length > 0 ? (
        <FollowPill roster={roster} followId={followId} />
      ) : null}

      {showCaught ? <CaughtScreen notice={caughtNotice} /> : null}

      {game.status === STATUS.OVER && game.result && !resultsDismissed ? (
        <Results game={game} me={me} />
      ) : null}

      {toast ? <div className={`hns-toast hns-toast--${toast.kind}`}>{toast.text}</div> : null}
    </>
  );
};
