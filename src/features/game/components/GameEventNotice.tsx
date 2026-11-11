import { formatGameEvent, type GameEvent } from "../gameEvents";

type GameEventNoticeProps = {
  event: GameEvent | null;
};

/** Wizualny komunikat do umieszczenia w centrum GameBoard. */
export function GameEventNotice({ event }: GameEventNoticeProps) {
  if (!event) return null;
  const display = formatGameEvent(event);
  return (
    <div className="mx-auto flex w-full max-w-[260px] flex-col items-center gap-2 rounded-xl border border-white/20 bg-[#172235] px-3 py-4 text-center text-white shadow-lg" role="status" aria-live="polite">
      <span className="text-3xl" aria-hidden="true">{display.icon}</span>
      <p className="text-xs font-extrabold text-amber-200">{display.title}</p>
      <p className="text-sm font-semibold leading-snug">{display.description}</p>
    </div>
  );
}
