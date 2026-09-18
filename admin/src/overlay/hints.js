const CLASS = 'hns-hint-target';

const normalise = (path) => String(path ?? '').replace(/\/+$/, '') || '/';

const clear = () => {
  document.querySelectorAll(`.${CLASS}`).forEach((el) => el.classList.remove(CLASS));
};

/**
 * A sidebar entry counts as pointing at the hint when the hinted page sits
 * underneath it — "Content Manager" is the way to a specific entry. The
 * homepage link is excluded: everything is underneath it, so it says nothing.
 */
const pointsAt = (anchor, target, safePath) => {
  const href = anchor.getAttribute('href');

  if (!href || href.startsWith('#') || /^[a-z]+:/i.test(href)) {
    return false;
  }

  let own;

  try {
    own = normalise(new URL(anchor.href, window.location.origin).pathname);
  } catch {
    return false;
  }

  if (safePath && own === normalise(safePath)) {
    return false;
  }

  return own === target || target.startsWith(`${own}/`);
};

/**
 * Marks whatever on this page leads towards the hinted route.
 * Returns how many links were found, so the overlay knows whether it still
 * needs to spell the destination out.
 */
export const applyHint = (path, safePath) => {
  clear();

  if (!path) {
    return 0;
  }

  const target = normalise(path);
  const anchors = [...document.querySelectorAll('a[href]')].filter((anchor) =>
    pointsAt(anchor, target, safePath)
  );

  // Deepest match only: highlighting both "Content Manager" and the entry
  // beneath it just makes the page flash in two places.
  const deepest = anchors.reduce((best, anchor) => {
    if (!best) {
      return anchor;
    }

    return anchor.pathname.length > best.pathname.length ? anchor : best;
  }, null);

  if (deepest) {
    deepest.classList.add(CLASS);

    return 1;
  }

  return 0;
};

export const clearHint = clear;
