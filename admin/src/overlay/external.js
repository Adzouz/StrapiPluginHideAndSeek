const CLASS = 'hns-external';

const clear = () => {
  document.querySelectorAll(`.${CLASS}`).forEach((el) => el.classList.remove(CLASS));
};

export const isExternal = (anchor) => {
  try {
    return new URL(anchor.href, window.location.origin).origin !== window.location.origin;
  } catch {
    return false;
  }
};

/**
 * A round is no time to be reading the Strapi docs. Anything pointing off this
 * origin gets dimmed and made unclickable until the game is over — the admin is
 * full of outbound links, and one stray click drops a player out of the round.
 */
export const guardExternalLinks = (active) => {
  clear();

  if (!active) {
    return 0;
  }

  let guarded = 0;

  document.querySelectorAll('a[href]').forEach((anchor) => {
    if (!isExternal(anchor)) {
      return;
    }

    anchor.classList.add(CLASS);
    guarded += 1;
  });

  return guarded;
};

export const releaseExternalLinks = clear;
