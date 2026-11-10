export const pawnOptions = [
  { id: 0, icon: "🐶", name: "Pies" },
  { id: 1, icon: "🐱", name: "Kot" },
  { id: 2, icon: "⚡", name: "Pikachu" },
  { id: 3, icon: "🦊", name: "Lis" },
  { id: 4, icon: "🐼", name: "Panda" },
  { id: 5, icon: "🐸", name: "Żaba" },
  { id: 6, icon: "🤖", name: "Robot" },
  { id: 7, icon: "👻", name: "Duszek" },
];
export function pawnIcon(pawn: number | null | undefined) {
  return pawnOptions.find((option) => option.id === pawn)?.icon ?? "🎩";
}
export const playerAccents = ["#fb7185", "#60a5fa", "#4ade80", "#facc15"];
// Pola są indeksowane od 0 w kodzie (pole 1 = indeks 0).
export const cityNames = [
  "START", "GDAŃSK", "GDYNIA", "BOBROWNIKI", "KOPALNIA WĘGLA", "TORUŃ", "BYDGOSZCZ",
  "KARTA LOSOWA", "SZCZECIN", "KOSZALIN", "POZNAŃ", "STACJA KOLEJOWA", "KALISZ", "GNIEZNO",
  "WIĘZIENIE", "WIELICZKA", "KRAKÓW", "KATOWICE", "STACJA PALIW", "SOSNOWIEC", "ZABRZE",
  "PARKING / LOS", "BIAŁYSTOK", "SUWAŁKI", "RZESZÓW", "LOTNISKO", "NISKO", "STALOWA WOLA",
];
export const specialIds = new Set([0, 7, 14, 18, 21]);
// Obiekty z ceną są pokazane na planszy, lecz pełne zasady ich zakupu
// muszą być zgodne z funkcjami SQL w Supabase.
export const cityPrices: Array<number | null> = [
  null, 100, 100, 130, 140, 150, 150,
  null, 170, 180, 200, 180, 200, 200,
  null, 250, 250, 300, null, 300, 300,
  null, 350, 350, 420, 200, 420, 450,
];
const YELLOW = "#facc15";
const GREEN = "#4ade80";
const BLUE = "#60a5fa";
const ORANGE = "#fb923c";
const PURPLE = "#c084fc";
const BROWN = "#a16207";
const TURQUOISE = "#2dd4bf";
const RED = "#fb7185";
const SPECIAL = "#fbbf24";
export const fieldColors = [
  SPECIAL, YELLOW, YELLOW, GREEN, SPECIAL, GREEN, GREEN,
  SPECIAL, BLUE, BLUE, ORANGE, SPECIAL, ORANGE, ORANGE,
  SPECIAL, PURPLE, PURPLE, BROWN, SPECIAL, BROWN, BROWN,
  SPECIAL, TURQUOISE, TURQUOISE, RED, SPECIAL, RED, RED,
];
export const fieldIcons: Record<number, string> = {
  0: "🚩", 4: "⛏️", 7: "❓", 11: "🚆", 14: "🔒",
  18: "⛽", 21: "🅿️", 25: "✈️",
};
export const fields = cityNames.map((name, id) => ({
  id,
  name,
  price: cityPrices[id],
  color: fieldColors[id],
  icon: fieldIcons[id] ?? null,
}));

export function getPosition(index: number) {
  // START: lewy dolny róg. Ruch przeciwnie do poprzedniej wersji.
  if (index < 8) return { row: 8 - index, col: 1 };
  if (index < 15) return { row: 1, col: index - 6 };
  if (index < 22) return { row: index - 13, col: 8 };
  return { row: 8, col: 29 - index };
}
