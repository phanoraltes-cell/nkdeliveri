# Audit — Echèk voye imèl newsletter (admin dashboard)

**Dat**: 2026-08-09
**Statut**: Odit sèlman — okenn kòd/migrasyon poko modifye, poko aplike, poko komite.
**Peryimèt**: `src/lib/send-newsletter.functions.ts`, `src/routes/_authenticated/dashboard.admin.customers.tsx` (seksyon "Voye imèl an mas"), migrasyon `check_rate_limit_secure`, konfigirasyon DNS/Resend pou `nkdeliveri.com`.

---

## 1. Rezime egzekitif

Fonksyonalite "Voye imèl an mas bay abone yo" nan `/dashboard/admin/customers` rele Resend (`api.resend.com/emails`) **yon fwa pou chak abone**, san throttling, san retry, san okenn log detaye lè yon anvwa echwe. Rezilta: kèlkeswa kòz reyèl la (limit vitès Resend, timeout Vercel, limit entèn 3/èdtan, oswa yon kle API envalid), admin nan wè menm bagay la — yon mesaj echèk vag, san detay ki ta ka mennen nou dirèkteman nan kòz la.

**Rezilta prensipal**: konfigirasyon DNS/domèn Resend pou `nkdeliveri.com` VERIFYE kòrèk (SPF + DKIM + MX prezan e byen fòme) — sa **elimine** yon ipotèz komen (domèn pa verifye). Kle a (`RESEND_API_KEY`) konfime prezan sou Vercel Production. Men kontni/validite reyèl kle a **pa ka verifye a distans** (menm limitasyon "Sensitive env var" nou te jwenn pandan ensidan Stripe la — `vercel env pull` retounen yon valè vid pou tout varyab "Sensitive", kèlkeswa vrè kontni yo).

**Konklizyon**: gen omwen **3 pwoblèm achitekti reyèl, verifye dirèkteman nan kòd la** (pa sipoze) ki ka — ansanm oswa apa — pwodwi egzakteman senp sa admin la rapòte. Yo dekri an detay anba a, chak ak prèv, ranje pa gravite/pwobabilite.

---

## 2. Achitekti aktyèl (jan li ekziste jodi a)

```
dashboard.admin.customers.tsx
  └─ useMutation → sendNewsletterBroadcast (server fn, POST)
       ├─ verifye admin/super_admin (has_role) — OK, menm patwon ke lòt admin RPC
       ├─ check_rate_limit_secure("send_newsletter", 3, 3600) — 3 tantativ/èdtan
       ├─ li RESEND_API_KEY nan process.env
       ├─ li tout newsletter_subscribers kote unsubscribed_at IS NULL
       └─ pou chak gwoup 10 abone (BATCH_SIZE=10):
            Promise.allSettled([ fetch api.resend.com/emails pou CHAK abone ])
            → si echèk (nenpòt kalite): failed++, AUKENN detay konsève
```

## 3. Sa ki KONFIME kòrèk (pa kòz la)

| Verifikasyon                                                    | Rezilta                                                         | Prèv                                                  |
| --------------------------------------------------------------- | --------------------------------------------------------------- | ----------------------------------------------------- |
| SPF sou `send.nkdeliveri.com`                                   | ✅ `v=spf1 include:amazonses.com ~all`                          | `nslookup -type=TXT send.nkdeliveri.com`              |
| MX sou `send.nkdeliveri.com`                                    | ✅ `feedback-smtp.us-east-1.amazonses.com`                      | `nslookup -type=MX send.nkdeliveri.com`               |
| DKIM `resend._domainkey.nkdeliveri.com`                         | ✅ kle piblik prezan                                            | `nslookup -type=TXT resend._domainkey.nkdeliveri.com` |
| DMARC `_dmarc.nkdeliveri.com`                                   | ✅ prezan (`p=none`, pèmisiv men prezan)                        | `nslookup -type=TXT _dmarc.nkdeliveri.com`            |
| `RESEND_API_KEY` egziste sou Vercel Production                  | ✅ konfime                                                      | `vercel env ls production`                            |
| Middleware otantifikasyon (`requireSupabaseAuth`) ak `has_role` | ✅ menm patwon jenerik itilize ak siksè pa plizyè lòt RPC admin | Lekti kòd + istwa pwojè a                             |
| `check_rate_limit_secure` siyati/grant                          | ✅ koresponn ak apèl la (`_action, _max_hits, _window_seconds`) | `20260713121500_rate_limiting.sql`                    |

