import * as React from 'react';

import { t } from '../i18n';
import { serverNow, send } from '../net/client';
import { ROLE, STATUS } from '../pluginId';
import { getState, toggleMuted, useGameStore } from '../store';
import { createGhostLayer } from './ghosts';

const REVEAL_MS = 2500;

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

const roleLabel = (role) => {
  if (role === ROLE.SEEKER) {
    return `🔦 ${t('overlay.roleSeeker')}`;
  }

  if (role === ROLE.HIDER) {
    return `👻 ${t('overlay.roleHider')}`;
  }

  return `👁 ${t('overlay.roleSpectator')}`;
};

const GhostLayer = () => {
  const ref = React.useRef(null);

  React.useEffect(() => createGhostLayer(ref.current), []);

  return <div className="hns-ghosts" ref={ref} />;
};

const Hud = ({ me, game, now }) => {
  const { muted } = getState();
  const hiders = game.players.filter((p) => p.role === ROLE.HIDER || p.caught);
  const found = hiders.filter((p) => p.caught).length;

  return (
    <div className="hns-hud">
      <span>{roleLabel(me.role)}</span>
      <span className="hns-hud__sep" />
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
    <div className="hns-lock">
      <span>{`🔒 ${t('overlay.lockedIn')}`}</span>
      <span className="hns-lock__bar">
        <span style={{ width: `${(remaining / lockdownMs) * 100}%` }} />
      </span>
      <span>{(remaining / 1000).toFixed(1)}s</span>
    </div>
  );
};

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
      <div className="hns-title">{`👻 ${t('overlay.runAndHide')}`}</div>
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
    <span>{`👻 ${t('overlay.hideNow')}`}</span>
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
            : `👻 ${t('overlay.hidersWin')}`}
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

        <button type="button" className="hns-btn" onClick={() => send('reset')}>
          {t('lobby.backToLobby')}
        </button>
      </div>
    </div>
  );
};

export const Overlay = () => {
  const { game, playerId, danger, toast, lockedUntil } = useGameStore();
  // The lockdown bar drains, so it wants a finer clock than the rest.
  const now = useNow(lockedUntil > serverNow() ? 60 : 200);

  if (!game || !playerId) {
    return null;
  }

  const me = game.players.find((player) => player.id === playerId);

  if (!me) {
    return null;
  }

  const hidingStartedAt = game.phaseEndsAt ? game.phaseEndsAt - game.settings.hideSeconds * 1000 : 0;
  const revealing = game.status === STATUS.HIDING && now - hidingStartedAt < REVEAL_MS;
  const blindfolded = game.status === STATUS.HIDING && me.role === ROLE.SEEKER && !revealing;

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
          {lockedUntil > now ? (
            <Lockdown
              lockedUntil={lockedUntil}
              lockdownMs={game.lockdownMs ?? 4000}
              now={now}
            />
          ) : null}
          <Hud me={me} game={game} now={now} />
        </>
      ) : null}

      {game.status === STATUS.OVER && game.result ? <Results game={game} me={me} /> : null}

      {toast ? <div className={`hns-toast hns-toast--${toast.kind}`}>{toast.text}</div> : null}
    </>
  );
};
