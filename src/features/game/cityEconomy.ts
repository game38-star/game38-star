
export type CityEconomy = {
  price: number;
  rent: number;
  sellPrice: number;
  buildingRents: [number, number, number];
  buildingCost: number;
};

// Numery pól w kodzie gry: 0–27
// Numery z Twojej listy: 1–28

export const cityEconomy: Record<number, CityEconomy> = {
  // ŻÓŁTE
  1: { price: 100, rent: 10, sellPrice: 80, buildingRents: [30, 90, 160], buildingCost: 50 },
  2: { price: 100, rent: 10, sellPrice: 80, buildingRents: [30, 90, 160], buildingCost: 50 },

  // ZIELONE
  3: { price: 130, rent: 15, sellPrice: 105, buildingRents: [40, 120, 300], buildingCost: 70 },
  5: { price: 150, rent: 15, sellPrice: 120, buildingRents: [60, 150, 350], buildingCost: 80 },
  6: { price: 150, rent: 15, sellPrice: 120, buildingRents: [60, 150, 350], buildingCost: 80 },

  // NIEBIESKIE
  8: { price: 170, rent: 20, sellPrice: 135, buildingRents: [60, 160, 360], buildingCost: 90 },
  9: { price: 180, rent: 20, sellPrice: 145, buildingRents: [70, 180, 400], buildingCost: 100 },

  // POMARAŃCZOWE
  10: { price: 200, rent: 30, sellPrice: 160, buildingRents: [90, 200, 570], buildingCost: 120 },
  12: { price: 200, rent: 30, sellPrice: 160, buildingRents: [90, 200, 570], buildingCost: 120 },
  13: { price: 200, rent: 30, sellPrice: 160, buildingRents: [90, 200, 570], buildingCost: 120 },

  // FIOLETOWE
  15: { price: 250, rent: 35, sellPrice: 200, buildingRents: [130, 250, 520], buildingCost: 140 },
  16: { price: 250, rent: 35, sellPrice: 200, buildingRents: [130, 250, 520], buildingCost: 140 },

  // BRĄZOWE
  17: { price: 300, rent: 40, sellPrice: 240, buildingRents: [150, 300, 750], buildingCost: 170 },
  19: { price: 300, rent: 40, sellPrice: 240, buildingRents: [150, 300, 750], buildingCost: 170 },
  20: { price: 300, rent: 40, sellPrice: 240, buildingRents: [150, 300, 750], buildingCost: 170 },

  // TURKUSOWE
  22: { price: 350, rent: 50, sellPrice: 280, buildingRents: [140, 350, 650], buildingCost: 200 },
  23: { price: 350, rent: 50, sellPrice: 280, buildingRents: [140, 350, 650], buildingCost: 200 },

  // CZERWONE
  24: { price: 420, rent: 70, sellPrice: 335, buildingRents: [200, 500, 900], buildingCost: 200 },
  26: { price: 420, rent: 70, sellPrice: 335, buildingRents: [200, 500, 900], buildingCost: 200 },
  27: { price: 450, rent: 80, sellPrice: 360, buildingRents: [250, 650, 1000], buildingCost: 200 },
};

export function getCityEconomy(fieldId: number): CityEconomy | null {
  return cityEconomy[fieldId] ?? null;
}

export function getCityRent(
  fieldId: number,
  buildingLevel: number
): number | null {
  const city = getCityEconomy(fieldId);

  if (!city) return null;

  const level = Math.max(0, Math.min(3, Math.trunc(buildingLevel)));

  return level === 0
    ? city.rent
    : city.buildingRents[level - 1];
}
