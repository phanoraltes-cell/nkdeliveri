import { useEffect, useState, useCallback } from "react";

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

function read(): CartItem[] {
  if (typeof window === "undefined") return [];
  try {
    return JSON.parse(localStorage.getItem(KEY) || "[]");
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
