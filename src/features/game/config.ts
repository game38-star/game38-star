
// Cztery pionki CITY ROLL — każdy ma własny, stały kolor.
export const pawnOptions = [
  { id: 0, icon: "🐨", name: "Koala", color: "#a78bfa" },
  { id: 1, icon: "🐶", name: "Pies", color: "#fb923c" },
  { id: 2, icon: "🐸", name: "Żaba", color: "#4ade80" },
  { id: 3, icon: "🤖", name: "Robot", color: "#38bdf8" },
];

export function pawnIcon(pawn: number | null | undefined) {
  return pawnOptions.find((option) => option.id === pawn)?.icon ?? "🎩";
}

export function pawnColor(pawn: number | null | undefined) {
  return pawnOptions.find((option) => option.id === pawn)?.color ?? "#e2e8f0";
}

export const playerAccents = pawnOptions.map((option) => option.color);

// Pola są indeksowane od 0.
// Pole 1 na planszy = indeks 0 w kodzie.
export const cityNames = [
  "START", "GDAŃSK", "GDYNIA", "BOBROWNIKI", "KOPALNIA WĘGLA",
  "TORUŃ", "BYDGOSZCZ", "KARTA LOSOWA", "SZCZECIN", "KOSZALIN",
  "POZNAŃ", "STACJA KOLEJOWA", "KALISZ", "GNIEZNO", "WIĘZIENIE",
  "WIELICZKA", "KRAKÓW", "KATOWICE", "STACJA PALIW", "SOSNOWIEC",
  "ZABRZE", "KARTA LOSOWA", "BIAŁYSTOK", "SUWAŁKI", "RZESZÓW",
  "LOTNISKO", "NISKO", "STALOWA WOLA",
];

export const specialIds = new Set([0, 7, 14, 21]);

export const cityPrices: Array<number | null> = [
  null, 100, 100, 130, 100, 150, 150, null,
  170, 180, 200, 150, 200, 200, null, 250,
  250, 300, 200, 300, 300, null, 350, 350,
  420, 250, 420, 450,
];

const YELLOW = "#facc15";
const GREEN = "#4ade80";
const BLUE = "#60a5fa";
const ORANGE = "#fb923c";
const PURPLE = "#c084fc";
const BROWN = "#a16207";
const TURQUOISE = "#2dd4bf";
const RED = "#fb7185";
const WHITE = "#ffffff";
const START = "#f43f5e";

export const fieldColors = [
  START, YELLOW, YELLOW, GREEN, WHITE, GREEN, GREEN, WHITE,
  BLUE, BLUE, ORANGE, WHITE, ORANGE, ORANGE, WHITE, PURPLE,
  PURPLE, BROWN, WHITE, BROWN, BROWN, WHITE, TURQUOISE,
  TURQUOISE, RED, WHITE, RED, RED,
];

export const fieldIcons: Record<number, string> = {
  0: "🚩", 4: "⛏️", 7: "❓", 11: "🚆",
  14: "🔒", 18: "⛽", 21: "❓", 25: "✈️",
};

export const fields = cityNames.map((name, id) => ({
  id,
  name,
  price: cityPrices[id],
  color: fieldColors[id],
  icon: fieldIcons[id] ?? null,
}));

export function getPosition(index: number) {
  // START: lewy dolny róg. Dotychczasowy kierunek ruchu.
  if (index < 8) return { row: 8 - index, col: 1 };
  if (index < 15) return { row: 1, col: index - 6 };
  if (index < 22) return { row: index - 13, col: 8 };
  return { row: 8, col: 29 - index };
}
