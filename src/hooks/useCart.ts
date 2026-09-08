import { useEffect, useState, useCallback } from "react";
import { isValidAmount, reportInvalidAmount } from "@/lib/money";

export type CartItem = {
  productId: string;
  restaurantId: string;
  restaurantName: string;
  name: string;
  price: number;
  imageUrl?: string | null;
  qty: number;
  // Customer-entered per-item note (e.g. "no onions") — sent as-is to
  // create_order_secure's per-item `notes`, which already accepts it; this
  // is the only piece of the cart model that maps 1:1 to an order_items
  // column rather than being order-wide like delivery notes.
  notes?: string;
};

const KEY = "nk-cart-v1";
const EVT = "nk-cart-changed";

/**
 * Yon ranje panye nou ka fè konfyans pou kalkile yon total.
 *
 * `JSON.parse` retounen `any`: sa ki soti nan `localStorage` pa gen okenn
 * garanti kalite, menm si `CartItem` di `price: number`. Yon `price` ki
 * vin yon string (yon ansyen vèsyon panye a), ki manke, oswa ki modifye
 * alamen nan DevTools bay `qty * price = NaN` — epi NaN sa a monte
 * dirèkteman nan sou-total la, nan total la, epi nan desizyon « èske
 * wallet la ase ». Se menm fanmi bug ak `Number(undefined)` nan
 * useDeliveryFee.
 *
 * Nou VERIFYE olye nou kwè. Yon ranje ki pa valab retire nan panye a olye
 * li kraze total la: kliyan an wè plat li yo ak yon total ki gen sans, epi
 * nou resevwa yon alèt Sentry ak sous pwoblèm nan.
 */
function isUsableCartItem(row: unknown): row is CartItem {
  if (typeof row !== "object" || row === null) return false;
  const item = row as Record<string, unknown>;
  return (
    typeof item.productId === "string" &&
    typeof item.restaurantId === "string" &&
    isValidAmount(item.price) &&
    item.price >= 0 &&
    isValidAmount(item.qty) &&
    Number.isInteger(item.qty) &&
    item.qty > 0
  );
}

function read(): CartItem[] {
  if (typeof window === "undefined") return [];
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(KEY) || "[]");
    if (!Array.isArray(parsed)) return [];
    const usable = parsed.filter(isUsableCartItem);
    if (usable.length !== parsed.length) {
      reportInvalidAmount("useCart:localStorage", `${parsed.length - usable.length} ranje jete`);
    }
    return usable;
  } catch {
    return [];
  }
}

function write(items: CartItem[]) {
  localStorage.setItem(KEY, JSON.stringify(items));
  window.dispatchEvent(new CustomEvent(EVT));
}

export function useCart() {
  const [items, setItems] = useState<CartItem[]>([]);

  useEffect(() => {
    setItems(read());
    const h = () => setItems(read());
    window.addEventListener(EVT, h);
    window.addEventListener("storage", h);
    return () => {
      window.removeEventListener(EVT, h);
      window.removeEventListener("storage", h);
    };
  }, []);

  const add = useCallback((item: Omit<CartItem, "qty">) => {
    const cur = read();
    // If new restaurant, replace cart
    if (cur.length > 0 && cur[0].restaurantId !== item.restaurantId) {
      write([{ ...item, qty: 1 }]);
      return "replaced";
    }
    const idx = cur.findIndex((x) => x.productId === item.productId);
    if (idx >= 0) cur[idx].qty += 1;
    else cur.push({ ...item, qty: 1 });
    write(cur);
    return "added";
  }, []);

  const setQty = useCallback((productId: string, qty: number) => {
    const cur = read()
      .map((x) => (x.productId === productId ? { ...x, qty } : x))
      .filter((x) => x.qty > 0);
    write(cur);
  }, []);

  const setItemNotes = useCallback((productId: string, notes: string) => {
    const cur = read().map((x) => (x.productId === productId ? { ...x, notes } : x));
    write(cur);
  }, []);

  const remove = useCallback((productId: string) => {
    write(read().filter((x) => x.productId !== productId));
  }, []);

  const clear = useCallback(() => write([]), []);

  const count = items.reduce((s, i) => s + i.qty, 0);
  const subtotal = items.reduce((s, i) => s + i.qty * i.price, 0);

  return { items, add, setQty, setItemNotes, remove, clear, count, subtotal };
}
