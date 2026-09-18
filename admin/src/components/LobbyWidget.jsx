import * as React from 'react';

import { useIntl } from 'react-intl';

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

import { msg } from '../i18n';
import { send } from '../net/client';
import { ROLE, STATUS } from '../pluginId';
import { useGameStore } from '../store';

const HIDE_DURATIONS = [10, 15, 20, 30, 45];
const ROUND_DURATIONS = [180, 300, 600, 900];

const STATUS_KEY = {
  [STATUS.COUNTDOWN]: 'status.countdown',
  [STATUS.HIDING]: 'status.hiding',
  [STATUS.HUNTING]: 'status.hunting',
  [STATUS.OVER]: 'status.over',
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

const Setting = ({ label, first, value, onChange, children }) => (
  // Label and select sit directly in the settings row rather than in a wrapper:
  // labels take their natural width and the three selects split what is left, so
  // "Caught mode" no longer eats into its own field.
  <>
    <Typography variant="pi" textColor="neutral600" shrink={0} paddingLeft={first ? 0 : 2}>
      {label}
    </Typography>
    <Box flex="1" minWidth="0">
      <SingleSelect size="S" aria-label={label} value={value} onChange={onChange}>
        {children}
      </SingleSelect>
    </Box>
  </>
);

/** One row rather than three stacked ones — the player list needs the space. */
const Settings = ({ settings }) => {
  const { formatMessage } = useIntl();

  return (
    <Flex gap={2} wrap="nowrap" alignItems="center" paddingBottom={2}>
      <Setting
        label={formatMessage(msg('lobby.caughtMode'))}
        first
        value={settings.caughtBecome}
        onChange={(value) => send('settings', { caughtBecome: value })}
      >
        <SingleSelectOption value={ROLE.SEEKER}>
          {formatMessage(msg('lobby.seekers'))}
        </SingleSelectOption>
        <SingleSelectOption value={ROLE.SPECTATOR}>
          {formatMessage(msg('lobby.spectators'))}
        </SingleSelectOption>
      </Setting>

      <Setting
        label={formatMessage(msg('lobby.hide'))}
        value={settings.hideSeconds}
        onChange={(value) => send('settings', { hideSeconds: Number(value) })}
      >
        {HIDE_DURATIONS.map((seconds) => (
          <SingleSelectOption key={seconds} value={seconds}>
            {formatMessage(msg('lobby.seconds'), { seconds })}
          </SingleSelectOption>
        ))}
      </Setting>

      <Setting
        label={formatMessage(msg('lobby.limit'))}
        value={settings.roundSeconds}
        onChange={(value) => send('settings', { roundSeconds: Number(value) })}
      >
        {ROUND_DURATIONS.map((seconds) => (
          <SingleSelectOption key={seconds} value={seconds}>
            {formatMessage(msg('lobby.minutes'), { minutes: seconds / 60 })}
          </SingleSelectOption>
        ))}
      </Setting>
    </Flex>
  );
};

const ROLE_KEY = {
  [ROLE.SEEKER]: 'overlay.roleSeeker',
  [ROLE.HIDER]: 'overlay.roleHider',
  [ROLE.SPECTATOR]: 'overlay.roleSpectator',
};

const PlayerRow = ({ player, isMe, inRound }) => {
  const { formatMessage } = useIntl();

  const badge = () => {
    if (!inRound) {
      return formatMessage(msg(player.ready ? 'lobby.ready' : 'lobby.idle'));
    }

    if (player.caught) {
      return formatMessage(msg('lobby.found'));
    }

    return player.role ? formatMessage(msg(ROLE_KEY[player.role])) : '…';
  };

  return (
    <Flex
      justifyContent="space-between"
      alignItems="center"
      gap={2}
      paddingTop={1}
      paddingBottom={1}
    >
      <Flex gap={2} alignItems="center" overflow="hidden">
        <Dot color={player.color} dim={!player.connected} />
        <Typography
          variant="omega"
          textColor={player.connected ? 'neutral800' : 'neutral500'}
          ellipsis
        >
          {isMe ? formatMessage(msg('lobby.you'), { name: player.name }) : player.name}
        </Typography>
      </Flex>

      <Badge
        backgroundColor={
          inRound
            ? player.caught
              ? 'danger100'
              : 'neutral150'
            : player.ready
              ? 'success100'
              : 'neutral150'
        }
      >
        {badge()}
      </Badge>
    </Flex>
  );
};

/**
 * The widget body is a fixed 261px box that scrolls as a whole, so the actions
 * would slide out of reach as soon as a few players joined. Fill that height
 * exactly instead and let only the roster scroll.
 */
const Shell = ({ header, children, footer }) => (
  <Flex direction="column" alignItems="stretch" height="100%">
    <Box shrink={0}>{header}</Box>
    <Box flex="1" overflow="auto" paddingTop={2} paddingBottom={2}>
      {children}
    </Box>
    <Box shrink={0}>{footer}</Box>
  </Flex>
);

const Lobby = ({ game, me }) => {
  const { formatMessage } = useIntl();
  const readyCount = game.players.filter((p) => p.ready && p.connected).length;
  const [errorCode, setErrorCode] = React.useState(null);

  const start = () => {
    setErrorCode(null);
    send('start', {}, (result) => {
      if (result && !result.ok) {
        setErrorCode(result.code);
      }
    });
  };

  return (
    <Shell
      header={
        <>
          <Settings settings={game.settings} />
          <Divider />
        </>
      }
      footer={
        <>
          <Divider />
          <Box paddingTop={2}>
            <Flex gap={2}>
              <Button
                variant={me.ready ? 'tertiary' : 'secondary'}
                fullWidth
                onClick={() => send('ready', { ready: !me.ready })}
              >
                {formatMessage(msg(me.ready ? 'lobby.imNotReady' : 'lobby.imReady'))}
              </Button>
              <Button fullWidth disabled={readyCount < 2} onClick={start}>
                {readyCount < 2
                  ? formatMessage(msg('lobby.needPlayers'))
                  : formatMessage(msg('lobby.start'), { count: readyCount })}
              </Button>
            </Flex>

            {errorCode ? (
              <Box paddingTop={1}>
                <Typography variant="pi" textColor="danger600">
                  {formatMessage(msg(`error.${errorCode}`))}
                </Typography>
              </Box>
            ) : null}
          </Box>
        </>
      }
    >
      {game.players.map((player) => (
        <PlayerRow key={player.id} player={player} isMe={player.id === me.id} inRound={false} />
      ))}
    </Shell>
  );
};

const InRound = ({ game, me }) => {
  const { formatMessage } = useIntl();
  const hiders = game.players.filter((p) => p.role === ROLE.HIDER || p.caught);
  const found = hiders.filter((p) => p.caught).length;

  return (
    <Shell
      header={
        <>
          <Flex justifyContent="space-between" alignItems="center" paddingBottom={2}>
            <Typography variant="delta">{formatMessage(msg(STATUS_KEY[game.status]))}</Typography>
            <Badge>{formatMessage(msg('lobby.foundCount'), { found, total: hiders.length })}</Badge>
          </Flex>
          <Divider />
        </>
      }
      footer={
        <>
          <Divider />
          <Box paddingTop={2}>
            <Button variant="tertiary" fullWidth onClick={() => send('reset')}>
              {formatMessage(msg('lobby.abort'))}
            </Button>
          </Box>
        </>
      }
    >
      {game.players.map((player) => (
        <PlayerRow key={player.id} player={player} isMe={player.id === me.id} inRound />
      ))}
    </Shell>
  );
};

export const LobbyWidget = () => {
  const { formatMessage } = useIntl();
  const { game, playerId, connected } = useGameStore();

  if (!connected || !game || !playerId) {
    return (
      <Flex direction="column" gap={2} alignItems="center" justifyContent="center" height="100%">
        <Loader small>{formatMessage(msg('lobby.connecting'))}</Loader>
        <Typography variant="pi" textColor="neutral600">
          {formatMessage(msg('lobby.waiting'))}
        </Typography>
      </Flex>
    );
  }

  const me = game.players.find((player) => player.id === playerId);

  if (!me) {
    return null;
  }

  // `over` is just the lobby with the last result still on screen: this widget
  // is the lobby, so it never needs a way back to itself.
  const between = [STATUS.LOBBY, STATUS.OVER].includes(game.status);

  return between ? <Lobby game={game} me={me} /> : <InRound game={game} me={me} />;
};

export default LobbyWidget;
