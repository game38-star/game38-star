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
export const cityNames = [
  "START", "GDAŃSK", "GDYNIA", "SOPOT", "OLSZTYN", "TORUŃ", "BYDGOSZCZ",
  "WIĘZIENIE", "SZCZECIN", "GORZÓW", "POZNAŃ", "ZIELONA GÓRA", "WROCŁAW", "OPOLE",
  "PARKING", "KATOWICE", "KRAKÓW", "RZESZÓW", "LUBLIN", "KIELCE", "ŁÓDŹ",
  "IDŹ DO WIĘZ.", "BIAŁYSTOK", "RADOM", "PŁOCK", "SIEDLCE", "WARSZAWA", "ZAKOPANE",
];
export const groupColors = ["#fb7185", "#60a5fa", "#fbbf24", "#34d399", "#a78bfa", "#fb923c"];
export const specialIds = new Set([0, 7, 14, 21]);
// Ceny według układu widocznego na zrzucie Plato, dostosowane do 28 pól.
// START -> lewa krawędź -> góra -> prawa krawędź -> dół.
export const cityPrices: Array<number | null> = [
  null, 180, 180, 345, 70, 395, 395,
  null, 20, 20, 60, 70, 70, 60,
  null, 590, 590, 80, 80, 80, 40,
  null, 45, 50, 150, 35, 70, 150,
];
export const fields = cityNames.map((name, id) => ({
  id,
  name,
  price: cityPrices[id],
  color: groupColors[Math.floor(id / 4) % groupColors.length],
}));

export function getPosition(index: number) {
  // START: lewy dolny róg. Ruch przeciwnie do poprzedniej wersji.
  if (index < 8) return { row: 8 - index, col: 1 };
  if (index < 15) return { row: 1, col: index - 6 };
  if (index < 22) return { row: index - 13, col: 8 };
  return { row: 8, col: 29 - index };
}