→ **Konfigirasyon domèn Resend pa pwoblèm nan.** Kle a prezan. Bloke chemen "domèn pa verifye" ak "kle manke" antyèman.

## 4. Kòz posib yo — ranje pa gravite/pwobabilite

### 🔴 A. Okenn vizibilite sou echèk yo — bloke tout dyagnostik reyèl

**Kote**: [send-newsletter.functions.ts:71-74](../src/lib/send-newsletter.functions.ts#L71-L74)

```ts
for (const r of results) {
  if (r.status === "fulfilled" && r.value.ok) sent++;
  else failed++;
}
```

Nenpòt rezon echèk (erè rezo, 429 Resend, 401 kle envalid, 500 Resend, email envalid...) tonbe nan menm `failed++` la — **san `console.error`, san stoke kòd/mesaj erè Resend lan okenn kote**. Rezilta: admin nan wè "Echwe: N" san okenn lòt enfòmasyon, e menm nou menm (ekip teknik) pa gen okenn mwayen konnen POUKISA san ajoute enstrimantasyon dabò. **Sa a se rezon ki blòke odit sa a soti nan teyori pou rive nan yon prèv definitif.**

### 🟠 B. Rate limit Resend (10 rekèt/segonn pa ekip) ka depase fasil

BATCH_SIZE=10 anvwaye an **paralèl** (`Promise.allSettled`) san okenn poz ant gwoup. Dapre dokimantasyon ofisyèl Resend, limit default se **10 rekèt/segonn pou tout ekip la** — 10 rekèt similtane deja nan bòday limit la; nenpòt lòt aktivite Resend anba menm kont lan (oswa yon 2yèm gwoup ki swiv twò vit) ka lakòz repons `429`. Kòd la pa gen okenn retry ni backoff sou `retry-after`/`ratelimit-remaining` — yon 429 tonbe dirèkteman nan `failed++` pou tout tan.

- Sous: [Resend — Rate Limit](https://resend.com/docs/api-reference/rate-limit)

### 🟠 C. Risk timeout fonksyon serverless pou lis abone ki gwo

Okenn `maxDuration` konfigire pou wout sa a nan `vercel.json` → default platfòm nan aplike (souvan kout, ~10s sou Hobby plan). Boukl la trete gwoup yo **youn apre lòt** (`for` + `await` — pa an paralèl ant gwoup), chak gwoup mande yon vwayaj rezo reyèl (~100-500ms tipikman). Pou yon lis 50-100+ abone, tan total ekzekisyon an ka fasil depase limit fonksyon an → **tout apèl la echwe/timeout san admin lan janm konnen konbyen imèl te reyèlman soti deja** (paske Resend te ka deja voye kèk anvan timeout la rive), e yon nouvo tantativ ta re-voye bay TOUT moun ankò (pa gen okenn mekanis pou eksklu moun ki deja resevwa l nan yon tantativ ki echwe).

### 🟡 D. Limit entèn 3 tantativ/èdtan ka konfonn ak yon "echèk"

[send-newsletter.functions.ts:26-32](../src/lib/send-newsletter.functions.ts#L26-L32) — apre 3 klik sou "Voye" nan menm èdtan an (nòmal pandan yon tès/debogaj), 4yèm tantativ la resevwa yon erè `Twòp anvwa nan yon ti tan` ki parèt tankou yon lòt "echèk" pou admin lan, pandan se pwòp tès li yo ki lakòz sa. Mesaj la egziste men ka fasil pase inapèsi/konfonn ak yon vrè echèk teknik.

### 🟡 E. Move endpoint Resend pou travay sa a

Kòz achitekti dèyè B ak C: Resend gen yon **`POST /emails/batch`** ki fèt espesyalman pou egzakteman ka sa a — jiska 100 imèl pèsonalize nan **YON SÈL** apèl HTTP. Kòd aktyèl la refè envante fanout sa a manyèlman ak N apèl separe, san okenn nan pwoteksyon vitès Resend deja bati nan chemen batch la.

- Sous: [Resend — Batch emails](https://resend.com/docs/api-reference/emails/send-batch-emails)

### ⚪ F. Kontni/validite `RESEND_API_KEY` pa verifyab a distans

Menm limitasyon ke nou te dekouvri pandan ensidan Stripe la (`mk_` olye `sk_`): Vercel make varyab sa a "Sensitive", kidonk `vercel env pull` toujou retounen yon valè vid — **pa yon prèv kle a envalid, jis yon zòn avèg**. Pa ka ni konfime ni elimine san kaptire vrè erè Resend lan (Pwen A pi wo a) oswa san yon tès reyèl.

---

## 5. Plan Remedyasyon (pwopozisyon — pa gen anyen aplike)

| Faz          | Aksyon                                                                                                                                                                           | Objektif                                                                            |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| **1 — Dabò** | Ajoute log detaye pou chak echèk anvwa (nouvo tab `newsletter_send_log`, menm patwon ak `plop_api_logs`/`stripe_api_logs`, oswa minimòm `console.error` ak kòd/mesaj Resend lan) | Rann pwoblèm nan **dyagnostikab pou vre** — san sa, tout lòt faz yo se espekilasyon |
| **2**        | Ranplase fanout N-apèl la ak `POST /emails/batch` (jiska 100 abone pa apèl)                                                                                                      | Elimine risk rate-limit (B) ak diminye risk timeout (C) nan menm kou a              |
| **3**        | Ajoute retry ak backoff ki respekte header `retry-after`/`ratelimit-*` pou nenpòt echèk ki rete                                                                                  | Rekipere otomatikman apre yon blokaj tanporè                                        |
| **4**        | Fè mesaj limit 3/èdtan an pi klè/distenk nan UI a (pa menm koulè/mesaj ak yon echèk teknik reyèl)                                                                                | Anpeche konfizyon ant "ou fè twòp tès" ak "gen yon bug"                             |
| **5**        | Fikse `maxDuration` eksplisit pou wout sa a (oswa deplase l nan yon travay background/cron pou gwo lis)                                                                          | Anpeche yon apèl konplè echwe akoz timeout platfòm                                  |
| **6**        | Yon fwa Faz 1 aplike: fè YON tès reyèl, li log yo, konfime (oswa elimine) si `RESEND_API_KEY` li menm envalid                                                                    | Sèl fason pou fèmen pwen F definitivman                                             |

**Rekòmandasyon**: kòmanse ak **Faz 1 + Faz 2 ansanm** (yo touche menm fichye a, `send-newsletter.functions.ts`, e Faz 2 pral bezwen menm jan an detay erè Faz 1 ajoute pou verifye l travay). Sa ta rezoud B, C, ak F (dènye a atravè log yo) nan yon sèl chantye, e redwi risk ki rete yo (D, E) nan pwochen chantye.

## 6. Sa mwen PA fè nan mesaj sa a

Dapre konvansyon pwojè a (odite dabò, pwopoze, tann apwobasyon eksplisit anvan aplike/komite), **okenn kòd, migrasyon, oswa deplwaman pa t modifye**. Ap tann konfimasyon sou ki faz(yo) pou kòmanse.
