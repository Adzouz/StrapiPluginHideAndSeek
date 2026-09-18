import { PLUGIN_ID } from './pluginId';
import { setState } from './store';

const LOCALE_STORAGE_KEY = 'strapi-admin-language';

/**
 * Every user-facing string, in English. Translation files hold the same keys,
 * prefixed with the plugin id — that is how Strapi merges plugin catalogues.
 */
export const defaults = {
  'widget.title': 'Hide & Seek',
  'leaderboard.title': 'Hide & Seek leaderboard',

  'lobby.connecting': 'Connecting',
  'lobby.waiting': 'Waiting for the game server…',
  'lobby.caughtMode': 'Caught mode',
  'lobby.hide': 'Hide',
  'lobby.limit': 'Limit',
  'lobby.seekers': 'seekers',
  'lobby.spectators': 'spectators',
  'lobby.minutes': '{minutes} min',
  'lobby.seconds': '{seconds}s',
  'lobby.ready': 'ready',
  'lobby.idle': 'idle',
  'lobby.found': 'found',
  'lobby.you': '{name} (you)',
  'lobby.imReady': "I'm ready",
  'lobby.imNotReady': "I'm not ready",
  'lobby.needPlayers': 'Need 2 players',
  'lobby.start': 'Start ({count})',
  'lobby.abort': 'Abort round',
  'lobby.backToLobby': 'Back to the lobby',
  'lobby.foundCount': '{found}/{total} found',

  'status.countdown': 'Drawing the seeker…',
  'status.hiding': 'Everyone is hiding',
  'status.hunting': 'Hunt in progress',
  'status.over': 'Round over',

  'error.notEnoughPlayers': 'Need at least 2 ready players',
  'error.roundRunning': 'A round is already running',

  'leaderboard.empty': 'No rounds played yet. Win one and the board is yours.',
  'leaderboard.players': '{count} players all-time',
  'leaderboard.points': 'points',
  'leaderboard.pointsHint': '10 points per player found, 20 per round survived as a hider',
  'leaderboard.rowHint':
    '{found} found · {survived} escapes · caught {caught} times in {rounds} rounds',

  'overlay.go': 'GO',
  'overlay.youAreSeeker': 'You are the seeker',
  'overlay.seekerIntro': 'Eyes closed. Everyone else is scattering across the admin.',
  'overlay.runAndHide': 'Run and hide',
  'overlay.hiderIntro':
    'Navigate anywhere in the admin panel. The page you land on is your hiding spot.',
  'overlay.noPeeking': 'No peeking',
  'overlay.huntOpens': 'The hunt opens in {seconds}s. Then find every cursor.',
  'overlay.hideNow': 'Hide!',
  'overlay.lockedIn': 'Locked in',
  'overlay.you': 'You',
  'overlay.youAreHider': 'You are a hider',
  'overlay.youAreSpectator': 'You are a spectator',
  'overlay.safeZone': 'Safe zone',
  'overlay.hintHere': 'Someone is through here',
  'overlay.hintPath': 'Someone is on {path}',
  'overlay.caughtTitle': 'Caught!',
  'overlay.caughtBy': '{name} found you.',
  'overlay.lastedFor': 'You lasted {time}.',
  'overlay.nowSeeker': 'You are a seeker now — go find the rest.',
  'overlay.nowSpectator': 'You are out. Watch the rest unfold.',
  'overlay.follow': 'Following',
  'overlay.followNobody': 'Nobody to follow',
  'overlay.followPrev': 'Previous player',
  'overlay.followNext': 'Next player',
  'overlay.roleSeeker': 'Seeker',
  'overlay.roleHider': 'Hider',
  'overlay.roleSpectator': 'Spectator',
  'overlay.mute': 'Mute',
  'overlay.unmute': 'Unmute',
  'overlay.seekersWin': 'Seekers win',
  'overlay.hidersWin': 'Hiders win',
  'overlay.youMadeIt': 'You made it.',
  'overlay.betterLuck': 'Better luck next round.',
  'overlay.roundLasted': 'Round lasted {time}.',
  'overlay.foundTotal': '{count} found',

  'toast.foundYou': '{name} found you!',
  'toast.youFound': 'You found {name}!',
  'toast.someoneFound': '{seeker} found {hider}',
  'toast.left': '{name} left the game',
  'toast.locked': 'Locked in — you cannot leave yet!',
  'toast.external': 'Not while the game is on.',
};

/** Descriptor for react-intl, inside the admin tree. */
export const msg = (key) => ({ id: `${PLUGIN_ID}.${key}`, defaultMessage: defaults[key] });

const interpolate = (template, values = {}) =>
  template.replace(/\{(\w+)\}/g, (match, name) =>
    values[name] === undefined ? match : String(values[name])
  );

let messages = {};
let loadedLocale = null;

const currentLocale = () => {
  try {
    return window.localStorage.getItem(LOCALE_STORAGE_KEY) || 'en';
  } catch {
    return 'en';
  }
};

/**
 * The overlay renders in its own React root, outside the admin's IntlProvider,
 * so it cannot use react-intl. It reads the same catalogues directly, keyed off
 * the locale the admin stored.
 */
export const t = (key, values) => {
  const translated = messages[`${PLUGIN_ID}.${key}`] ?? defaults[key] ?? key;

  return interpolate(translated, values);
};

/**
 * Loads the catalogue for the admin's current locale. Safe to call often: it
 * only does work when the locale actually changed.
 */
export const refreshLocale = async () => {
  const locale = currentLocale();

  if (locale === loadedLocale) {
    return;
  }

  loadedLocale = locale;

  if (locale.startsWith('en')) {
    messages = {};
    setState({ locale });
    return;
  }

  try {
    const { default: data } = await import(`./translations/${locale}.json`);

    messages = data;
  } catch {
    // No catalogue for this locale: English defaults stand.
    messages = {};
  }

  setState({ locale });
};
