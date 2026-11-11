"use client";

import type { ReactNode } from "react";
import { gameTheme } from "../gameTheme";

/** Wyłącznie wygląd zewnętrzny. Nie obsługuje żadnej mechaniki gry. */
export function GameLayout({ children }: { children: ReactNode }) {
  return (
    <main
      className="min-h-screen"
      style={{ background: gameTheme.pageBackground, color: gameTheme.text }}
    >
      {children}
    </main>
  );
}

/** Szerokość, kolor i obramowanie obszaru gry można zmieniać tutaj. */
export function GameFrame({ children }: { children: ReactNode }) {
  return (
    <div
      className="mx-auto flex min-h-screen w-full max-w-[640px] flex-col border-x pb-4 shadow-2xl"
      style={{
        background: gameTheme.frameBackground,
        borderColor: gameTheme.frameBorder,
        color: gameTheme.text,
      }}
    >
      {children}
    </div>
  );
}
