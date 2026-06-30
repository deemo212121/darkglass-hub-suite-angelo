/**
 * Browser-only notification beep. Plays a short, pleasant tone using the
 * Web Audio API — no audio file dependency. Safe to call multiple times in
 * quick succession; we throttle so a burst of incoming messages doesn't
 * overlap into a continuous drone.
 */

const THROTTLE_MS = 1200;
let lastPlayedAt = 0;
let cachedCtx: AudioContext | null = null;

function getCtx(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (cachedCtx) return cachedCtx;
  const Ctor = (window as any).AudioContext || (window as any).webkitAudioContext;
  if (!Ctor) return null;
  try {
    cachedCtx = new Ctor();
    return cachedCtx;
  } catch {
    return null;
  }
}

export function playNotifySound() {
  if (typeof window === "undefined") return;
  const now = Date.now();
  if (now - lastPlayedAt < THROTTLE_MS) return;
  lastPlayedAt = now;

  const ctx = getCtx();
  if (!ctx) return;
  try {
    // Many browsers require an interaction-resumed AudioContext.
    if (ctx.state === "suspended") {
      ctx.resume().catch(() => { /* ignore */ });
    }
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    // Two-tone "blip": E5 → A5
    const t0 = ctx.currentTime;
    osc.frequency.setValueAtTime(660, t0);
    osc.frequency.setValueAtTime(880, t0 + 0.09);
    gain.gain.setValueAtTime(0, t0);
    gain.gain.linearRampToValueAtTime(0.22, t0 + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.35);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(t0);
    osc.stop(t0 + 0.4);
  } catch {
    // ignore — sound is a nice-to-have
  }
}

/**
 * Distinct chime for announcement banners. Three rising notes, slower and
 * warmer than the message blip so users can tell them apart by ear.
 */
export function playAnnouncementSound() {
  if (typeof window === "undefined") return;
  const now = Date.now();
  if (now - lastPlayedAt < THROTTLE_MS) return;
  lastPlayedAt = now;

  const ctx = getCtx();
  if (!ctx) return;
  try {
    if (ctx.state === "suspended") {
      ctx.resume().catch(() => { /* ignore */ });
    }
    const t0 = ctx.currentTime;
    // C5, E5, G5 — pleasant ascending major triad.
    const notes: Array<[number, number]> = [
      [523.25, t0],
      [659.25, t0 + 0.14],
      [783.99, t0 + 0.28],
    ];
    notes.forEach(([freq, start]) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "triangle";
      osc.frequency.setValueAtTime(freq, start);
      gain.gain.setValueAtTime(0, start);
      gain.gain.linearRampToValueAtTime(0.18, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.5);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(start);
      osc.stop(start + 0.55);
    });
  } catch {
    // ignore
  }
}
