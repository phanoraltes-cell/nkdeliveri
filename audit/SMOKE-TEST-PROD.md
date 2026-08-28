# Smoke Test Production — apre 7 remediation PAS 1-7

Pou moun nan (pa pou mwen — mwen pa gen sesyon otantifye sou production). Chak liy se yon aksyon konkrè sou **www.nkdeliveri.com** ak yon rezilta atann. Fè yo nan lòd, sou yon kont tès (pa yon vrè kliyan).

```
[ ] 1. Louvri www.nkdeliveri.com nan yon navigatè prive (san cache)
      → Rezilta atann: paj akèy la chaje, Hero ak imaj livrè a parèt san bwat blanch/erè konsòl.
      → Si l echwe: pa yon finding PAS 1-7 — verifye si yon lòt regresyon rive.

[ ] 2. Konekte ak yon kont tès (email/modpas)
      → Rezilta atann: koneksyon reyisi, redireksyon nan /dashboard.
      → Si l echwe ak yon erè 429 twò rapid: SEC-003 (rate-limit) ka twò strik apre chanjman ou fè.
      → Si l echwe ak yon lòt erè: pa gen finding ki ta dwe touche login — envestige separeman.

[ ] 3. Chaje /dashboard (oswa /dashboard/admin si se yon kont admin)
      → Rezilta atann: dashboard la chaje san erè 500, kat/estatistik yo parèt.
      → Si l echwe: verifye si se DB-001/FIN-001 (migrasyon PAS 9 poko aplike, gade OPS-004) ki lakòz — chèk konsòl navigatè a pou "wallet_discrepancies" oswa "platform_payout_settings" nan mesaj erè a.

[ ] 4. Kreye yon kòmand tès (nenpòt restoran, peman "Kach")
      → Rezilta atann: kòmand kreye san erè, parèt nan "Kòmand mwen".
      → Si l echwe: PA gen finding PAS 1-7 ki touche create_order_secure — se yon lòt pwoblèm.

[ ] 5. (Si mòd tès Stripe disponib) Fè yon peman tès ak kat 4242 4242 4242 4242
      → Rezilta atann: peman konfime, kòmand pase 'paid'.
      → Si l echwe: verifye webhook Stripe (pa touche pa remediation sa a, men bon pou konfime anyen pa kase).

[ ] 6. Kòm admin, louvri "Jesyon Piblisite" (dashboard/admin/ads), telechaje yon nouvo imaj piblisite
      → Rezilta atann: telechajman reyisi, apèsi imaj la parèt. **Sa a se yon tès dirèk API-001.**
      → Si l echwe ak "bucket not found" oswa erè 400/404: migrasyon 20260827140000 (bucket ads-media-images/videos) poko aplike sou DB — gade OPS-004/Q-5. Pa yon bug kòd.

[ ] 7. Sou menм fòm piblisite a, eseye telechaje yon videyo (mp4)
      → Rezilta atann: telechajman reyisi nan bucket videyo a (jiska 50MB).
      → Si l echwe: menm kòz posib ak #6.

[ ] 8. Egzamine yon nouvo notifikasyon (push oswa nan cloche a) apre yon aksyon (ex: chanjman estati kòmand)
      → Rezilta atann: notifikasyon parèt san reta enkonsyistan.
      → Si l echwe: verifye si se menм echèk ak 18 tès E2E ki gaye sou "notifications"/"order-chat" (OPS-003) — ka yon pwoblèm pi laj, pa espesifik a remediation sa a.

[ ] 9. Kòm admin, tcheke si /api/csp-report reponn (F12 → Network, chaje yon paj — chèche yon apèl 'csp-report' si genyen)
      → Rezilta atann: si yon apèl fèt, li dwe retounen 204, jamè 500.
      → CONFIRMED deja via curl pandan PAS 9 (204 pou yon requèt valid, 413 pou yon kò twò gwo) — sa a se yon dobl-verifikasyon vizyèl.

[ ] 10. GitHub → onglè Actions → tcheke "Backup restore test" parèt kòm yon workflow "active"
       → Rezilta atann: li la, pwochen ekzekisyon pwograme Lendi. Pa gen rapò ankò — nòmal, premye ekzekisyon poko rive.
       → Si sekrè yo (SUPABASE_ACCESS_TOKEN, elt.) pa konfigire: ekzekisyon an ap echwe ak yon mesaj klè ki nonmen ki sekrè ki manke — sa pa yon bug, se yon etap ou dwe fè (gade playbook remediation an).
```

**Nòt**: Pwen #6 ak #7 se yon **tès reyèl** pou konfime `API-001` (bucket split la) — si yo echwe ak yon erè bucket, sa se prèv definitif migrasyon `20260827140000` poko aplike, san menм bezwen egzekite Q-5.
