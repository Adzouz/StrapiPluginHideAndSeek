const CSS = `
.hns-root, .hns-root * { box-sizing: border-box; }
.hns-root {
  position: fixed;
  inset: 0;
  z-index: 2147483000;
  pointer-events: none;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  color: #fff;
}
.hns-root button { pointer-events: auto; font: inherit; cursor: pointer; }

/* ---------------------------------------------------------------- ghosts */
.hns-ghosts { position: absolute; inset: 0; overflow: hidden; }
.hns-ghost {
  position: absolute;
  top: 0;
  left: 0;
  width: 56px;
  height: 56px;
  margin: -28px 0 0 -28px;
  display: flex;
  align-items: center;
  justify-content: center;
  will-change: transform;
}
.hns-ghost__body {
  width: 34px;
  height: 34px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 18px;
  background: var(--hns-color);
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.45);
  transition: transform 120ms ease;
}
.hns-ghost__ring {
  position: absolute;
  inset: 0;
  border-radius: 50%;
  background: conic-gradient(#ffd046 calc(var(--hns-progress) * 360deg), transparent 0);
  -webkit-mask: radial-gradient(farthest-side, transparent calc(100% - 5px), #000 calc(100% - 4px));
  mask: radial-gradient(farthest-side, transparent calc(100% - 5px), #000 calc(100% - 4px));
  opacity: var(--hns-progress);
}
.hns-ghost__name {
  position: absolute;
  top: 100%;
  white-space: nowrap;
  font-size: 11px;
  font-weight: 600;
  padding: 2px 6px;
  border-radius: 4px;
  background: rgba(20, 20, 30, 0.8);
}
.hns-ghost--pinging .hns-ghost__body { animation: hns-pulse 900ms ease-out infinite; }
@keyframes hns-pulse {
  0%   { box-shadow: 0 0 0 0 var(--hns-color); }
  100% { box-shadow: 0 0 0 22px rgba(0, 0, 0, 0); }
}

/* ---------------------------------------------------------------- panels */
.hns-fullscreen {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 16px;
  text-align: center;
  background: rgba(10, 10, 18, 0.92);
  pointer-events: auto;
}
.hns-fullscreen--soft { background: rgba(10, 10, 18, 0.6); pointer-events: none; }
.hns-huge { font-size: 96px; font-weight: 800; line-height: 1; letter-spacing: -2px; }
.hns-title { font-size: 34px; font-weight: 800; letter-spacing: -0.5px; }
.hns-sub { font-size: 15px; opacity: 0.75; max-width: 420px; }

.hns-card {
  background: #181826;
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 12px;
  padding: 24px 28px;
  min-width: 320px;
  box-shadow: 0 24px 60px rgba(0, 0, 0, 0.5);
  pointer-events: auto;
}
.hns-score { display: flex; justify-content: space-between; gap: 16px; padding: 6px 0; font-size: 14px; }
.hns-dot { width: 10px; height: 10px; border-radius: 50%; display: inline-block; margin-right: 8px; }
.hns-btn {
  margin-top: 16px;
  width: 100%;
  border: 0;
  border-radius: 6px;
  padding: 10px 16px;
  font-weight: 600;
  color: #fff;
  background: #4945ff;
}
.hns-btn:hover { background: #7b79ff; }

/* ------------------------------------------------------------------- hud */
.hns-hud {
  position: absolute;
  top: 12px;
  right: 12px;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 12px;
  border-radius: 999px;
  font-size: 13px;
  font-weight: 600;
  background: rgba(20, 20, 32, 0.88);
  border: 1px solid rgba(255, 255, 255, 0.12);
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.35);
  pointer-events: auto;
}
.hns-hud__sep { width: 1px; height: 16px; background: rgba(255, 255, 255, 0.15); }
.hns-hud__mute { background: none; border: 0; color: inherit; opacity: 0.7; padding: 0; }
.hns-hud__mute:hover { opacity: 1; }

/* --------------------------------------------------------------- danger */
.hns-danger {
  position: absolute;
  inset: 0;
  box-shadow: inset 0 0 120px 20px rgba(238, 94, 82, 0.55);
  animation: hns-danger 1s ease-in-out infinite alternate;
}
@keyframes hns-danger { from { opacity: 0.35; } to { opacity: 1; } }

/* ------------------------------------------------------------- lockdown */
.hns-lock {
  position: absolute;
  top: 12px;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 16px;
  border-radius: 999px;
  font-size: 13px;
  font-weight: 700;
  color: #ffd046;
  background: rgba(20, 20, 32, 0.92);
  border: 1px solid #ffd046;
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.35);
}
.hns-lock__bar {
  width: 70px;
  height: 4px;
  border-radius: 2px;
  background: rgba(255, 255, 255, 0.15);
  overflow: hidden;
}
.hns-lock__bar span {
  display: block;
  height: 100%;
  background: #ffd046;
  transition: width 200ms linear;
}

/* ---------------------------------------------------------------- toast */
.hns-toast {
  position: absolute;
  bottom: 24px;
  left: 50%;
  transform: translateX(-50%);
  padding: 10px 18px;
  border-radius: 999px;
  font-size: 14px;
  font-weight: 600;
  background: rgba(20, 20, 32, 0.92);
  border: 1px solid rgba(255, 255, 255, 0.12);
}
.hns-toast--good { border-color: #5cb176; }
.hns-toast--bad { border-color: #ee5e52; }
`;

let injected = false;

export const injectStyles = () => {
  if (injected) {
    return;
  }

  injected = true;

  const style = document.createElement('style');

  style.id = 'hide-and-seek-styles';
  style.textContent = CSS;
  document.head.appendChild(style);
};
