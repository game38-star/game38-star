/** Typy i prezentacja zdarzeń CITY ROLL. Bez zależności od React/Supabase. */
export type GameEventType =
  | "property_purchase"
  | "auction_bid"
  | "auction_won"
  | "auction_no_sale"
  | "building_built"
  | "building_sale"
  | "property_sale"
  | "rent_paid"
  | "chance_card";

export type GameEvent = {
  id: string;
  roomId: string;
  type: GameEventType;
  actorId: string | null;
  actorName: string;
  fieldId?: number | null;
  fieldName?: string | null;
  amount?: number | null;
  recipientName?: string | null;
  cardText?: string | null;
  createdAt: string;
};

export type GameEventDisplay = {
  icon: string;
  title: string;
  description: string;
};

const money = (amount?: number | null) =>
  amount == null ? "" : `${amount.toLocaleString("en-US")} $`;

export function formatGameEvent(event: GameEvent): GameEventDisplay {
  const who = event.actorName || "Gracz";
  const where = event.fieldName || "nieruchomość";
  const price = money(event.amount);

  switch (event.type) {
    case "property_purchase":
      return { icon: "🏙️", title: "Zakup nieruchomości", description: `${who} kupił ${where}${price ? ` za ${price}` : ""}.` };
    case "auction_bid":
      return { icon: "🔨", title: "Nowa oferta", description: `${who} zaoferował ${price || "nową kwotę"} za ${where}.` };
    case "auction_won":
      return { icon: "🏆", title: "Koniec licytacji", description: `${who} wygrał ${where}${price ? ` za ${price}` : ""}.` };
    case "auction_no_sale":
      return { icon: "🔨", title: "Koniec licytacji", description: `Nie sprzedano nieruchomości ${where}.` };
    case "building_built":
      return { icon: "🏠", title: "Nowy budynek", description: `${who} wybudował budynek w ${where}${price ? ` za ${price}` : ""}.` };
    case "building_sale":
      return { icon: "🏗️", title: "Sprzedaż budynku", description: `${who} sprzedał budynek w ${where}${price ? ` za ${price}` : ""}.` };
    case "property_sale":
      return { icon: "💰", title: "Sprzedaż nieruchomości", description: `${who} sprzedał ${where}${price ? ` za ${price}` : ""}.` };
    case "rent_paid":
      return { icon: "💸", title: "Opłacony czynsz", description: `${who} zapłacił ${price || "czynsz"}${event.recipientName ? ` graczowi ${event.recipientName}` : ""} za ${where}.` };
    case "chance_card":
      return { icon: "❓", title: "Karta losowa", description: `${who} wylosował kartę${event.cardText ? `: ${event.cardText}` : "."}` };
  }
}
