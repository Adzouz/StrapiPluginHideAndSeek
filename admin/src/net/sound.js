import { getState } from '../store';

let ctx = null;

const context = () => {
  if (!ctx) {
    const Ctor = window.AudioContext || window.webkitAudioContext;

    ctx = Ctor ? new Ctor() : null;
  }

  return ctx;
};

/** Tiny synthesised blips — no assets, no bundle weight. */
export const beep = (frequency = 660, durationMs = 120, type = 'sine', gain = 0.04) => {
  if (getState().muted) {
    return;
  }

  const audio = context();

  if (!audio) {
    return;
  }

  if (audio.state === 'suspended') {
    audio.resume().catch(() => {});
  }

  const oscillator = audio.createOscillator();
  const volume = audio.createGain();

  oscillator.type = type;
  oscillator.frequency.value = frequency;
  volume.gain.value = gain;

  oscillator.connect(volume).connect(audio.destination);
  oscillator.start();

  volume.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + durationMs / 1000);
  oscillator.stop(audio.currentTime + durationMs / 1000);
};

export const sounds = {
  tick: () => beep(520, 90, 'square', 0.03),
  reveal: () => beep(880, 260, 'triangle', 0.05),
  caught: () => beep(180, 420, 'sawtooth', 0.05),
  found: () => beep(1040, 200, 'triangle', 0.05),
  alarm: () => beep(320, 160, 'square', 0.04),
};
