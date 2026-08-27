# PAS 5 — Achitekti kòd + Pèfòmans

**Estati aksè**: analiz statik. Pa gen aksè EXPLAIN ANALYZE oswa metrik pwodiksyon reyèl (Web Vitals, Lighthouse sou live site) — tout evalyasyon "sou echèl" rete teyorik/estriktirèl.

## Achitekti — patwon konsistan (verifye pa PAS 1-4 ansanm ak sa a)

Kòd la swiv yon separasyon klè: **kliyan an rete "fen"** (afiche done, kolekte input, deklanche server function/RPC), **lojik biznis ak kalkil finansye rete nan Postgres** (RPC `SECURITY DEFINER`, triger). Verifye ankò espesifikman pou pas sa a:

- `dashboard.restaurant.revenue.tsx` (paj revni restoran) **AFICHE** `commission_rate`/`commission_amount` ki soti dirèkteman nan yon rezilta sèvè — **pa rekalkile yo**. Rechèch pou lòt kopi lojik kalkil komisyon an (`* rate / 100` elt.) kòm kòd TypeScript: pa jwenn. **0 duplication lojik biznis jwenn ant SQL ak TypeScript.**

## Pèfòmans — Frontend

| Chèk | Rezilta |
|---|---|
| `jspdf` (~500KB) | **0 import statik** nan tout `src/` — toujou `await import()` |
| `leaflet`/`react-leaflet` | Sèl konpozan `LeafletMap.tsx` gen import statik li; tout paran li yo (dashboard admin/driver, tracking livrezon) chaje l atravè `ActiveDeliveriesSection` ki li menм lazy | 
| `recharts` (~350KB, dapre kòmantè kòd) | `RevenueChart` chaje ak `React.lazy()`, kòmantè eksplisit ("recharts (~350KB) is only needed once this page has mounted") |
| `manualChunks` (vite.config.ts) | Vandè lou separe nan pwòp chunk (leaflet, charts, pdf, motion, react, tanstack, supabase) — evite yon "vandè jeyan" inik |
| Chunk >500kB rete apre split (`vendor-pdf` 779kB brut / 235kB gzip) | Prezan, MEN deja dèyè yon `import()` dinamik (route dashboard sèlman) — pa nan chaj inisyal la |

**CONFIRMED**: efò code-splitting entansyonèl e byen dokimante, pa yon aksidan.

## Pèfòmans — Backend/Database

- **Endèks sou relasyon FK ki pi itilize** (`orders.restaurant_id`, `orders.customer_id`, `order_items.order_id`, `payments.order_id`, `wallet_transactions.wallet_id`, `notifications.user_id`): **6/6 gen omwen 1 endèks**, verifye pa rechèch dirèk.
- **N+1 (rechèch pa-ranje nan yon bouk)**: rechèch `.map(async` / `for...await supabase` nan tout `src/routes` ak `src/components` — **0 match**. Konsistan ak patwon ki deja obsève: lekti konplèks (lis admin, revni) fèt via RPC ki deja gen JOIN/agregasyon anndan yo (egzanp `get_customers_admin` verifye PAS 2 — total_orders/total_spent kalkile SÈVÈ-SIDE nan yon sèl requèt).
- Paginasyon: `get_all_users_admin`/`get_customers_admin` gen `_limit`/`_offset` ak klanmpaj (max 500) — **CONFIRMED**, pa yon lis san limit.

## Mò kòd / dèt teknik

- `Kategori/` (dosye rasin dupliye, ~14.5 Mo) — deja rapòte kòm `REC-002` (PAS 0).
- Pa gen lòt gwo blòk kòd mò detekte nan tan ki disponib pou pas sa a.

## Rezime severite PAS 5

- 🔴 0 CRITICAL / 🟠 0 HIGH / 🟡 0 MEDIUM / 🔵 0 LOW nouvo
- Achitekti (separasyon lojik), code-splitting, endèks FK prensipal, ak absans N+1 evidan — **tout CONFIRMED bon**
- Sèl dèt teknik idantifye deja kaptire nan `REC-002` (PAS 0)

## Limit pas sa a (onèt)

- **Pa gen EXPLAIN ANALYZE reyèl** — "endèks egziste" ≠ "requèt la itilize l an pratik sou done a echèl". Mande aksè DB.
- **Pa gen mezi Web Vitals/Lighthouse sou live site** — gwosè chunk yo mezire nan build lokal sèlman.
- Rechèch N+1 la baze sou 2 patwon regex (`.map(async`, `for...await`) — yon N+1 ki pran fòm "yon `useQuery` separe pou chak ranje nan yon lis render" pa ta detekte pa metòd sa a; pa verifye endividyèlman.
- Dependency graph (sikilè) pa analize (ta mande yon zouti dedye tankou `madge`, pa disponib nan sesyon sa a).

---

**Èske mwen kontinye ak PAS 6 (UX/UI + Aksesibilite + SEO)?**
