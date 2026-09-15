import * as React from 'react';

import {
  Badge,
  Box,
  Button,
  Divider,
  Flex,
  Loader,
  SingleSelect,
  SingleSelectOption,
  Typography,
} from '@strapi/design-system';

import { send } from '../net/client';
import { ROLE, STATUS } from '../pluginId';
import { useGameStore } from '../store';

const HIDE_DURATIONS = [10, 15, 20, 30, 45];
const ROUND_DURATIONS = [180, 300, 600, 900];

const STATUS_LABEL = {
  [STATUS.COUNTDOWN]: 'Drawing the seeker…',
  [STATUS.HIDING]: 'Everyone is hiding',
  [STATUS.HUNTING]: 'Hunt in progress',
  [STATUS.OVER]: 'Round over',
};

const Dot = ({ color, dim }) => (
  <span
    style={{
      width: 10,
      height: 10,
      borderRadius: '50%',
      background: color,
      opacity: dim ? 0.3 : 1,
      flexShrink: 0,
    }}
  />
);

const PlayerRow = ({ player, isMe, inRound }) => (
  <Flex justifyContent="space-between" alignItems="center" paddingTop={1} paddingBottom={1}>
    <Flex gap={2} alignItems="center">
      <Dot color={player.color} dim={!player.connected} />
      <Typography variant="omega" textColor={player.connected ? 'neutral800' : 'neutral500'}>
        {player.name}
        {isMe ? ' (you)' : ''}
      </Typography>
    </Flex>

    {inRound ? (
      <Badge backgroundColor={player.caught ? 'danger100' : 'neutral150'}>
        {player.caught ? 'found' : (player.role ?? '…')}
      </Badge>
    ) : (
      <Badge backgroundColor={player.ready ? 'success100' : 'neutral150'}>
        {player.ready ? 'ready' : 'idle'}
      </Badge>
    )}
  </Flex>
);

const Lobby = ({ game, me }) => {
  const readyCount = game.players.filter((p) => p.ready && p.connected).length;
  const [error, setError] = React.useState(null);

  const start = () => {
    setError(null);
    send('start', {}, (result) => {
      if (result && !result.ok) {
        setError(result.error);
      }
    });
  };

  return (
    <>
      <Flex direction="column" alignItems="stretch" gap={2} paddingBottom={3}>
        <Flex justifyContent="space-between" alignItems="center" gap={2}>
          <Typography variant="pi" textColor="neutral600">
            When caught, players become
          </Typography>
          <SingleSelect
            size="S"
            aria-label="When caught, players become"
            value={game.settings.caughtBecome}
            onChange={(value) => send('settings', { caughtBecome: value })}
          >
            <SingleSelectOption value={ROLE.SEEKER}>seekers</SingleSelectOption>
            <SingleSelectOption value={ROLE.SPECTATOR}>spectators</SingleSelectOption>
          </SingleSelect>
        </Flex>

        <Flex justifyContent="space-between" alignItems="center" gap={2}>
          <Typography variant="pi" textColor="neutral600">
            Time to hide
          </Typography>
          <SingleSelect
            size="S"
            aria-label="Time to hide"
            value={game.settings.hideSeconds}
            onChange={(value) => send('settings', { hideSeconds: Number(value) })}
          >
            {HIDE_DURATIONS.map((seconds) => (
              <SingleSelectOption key={seconds} value={seconds}>
                {`${seconds}s`}
              </SingleSelectOption>
            ))}
          </SingleSelect>
        </Flex>

        <Flex justifyContent="space-between" alignItems="center" gap={2}>
          <Typography variant="pi" textColor="neutral600">
            Round limit
          </Typography>
          <SingleSelect
            size="S"
            aria-label="Round limit"
            value={game.settings.roundSeconds}
            onChange={(value) => send('settings', { roundSeconds: Number(value) })}
          >
            {ROUND_DURATIONS.map((seconds) => (
              <SingleSelectOption key={seconds} value={seconds}>
                {`${seconds / 60} min`}
              </SingleSelectOption>
            ))}
          </SingleSelect>
        </Flex>
      </Flex>

      <Divider />

      <Box paddingTop={2} paddingBottom={2}>
        {game.players.map((player) => (
          <PlayerRow key={player.id} player={player} isMe={player.id === me.id} inRound={false} />
        ))}
      </Box>

      <Flex gap={2}>
        <Button
          variant={me.ready ? 'tertiary' : 'secondary'}
          fullWidth
          onClick={() => send('ready', { ready: !me.ready })}
        >
          {me.ready ? "I'm not ready" : "I'm ready"}
        </Button>
        <Button fullWidth disabled={readyCount < 2} onClick={start}>
          {readyCount < 2 ? 'Need 2 players' : `Start (${readyCount})`}
        </Button>
      </Flex>

      {error ? (
        <Box paddingTop={2}>
          <Typography variant="pi" textColor="danger600">
            {error}
          </Typography>
        </Box>
      ) : null}
    </>
  );
};

const InRound = ({ game, me }) => {
  const hiders = game.players.filter((p) => p.role === ROLE.HIDER || p.caught);
  const found = hiders.filter((p) => p.caught).length;

  return (
    <>
      <Flex justifyContent="space-between" alignItems="center" paddingBottom={2}>
        <Typography variant="delta">{STATUS_LABEL[game.status]}</Typography>
        <Badge>{`${found}/${hiders.length} found`}</Badge>
      </Flex>

      <Divider />

      <Box paddingTop={2} paddingBottom={2}>
        {game.players.map((player) => (
          <PlayerRow key={player.id} player={player} isMe={player.id === me.id} inRound />
        ))}
      </Box>

      {game.status === STATUS.OVER ? (
        <Button fullWidth onClick={() => send('reset')}>
          Back to the lobby
        </Button>
      ) : (
        <Button variant="tertiary" fullWidth onClick={() => send('reset')}>
          Abort round
        </Button>
      )}
    </>
  );
};

export const LobbyWidget = () => {
  const { game, playerId, connected } = useGameStore();

  if (!connected || !game || !playerId) {
    return (
      <Flex direction="column" gap={2} alignItems="center" justifyContent="center" height="100%">
        <Loader small>Connecting</Loader>
        <Typography variant="pi" textColor="neutral600">
          Waiting for the game server…
        </Typography>
      </Flex>
    );
  }

  const me = game.players.find((player) => player.id === playerId);

  if (!me) {
    return null;
  }

  return (
    <Box>
      {game.status === STATUS.LOBBY ? (
        <Lobby game={game} me={me} />
      ) : (
        <InRound game={game} me={me} />
      )}
    </Box>
  );
};

export default LobbyWidget;
