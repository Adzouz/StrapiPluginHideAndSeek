import * as React from 'react';

import { useIntl } from 'react-intl';

import { Box, Divider, EmptyStateLayout, Flex, Tooltip, Typography } from '@strapi/design-system';

import { msg } from '../i18n';
import { useGameStore } from '../store';

const MEDALS = ['🥇', '🥈', '🥉'];

const Rank = ({ index }) => (
  <Box width="24px" textAlign="center">
    {MEDALS[index] ? (
      <span style={{ fontSize: 14 }}>{MEDALS[index]}</span>
    ) : (
      <Typography variant="pi" textColor="neutral500">
        {index + 1}
      </Typography>
    )}
  </Box>
);

const Row = ({ row, index, isMe }) => {
  const { formatMessage } = useIntl();

  return (
    <Flex
      justifyContent="space-between"
      alignItems="center"
      gap={2}
      paddingTop={1}
      paddingBottom={1}
    >
      <Flex gap={2} alignItems="center" overflow="hidden">
        <Rank index={index} />
        <span
          style={{
            width: 10,
            height: 10,
            borderRadius: '50%',
            background: row.color,
            flexShrink: 0,
          }}
        />
        <Typography variant="omega" fontWeight={isMe ? 'bold' : 'regular'} ellipsis>
          {isMe ? formatMessage(msg('lobby.you'), { name: row.name }) : row.name}
        </Typography>
      </Flex>

      <Flex gap={3} alignItems="center" flexShrink={0}>
        <Tooltip
          label={formatMessage(msg('leaderboard.rowHint'), {
            found: row.found,
            survived: row.survived,
            caught: row.caught,
            rounds: row.rounds,
          })}
        >
          <Typography variant="pi" textColor="neutral600">
            {`🔦 ${row.found} · 👻 ${row.survived}`}
          </Typography>
        </Tooltip>
        <Typography variant="omega" fontWeight="bold">
          {row.points}
        </Typography>
      </Flex>
    </Flex>
  );
};

export const LeaderboardWidget = () => {
  const { formatMessage } = useIntl();
  const { leaderboard, playerId } = useGameStore();

  if (leaderboard.length === 0) {
    return (
      <EmptyStateLayout
        icon={<span style={{ fontSize: 40 }}>👑</span>}
        content={formatMessage(msg('leaderboard.empty'))}
        shadow="none"
      />
    );
  }

  const top = leaderboard.slice(0, 10);
  // Nobody wants to scroll to find themselves; pin their row if they missed the cut.
  const mine = leaderboard.findIndex((row) => row.id === playerId);
  const showOwnRow = mine >= top.length;

  // Same fixed-height widget body as the lobby: only the standings scroll.
  return (
    <Flex direction="column" alignItems="stretch" height="100%">
      <Flex justifyContent="space-between" paddingBottom={2} shrink={0}>
        <Typography variant="pi" textColor="neutral600">
          {formatMessage(msg('leaderboard.players'), { count: leaderboard.length })}
        </Typography>
        <Tooltip label={formatMessage(msg('leaderboard.pointsHint'))}>
          <Typography variant="pi" textColor="neutral600">
            {`${formatMessage(msg('leaderboard.points'))} ⓘ`}
          </Typography>
        </Tooltip>
      </Flex>

      <Box flex="1" overflow="auto">
        {top.map((row, index) => (
          <Row key={row.id} row={row} index={index} isMe={row.id === playerId} />
        ))}
      </Box>

      {showOwnRow ? (
        <Box shrink={0} paddingTop={1}>
          <Divider />
          <Box paddingTop={1}>
            <Row row={leaderboard[mine]} index={mine} isMe />
          </Box>
        </Box>
      ) : null}
    </Flex>
  );
};

export default LeaderboardWidget;
