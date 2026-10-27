import { useState } from "react";
import type { ClientMessage, ItemId, RoomView } from "../../shared/protocol";
import { ITEMS } from "../../shared/items";
import Icon, { ITEM_ICON } from "../components/Icon";
import { Avatar, Sheet } from "../components/ui";

// Items that wait for your next ping can't be stacked.
const ONE_SHOT: ItemId[] = ["ghost", "jammer", "decoy"];

export default function Shop({ view, send, onClose }: { view: RoomView; send: (m: ClientMessage) => void; onClose: () => void }) {
  const shop = view.settings.shop;
  const me = view.me;
  const role = me.role;
  const coins = Math.floor(me.coins);
  const [reviving, setReviving] = useState(false);
  const caught = view.players.filter((p) => p.tagged && !(p.role === "hider" && p.status === "alive"));
  const items = ITEMS.filter((i) => i.team === role && shop.items[i.id].enabled && (role === "hider" || shop.seekerEconomy));
  const active = new Set(me.effects.map((e) => e.item));

  const buy = (id: ItemId, targetId?: string) => {
    send({ type: "buy", item: id, targetId });
    onClose();
  };

  if (reviving) {
    return (
      <Sheet title="Revive who?" onClose={onClose}>
        {caught.length === 0 && <p className="hint">Nobody's been caught yet.</p>}
        {caught.map((p) => (
          <button key={p.id} className="btn btn--block" style={{ justifyContent: "flex-start" }} onClick={() => buy("revive", p.id)}>
            <Avatar name={p.name} isBot={p.isBot} />
            {p.name}
          </button>
        ))}
        <button className="btn btn--ghost" onClick={() => setReviving(false)}>
          Back to the shop
        </button>
      </Sheet>
    );
  }

  return (
    <Sheet title="Power-ups" onClose={onClose}>
      <div className="wallet">
        <b>
          <Icon name="coin" size={26} />
          {coins}
        </b>
        <small>{role === "hider" ? "Earn coins by standing in safe zones" : `Earn ${shop.coinsPerTag} coins for every tag`}</small>
      </div>
      <div className="shop-list">
        {items.map((info) => {
          const cfg = shop.items[info.id];
          const used = me.uses[info.id] ?? 0;
          const soldOut = cfg.limit > 0 && used >= cfg.limit;
          const pending = ONE_SHOT.includes(info.id) && active.has(info.id);
          const noTarget = info.id === "revive" && caught.length === 0;
          const blocked = soldOut || pending || noTarget || coins < cfg.price;
          return (
            <button
              key={info.id}
              className={`shop-item ${active.has(info.id) ? "shop-item--active" : ""}`}
              disabled={blocked}
              onClick={() => (info.id === "revive" ? setReviving(true) : buy(info.id))}
            >
              <span className={`item-icon ${info.team === "seeker" ? "item-icon--seeker" : ""}`}>
                <Icon name={ITEM_ICON[info.id]} size={22} />
              </span>
              <span>
                <b>{info.name}</b>
                <p>{info.description}</p>
                <small>
                  {pending
                    ? "Ready for your next ping"
                    : soldOut
                      ? "All used up"
                      : noTarget
                        ? "Nobody to revive yet"
                        : cfg.limit > 0
                          ? `${cfg.limit - used} left`
                          : "Unlimited"}
                </small>
              </span>
              <span className="price">
                <Icon name="coin" size={14} />
                {cfg.price}
              </span>
            </button>
          );
        })}
        {items.length === 0 && <p className="hint">The host turned off every item for your team.</p>}
      </div>
    </Sheet>
  );
}
