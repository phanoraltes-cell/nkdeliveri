# HANDOFF SQL — PAS 9

Tout blòk anba a se **LEKTI SÈLMAN** (`SELECT`). Okenn ekri, okenn migrasyon egzekite pa mwen menм — konfòm ak BLÒK 3-bis. Kole soti chak requèt la tounen ban mwen pou m ka chanje estati finding ki depann de yo a soti `NOT VERIFIED` a `CONFIRMED`/`LIKELY`.

---

### Q-1 — Estati 8 migrasyon eritye + 2 migrasyon PAS 9 sou baz done a

**Kalite:** LEKTI SÈLMAN (SELECT) &nbsp;|&nbsp; **Danje:** okenn
**Kote pou kouri:** Supabase Dashboard → SQL Editor → New query

```sql
select version, name
from supabase_migrations.schema_migrations
where version >= '20260818000000'
order by version;
```

**Sa m ap fè ak rezilta a:** Konpare lis vèsyon ki retounen a kont 10 fichye lokal ki gen dat ≥ `20260818140000` (8 eritye + 2 PAS 9 pa mwen yo: `20260827130000`, `20260827140000`). Sa detèmine `OPS-004`: si 8 fichye eritye yo la, yo aplike sou prod (pa touche yo, ajiste CI a olye). Si yo absan, yo ka korije menm jan ak pa mwen yo.
**Kole soti a ban mwen anvan mwen kontinye.**

---

### Q-2 — Konte total pou detekte drift

**Kalite:** LEKTI SÈLMAN (SELECT) &nbsp;|&nbsp; **Danje:** okenn
**Kote pou kouri:** Supabase Dashboard → SQL Editor → New query

```sql
select count(*) as total_migrations_applied
from supabase_migrations.schema_migrations;
```

**Sa m ap fè ak rezilta a:** Konpare ak `git ls-files supabase/migrations/*.sql | wc -l` (151 fichye nan repo a jodi a, anvan PAS 9; 153 apre 2 nouvo migrasyon PAS 9 yo). Yon diferans ki pa 0 (soustraksyon 153 - total_migrations_applied) vle di gen migrasyon ki nan repo a men PA aplike — oswa lekontrè, yon siy `drift` pi grav pase sa nou prevwa.
**Kole soti a ban mwen anvan mwen kontinye.**

---

### Q-3 — DB-001: konfime GRANT SELECT sou platform_payout_settings retire

**Kalite:** LEKTI SÈLMAN (SELECT) &nbsp;|&nbsp; **Danje:** okenn
**Kote pou kouri:** Supabase Dashboard → SQL Editor → New query

```sql
select grantee, privilege_type
from information_schema.role_table_grants
where table_schema = 'public'
  and table_name = 'platform_payout_settings'
  and grantee in ('authenticated', 'anon', 'PUBLIC');
```

**Sa m ap fè ak rezilta a:** Si migrasyon `20260827130000` aplike, `authenticated` pa dwe parèt nan rezilta a pou `SELECT` ankò. Yon liy `authenticated | SELECT` ki toujou la vle di migrasyon an poko aplike.
**Kole soti a ban mwen anvan mwen kontinye.**

---

### Q-4 — FIN-001: konfime tab/fonksyon rekonsilyasyon wallet egziste

**Kalite:** LEKTI SÈLMAN (SELECT) &nbsp;|&nbsp; **Danje:** okenn
**Kote pou kouri:** Supabase Dashboard → SQL Editor → New query

```sql
select
  (select count(*) from information_schema.tables
     where table_schema = 'public' and table_name = 'wallet_discrepancies') as table_exists,
  (select count(*) from information_schema.routines
     where routine_schema = 'public' and routine_name = 'check_wallet_reconciliation_secure') as check_fn_exists,
  (select count(*) from information_schema.routines
     where routine_schema = 'public' and routine_name = 'run_wallet_reconciliation_secure') as run_fn_exists;
```

**Sa m ap fè ak rezilta a:** 3 valè yo dwe egal `1` chak si migrasyon `20260827130000` aplike; `0` vle di migrasyon an poko rive sou baz done a.
**Kole soti a ban mwen anvan mwen kontinye.**

---

### Q-5 — API-001: konfime 2 nouvo bucket ads-media yo egziste ak bon limit

**Kalite:** LEKTI SÈLMAN (SELECT) &nbsp;|&nbsp; **Danje:** okenn
**Kote pou kouri:** Supabase Dashboard → SQL Editor → New query

```sql
select id, public, file_size_limit, allowed_mime_types
from storage.buckets
where id in ('ads-media-images', 'ads-media-videos', 'ads-media');
```

**Sa m ap fè ak rezilta a:** Konfime `ads-media-images` (5MB) ak `ads-media-videos` (50MB) egziste si migrasyon `20260827140000` aplike, e konfime `ads-media` (eritye) toujou la san chanjman (li pa t dwe touche).
**Kole soti a ban mwen anvan mwen kontinye.**

---

## Rezime pou moun k ap egzekite yo

| #   | Objektif                              | Finding ki depann de li     |
| --- | ------------------------------------- | --------------------------- |
| Q-1 | Lis vèsyon migrasyon ≥ 20260818000000 | OPS-004 (+ konfime pa m yo) |
| Q-2 | Konte total migrasyon aplike          | OPS-004 (detekte drift)     |
| Q-3 | GRANT sou platform_payout_settings    | DB-001                      |
| Q-4 | Tab/fonksyon rekonsilyasyon wallet    | FIN-001                     |
| Q-5 | Bucket ads-media-images/videos        | API-001                     |

Ou ka egzekite tout 5 yo nan yon sèl sesyon SQL Editor youn apre lòt — chak se yon `SELECT` san danje, san efè segondè.
