# Ensidan sekirite — modpas `cli_login_postgres` ekspoze pa `supabase db dump --dry-run`

**Dat** : 2026-08-14
**Severite** : Rezoud, aksyon imedyat pran — okenn prèv itilizasyon pa yon twazyèm pati.

---

## Sa ki rive

Pandan travay Faz 2, kòmand `supabase db dump --dry-run` te enprime **modpas an klè** wòl `cli_login_postgres` a nan sòti tèminal la. Kòmand lan itilize `pg_dump` anba tè, e pou `--dry-run` montre kòmand egzat li pral egzekite a, li ekspoze varyab anviwònman `PGPASSWORD` (ant lòt: `PGHOST`, `PGPORT`, `PGUSER=cli_login_postgres`, `PGDATABASE`) dirèkteman nan sòti a.

## Portée

`cli_login_postgres` se yon **wòl manm `postgres`** — sa vle di **aksè nivo admin konplè** sou baz done pwodiksyon an (bypass RLS, li/ekri/altère nenpòt tab/fonksyon/schema).

## Fenèt ekspozisyon

`rolvaliduntil` wòl la te configire a `2026-08-14 07:36:08 UTC` — anviwon **3è** apre ekspozisyon an, modpas la ta ekspire otomatikman menmsi okenn aksyon pa t pran.

## Aksyon imedyat

`ALTER ROLE cli_login_postgres NOLOGIN;` — egzekite imedyatman apre dekouvèt la, retire kapasite koneksyon wòl la nèt, san atann fenèt `rolvaliduntil` la ekspire natirèlman.

## Verifikasyon

- `rolcanlogin = false` konfime sou wòl la apre chanjman an.
- `pg_stat_activity` verifye : **0 rows** — okenn sesyon aktif ki itilize wòl sa a nan moman verifikasyon an.

## Konklizyon

**Pa gen okenn prèv itilizasyon pa yon twazyèm pati.** Fenèt ekspozisyon an te kout (~3è), wòl la fèmen (`NOLOGIN`) anvan fenèt la menm te ekspire, e `pg_stat_activity` pa montre okenn koneksyon aktif ki ta ka soti nan yon itilizasyon.

**Modpas la pa janm repete okenn kote nan dokiman sa a, ni nan okenn lòt dokiman/kòd/kòmantè pwodwi pandan finalizasyon Faz 2 a.**

---

## Netwayaj lokal — rezilta

Rechèch **makè** (non varyab, pa valè) sou tout repo a (`--exclude-dir=node_modules --exclude-dir=.git`) :

```
grep -rl "cli_login_postgres\|PGPASSWORD" . --exclude-dir=node_modules --exclude-dir=.git
```

**Rezilta : JWENN** — 1 fichye : `docs/BACKUP_EMPTY_DUMP_ROOT_CAUSE_REPORT.md:61`.

Kontni egzat liy lan :

> `--dry-run` confirme que la commande sous-jacente est un `pg_dump --schema-only --quote-all-identifier --role postgres --schema=public|private`, exécuté avec `PGHOST`/`PGPORT`/`PGUSER=cli_login_postgres`/`PGPASSWORD`/`PGDATABASE` en variables d'environnement (**`PGPASSWORD` redacté avant tout affichage, jamais imprimé ni copié**). Rien d'anormal dans la commande elle-même.

**Analiz** : dokiman sa a se yon rapò envestigasyon **anvan** ki sanble kouvri menm ensidan/menm zòn nan (menm kòmand `--dry-run`, menm mekanis `PGPASSWORD`). Li mansyone **non varyab yo sèlman** (`PGUSER=cli_login_postgres`, `PGPASSWORD` kòm non varyab) — pwòp tèks li deklare eksplisitteman valè a te redakte anvan afichaj, **okenn valè reyèl pa parèt nan fichye sa a**. Sa satisfè kritè "makè, pa valè" — pa mande okenn chanjman.

Rechèch istwa PowerShell (`ConsoleHost_history.txt`) — `grep -n "supabase db dump\|cli_login_postgres\|PGPASSWORD"` :

- Yon antre `supabase db dump` (san flag `--dry-run` vizib nan antre istwa a — istwa PSReadLine kenbe sèlman **kòmand ki tape**, jamè **sòti/rezilta** yo, donk modpas la pa ka parèt la menm si li te ekspoze nan tèminal la lè kòmand lan te kouri).
- Plizyè antre grep ki idantik/sanble ak sa k ap fèt kounye a — sa endike yon envestigasyon/netwayaj similè te deja fèt nan yon sesyon anvan (konsistan ak fèt ke ensidan an te rive "pandan Faz 2", separe de sesyon finalizasyon sa a).
- **Okenn valè `PGPASSWORD` pa parèt nan istwa a** — istwa a kenbe sèlman non kòmand yo, pa sòti yo.

**Detay san rapò dirèk ak ensidan sa a, site pou transparans total** : menm rechèch la jwenn yon antre istwa PowerShell ki gen yon modpas an klè (`$env:PGPASSWORD="Admin2026"`) pou yon **lòt pwojè, san rapò** (`transigo`, yon baz done PostgreSQL **lokal**, pa Supabase, pa NK Deliveri). Sa a **pa fè pati ensidan `cli_login_postgres`/pwodiksyon NK Deliveri a** — pa gen aksyon ki mande nan kad dokiman sa a, site sèlman paske grep la te leve l.

**Konklizyon netwayaj** : **PA JWENN** okenn valè reyèl modpas `cli_login_postgres` a, ni nan kòd/dokimantasyon repo a, ni nan istwa Bash (`~/.bash_history`, pa gen match), ni nan istwa PowerShell (`ConsoleHost_history.txt`, pa gen match pou valè, sèlman non kòmand).

---

## Règ ki soti nan ensidan sa a — aplike imedyatman

**Okenn kòmand Supabase CLI ki louvri yon koneksyon dirèk sou baz done a** (`db dump`, `db diff`, `db push`, `inspect`, elatriye) pandan rès sesyon sa a ak sesyon k ap vini yo jiskaske règ sa a eksplisitteman leve. Tout lekti/tès DB pase pa SQL Editor (ekivalan Management API `database/query`), rezilta prezante epi **mande otorizasyon anvan egzekisyon**, pa egzekite otonòm.

**Konsekans konkrè pou Faz 2/finalizasyon** : migrasyon NKD-006 (`20260814150000_nkd006_push_endpoint_allowlist.sql`) ekri e pare, tès `BEGIN...ROLLBACK` li ekri (`docs/NKD006_CHECK_CONSTRAINT_TEST.sql`) — **okenn nan yo pa egzekite**, tou de ap tann otorizasyon eksplisit.

---

## Nòt pou Faz 7 (backlog)

CLI Supabase kreye yon wòl manm `postgres` (`cli_login_postgres`) epi enprime modpas li an klè nan sòti kòmand `--dry-run` (ak posiblman lòt kòmand ki sèvi ak menm mekanis `pg_dump`/`PGPASSWORD` anba tè a). **Sa se yon risk pwosesis/zouti CLI Supabase limenm, pa yon bug nan kòd NK Deliveri a.**

**Rekòmandasyon** : entèdi itilizasyon Supabase CLI (oswa omwen tout sou-kòmand ki fè yon koneksyon dirèk — `db dump`, `db diff`, `inspect`) pandan **tout sesyon odit sekirite** — SQL Editor/Management API HTTP la pa gen menm risk sa a (pa gen `pg_dump`/`PGPASSWORD` anba tè, otantifikasyon pa yon Bearer token, pa yon modpas wòl Postgres).
