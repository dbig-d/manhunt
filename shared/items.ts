import type { ItemId, Role } from "./protocol";

export interface ItemInfo {
  id: ItemId;
  name: string;
  team: Role;
  /** One line for the shop. */
  description: string;
  price: number;
  /** Uses per player per game (0 = no limit). */
  limit: number;
  /** How long it lasts, for timed items. */
  durationSec?: number;
}

// Prices are balanced against a hider alone in a safe zone earning ~6 coins a minute.
export const ITEMS: ItemInfo[] = [
  { id: "jammer", name: "Jammer", team: "hider", price: 10, limit: 3, description: "Your next ping shows where you were 30 seconds ago." },
  { id: "ghost", name: "Ghost", team: "hider", price: 15, limit: 2, description: "Skip your next ping. Seekers keep seeing your old spot." },
  { id: "alarm", name: "Proximity alarm", team: "hider", price: 15, limit: 3, durationSec: 180, description: "For 3 minutes, get warned when a seeker is within 40 m." },
  { id: "decoy", name: "Decoy", team: "hider", price: 20, limit: 2, description: "Your next ping puts you 50–100 m away from where you are." },
  { id: "static", name: "Static", team: "hider", price: 20, limit: 2, durationSec: 180, description: "For 3 minutes your pings are a big blurry circle." },
  { id: "radar", name: "Radar", team: "hider", price: 25, limit: 2, durationSec: 10, description: "See every seeker live for 10 seconds." },
  { id: "blackout", name: "Blackout", team: "hider", price: 40, limit: 1, durationSec: 20, description: "Every seeker's map goes dark for 20 seconds." },
  { id: "revive", name: "Revive", team: "hider", price: 60, limit: 1, description: "Bring a caught hider back into the game." },
  { id: "scan", name: "Zone scan", team: "seeker", price: 15, limit: 3, durationSec: 15, description: "See which safe zones have hiders in them right now." },
  { id: "instantPing", name: "Instant ping", team: "seeker", price: 20, limit: 2, description: "Ping every hider right now." },
  { id: "tracker", name: "Tracker", team: "seeker", price: 30, limit: 1, durationSec: 8, description: "Follow the nearest hider live for 8 seconds." },
];

export const ITEM_BY_ID = Object.fromEntries(ITEMS.map((i) => [i.id, i])) as Record<ItemId, ItemInfo>;
export const ITEM_IDS = ITEMS.map((i) => i.id);
