/** CITY ROLL — krótkie oryginalne efekty syntezowane przez Web Audio API.
 * Bez plików MP3/WAV, bez zależności. Dźwięki są odtwarzane wyłącznie
 * po interakcji użytkownika i nie są wysyłane do Supabase.
 */
export type GameSound = "move" | "buy" | "sell" | "build";
let audioContext: AudioContext | null = null;
let muted = false;

export function setGameSoundsMuted(value: boolean) { muted = value; }
export function getGameSoundsMuted() { return muted; }

function tone(ctx: AudioContext, at: number, frequency: number, duration: number,
              type: OscillatorType = "sine", volume = 0.08, endFrequency?: number) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(frequency, at);
  if (endFrequency) osc.frequency.exponentialRampToValueAtTime(Math.max(1, endFrequency), at + duration);
  gain.gain.setValueAtTime(0.0001, at);
  gain.gain.exponentialRampToValueAtTime(volume, at + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.0001, at + duration);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(at);
  osc.stop(at + duration + 0.01);
}

export function playGameSound(sound: GameSound, pawnId = 0) {
  if (muted || typeof window === "undefined") return;
  try {
    const AudioContextClass = window.AudioContext;
    if (!AudioContextClass) return;
    const ctx = audioContext ?? (audioContext = new AudioContextClass());
    if (ctx.state === "suspended") void ctx.resume().catch(() => {});
    const t = ctx.currentTime + 0.01;
    if (sound === "move") {
      switch (pawnId) {
        case 0: // koala — miękki, niski dźwięk
          tone(ctx, t, 300, 0.13, "sine", 0.07, 220);
          break;
        case 1: // pies — kreskówkowe szczeknięcie
          tone(ctx, t, 390, 0.065, "sawtooth", 0.035, 170);
          tone(ctx, t + 0.075, 320, 0.065, "sawtooth", 0.025, 140);
          break;
        case 2: // żaba — kumknięcie
          tone(ctx, t, 175, 0.095, "triangle", 0.11, 115);
          tone(ctx, t + 0.075, 150, 0.09, "triangle", 0.065, 95);
          break;
        case 3: // robot — dwa elektroniczne bipnięcia
          tone(ctx, t, 690, 0.065, "square", 0.035);
          tone(ctx, t + 0.075, 920, 0.07, "square", 0.03);
          break;
      }
    } else if (sound === "buy") {
      tone(ctx, t, 523.25, 0.11, "sine", 0.09);
      tone(ctx, t + 0.11, 659.25, 0.11, "sine", 0.09);
      tone(ctx, t + 0.22, 783.99, 0.22, "sine", 0.10);
    } else if (sound === "sell") {
      tone(ctx, t, 880, 0.08, "triangle", 0.09);
      tone(ctx, t + 0.095, 659.25, 0.11, "triangle", 0.09);
      tone(ctx, t + 0.21, 523.25, 0.18, "triangle", 0.09);
    } else if (sound === "build") {
      tone(ctx, t, 260, 0.085, "square", 0.04, 190);
      tone(ctx, t + 0.12, 520, 0.16, "triangle", 0.07);
    }
  } catch {
    // Dźwięk nie może nigdy przerwać rozgrywki.
  }
}
