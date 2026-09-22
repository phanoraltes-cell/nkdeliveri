# Verifikasyon 3 pwen anvan Faz 9

**Dat** : 2026-08-16
**Règ A9 aplike** : chak rezilta anba a gen kòd retou/kontni reyèl kole, pa yon prediksyon.

---

## PWEN 1 — Rotasyon kle publishable

**Re-verifye 2026-08-16, apre premye pas la** — `.env.local` chanje ant 2 verifikasyon yo, refè tès yo nèt sou **menm endpoint** (`/rest/v1/restaurants?select=id&limit=1`, pa endpoint rasin nan ki gen yon konpòtman apa) pou yon konparezon egal-ego :

| Kle                                                      | Kòd HTTP | Kò repons                                                               |
| -------------------------------------------------------- | -------- | ----------------------------------------------------------------------- |
| Ansyen (`sb_publishable_-n1MHTf6ad5AH8l...`)             | **401**  | `{"message":"Unregistered API key",...}`                                |
| Nouvo (`sb_publishable_tzuK0mbZlG-HzyRnd9jYMA_Xd2HzhWQ`) | **200**  | `[{"id":"7b57fe3d-ee9c-4d53-82a1-e989d3102a7b"}]` — done reyèl retounen |

(Premye pas la te teste ansyen kle a sèlman kont `/rest/v1/` rasin, ki te bay `401 "Unregistered API key"` — kòrèk. Nouvo kle a, teste kont menm rasin nan, te bay `401 "Secret API key required"` — yon mesaj **diferan**, ki reflete yon kirikte endpoint rasin nan pou nouvo fòma kle a, pa yon pwoblèm ak kle a limenm. Tès sou yon vrè tab (anwo a) leve dout la nèt.)

**Deklarasyon : `ROTASYON FÈT`, KONFIME nèt** — ansyen kle a rejte, nouvo kle a fonksyone, tès yo fèt sou menm endpoint pou elimine ambigwite.

**Mizajou** : `.env.local` **deja korije** ant 2 verifikasyon yo — li gen nouvo kle a kounye a (`.env.local:5,28`). Gap lokal ki te siyale nan premye pas la **fèmen**.

---

## PWEN 2 — RLS live — **FÈT, KONFIME**

Rekèt la (ekri dapre Règ A1) mèt pwojè a kouri li menm nan SQL Editor, 2026-08-16, 13:39 (kapti ekran) :

```sql
SELECT tablename, rowsecurity FROM pg_tables
WHERE schemaname = 'public' AND rowsecurity = false ORDER BY tablename;
```

**Rezilta : `Success. No rows returned` (0 rows, 100 max).**

Dapre kritè lekti etabli davans (Faz 3 §2) : **`0 rows` → `51/51 KONFIME`**. Okenn tab piblik pa gen `rowsecurity = false` — RLS aktive san eksepsyon sou tout 51 tab yo, live, pa sèlman istwa migrasyon.

**Rapò Faz 3 mete ajou** (`docs/PHASE3_DATABASE_AUDIT.md` §2 ak §8) — retire `ESTIMASYON`, ranplase ak rezilta a + dat.

---

## PWEN 3 — Envantè dosye konfigirasyon zouti (NKD-014)

**1. `ls -la` rasin lan** : sèlman `.claude/` egziste. `.vscode/`, `.cursor/`, `.idea/` **pa egziste**.

**2. `git ls-files | grep -E "^\.(claude|vscode|cursor|idea)/"`** → **0 rezilta** — okenn fichye anba 4 dosye sa yo swiv nan git kounye a.

**3. Klasifikasyon**

| Fichye                                   | Kontni                                                                                                                                                                                                                                                                                                                                                                        | Klasifikasyon                                                                                                                                                                                                                                                                                     |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `.claude/settings.json`                  | **Konfime gen sekrè** — 495 liy, allowlist kòmand akimile ki gen **ansyen kle publishable la kole dirèkteman** nan plizyè liy `curl ... -H 'apikey: sb_publishable_-n1MHTf6ad5AH8l...'` (menm kle Pwen 1 la — **sa a se pwobableman menm rezon ki te fè rotasyon an nesesè**), plis lòt patwon `sk_secret`/`token`/`password` nan kòmand grep/sed itilize pandan sesyon sa a. | **DEJA JERE** — `.gitignore:56` egzat sou `.claude/settings.json`, konfime aktif (pa nan `git ls-files`).                                                                                                                                                                                         |
| `.claude/settings.local.json`            | 25 liy, sèlman yon lis `permissions.allow` (kòmand Bash/Read ki apwouve pandan sesyon yo). **0 mak sekrè** (`apikey`/`token`/`secret`/`password` → 0 match).                                                                                                                                                                                                                  | **PWOP, e kounye a DEJA JERE** — mizajou depi premye pas la : `.gitignore:59` gen yon nouvo règ `.claude/` (kouvri tout dosye a, pa sèlman `settings.json`). `git check-ignore -v` konfime se règ sa a ki pwoteje `settings.local.json` kounye a, pa gitignore pèsonèl la ankò. **Gap la fèmen.** |
| `.vscode/*` (règ egziste, dosye a pa la) | n/a                                                                                                                                                                                                                                                                                                                                                                           | **DEJA JERE, pwoaktif** — `.gitignore:35-36` deja pare (`.vscode/*` ekli, eksepte `extensions.json`) si dosye a ta janm kreye.                                                                                                                                                                    |
| `.idea` (règ egziste, dosye a pa la)     | n/a                                                                                                                                                                                                                                                                                                                                                                           | **DEJA JERE, pwoaktif** — `.gitignore:37`.                                                                                                                                                                                                                                                        |
| `.cursor/`                               | n/a — pa egziste, **pa gen okenn règ `.gitignore` pou li non plis**                                                                                                                                                                                                                                                                                                           | **Pa aplikab kounye a** — si yon devlopè te janm kreye l, li pa ta pwoteje otomatikman (pa gen `.cursor` nan `.gitignore`). Mansyone pou konplete, pa yon risk aktyèl (dosye a pa egziste).                                                                                                       |

---

## Estati final

| Pwen                         | Estati                                                                                                                  |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| 1 — Rotasyon kle publishable | **KONFIME FÈT**, re-verifye ak konparezon egal-ego (ansyen=401, nouvo=200 sou menm endpoint). `.env.local` deja korije. |
| 2 — RLS live                 | **KONFIME FÈT** — 0 rows, 51/51 tab. Rapò Faz 3 mete ajou.                                                              |
| 3 — NKD-014 (envantè zouti)  | **KONFIME FÈT**, re-verifye — gap `settings.local.json` la **deja fèmen** (`.gitignore:59`, nouvo règ `.claude/`)       |

**3 sou 3 KONFIME fèt ak prèv. Tou de gap ki te siyale yo deja fèmen. Okenn nan 3 pwen yo pa rete ouvè.**
