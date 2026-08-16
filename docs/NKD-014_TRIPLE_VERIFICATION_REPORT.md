# Verifikasyon 3 pwen anvan Faz 9

**Dat** : 2026-08-16
**Règ A9 aplike** : chak rezilta anba a gen kòd retou/kontni reyèl kole, pa yon prediksyon.

---

## PWEN 1 — Rotasyon kle publishable

**1. Lokal** : `grep "sb_publishable_-n1MHTf6ad5AH8l" .env.local` → **jwenn**, `.env.local:28` (`.env` limenm pa egziste). Ansyen kle a **toujou konfigire lokalman**.

**2. Tès kont API a** (kòmand egzat pwomt la mande, egzekite) :
```
curl -s -o /dev/null -w "%{http_code}" "https://dcsnmvbtsmdbwrwbutph.supabase.co/rest/v1/" \
  -H "apikey: sb_publishable_-n1MHTf6ad5AH8l_F5I3mg_NbyKX9CC"
```
**Rezilta : `401`**, kò repons : `{"message":"Unregistered API key","hint":"Double check the provided API key as it is not registered for this project."}`

**Deklarasyon : `ROTASYON FÈT`** — kòd HTTP 401 + mesaj "Unregistered API key" se prèv dirèk ansyen kle a **rejte** pa Supabase.

**⚠️ Konsekans dekouvri pandan verifikasyon an (pa mande, men enpòtan)** : `.env.local` lokal la **poko mete ajou** ak nouvo kle a — li toujou gen ansyen kle rejte a. Sa vle di **devlopman lokal sou machin sa a ap echwe kounye a** (nenpòt sesyon `npm run dev` ta rele Supabase ak yon kle ki deja rejte). Pa yon echèk rotasyon — se yon konsekans nòmal li ki poko trete lokalman.

---

## PWEN 2 — RLS live (rekèt ekri, PA egzekite)

Dapre Règ A1, rekèt sa a **ekri sèlman** — mande w kouri l nan SQL Editor epi kole rezilta a :

```sql
SELECT tablename, rowsecurity FROM pg_tables
WHERE schemaname = 'public' AND rowsecurity = false ORDER BY tablename;
```

**Estati : PA FÈT** — ap tann rezilta ou. Rapò Faz 3 **pa mete ajou** (li rete `ESTIMASYON` jiskaske mwen gen yon vrè rezilta pou koله).

---

## PWEN 3 — Envantè dosye konfigirasyon zouti (NKD-014)

**1. `ls -la` rasin lan** : sèlman `.claude/` egziste. `.vscode/`, `.cursor/`, `.idea/` **pa egziste**.

**2. `git ls-files | grep -E "^\.(claude|vscode|cursor|idea)/"`** → **0 rezilta** — okenn fichye anba 4 dosye sa yo swiv nan git kounye a.

**3. Klasifikasyon**

| Fichye | Kontni | Klasifikasyon |
|---|---|---|
| `.claude/settings.json` | **Konfime gen sekrè** — 495 liy, allowlist kòmand akimile ki gen **ansyen kle publishable la kole dirèkteman** nan plizyè liy `curl ... -H 'apikey: sb_publishable_-n1MHTf6ad5AH8l...'` (menm kle Pwen 1 la — **sa a se pwobableman menm rezon ki te fè rotasyon an nesesè**), plis lòt patwon `sk_secret`/`token`/`password` nan kòmand grep/sed itilize pandan sesyon sa a. | **DEJA JERE** — `.gitignore:56` egzat sou `.claude/settings.json`, konfime aktif (pa nan `git ls-files`). |
| `.claude/settings.local.json` | 25 liy, sèlman yon lis `permissions.allow` (kòmand Bash/Read ki apwouve pandan sesyon yo). **0 mak sekrè** (`apikey`/`token`/`secret`/`password` → 0 match). | **PWOP** nan kontni, **men PA "DEJA JERE"** — pa gen okenn liy pou li nan `.gitignore` **pwojè a**. Sèl rezon li pa parèt nan `git status` se yon `**/.claude/settings.local.json` nan gitignore **global/pèsonèl** machin sa a (`C:\Users\DALPHE/.config/git/ignore`) — sa pwoteje **sèlman machin sa a**, pa okenn lòt devlopè k ap klone repo a. **Finding, pa korije** (dapre enstriksyon "pa korije anyen") : ajoute `.claude/settings.local.json` nan `.gitignore` pwojè a ta fèmen gap sa a pou tout moun, menm jan `settings.json` deja fèt. |
| `.vscode/*` (règ egziste, dosye a pa la) | n/a | **DEJA JERE, pwoaktif** — `.gitignore:35-36` deja pare (`.vscode/*` ekli, eksepte `extensions.json`) si dosye a ta janm kreye. |
| `.idea` (règ egziste, dosye a pa la) | n/a | **DEJA JERE, pwoaktif** — `.gitignore:37`. |
| `.cursor/` | n/a — pa egziste, **pa gen okenn règ `.gitignore` pou li non plis** | **Pa aplikab kounye a** — si yon devlopè te janm kreye l, li pa ta pwoteje otomatikman (pa gen `.cursor` nan `.gitignore`). Mansyone pou konplete, pa yon risk aktyèl (dosye a pa egziste).

---

## Estati final

| Pwen | Estati |
|---|---|
| 1 — Rotasyon kle publishable | **KONFIME FÈT** (HTTP 401, prèv kole) |
| 2 — RLS live | **PA FÈT** — rekèt ekri, ap tann ou kouri l nan SQL Editor |
| 3 — NKD-014 (envantè zouti) | **KONFIME FÈT** (envantè + klasifikasyon konplè) — 1 gap jwenn (`settings.local.json` pa nan `.gitignore` pwojè a), **pa korije**, dapre enstriksyon |

**2 sou 3 konfime fèt ak prèv. 1 (RLS) ap tann ou.**
