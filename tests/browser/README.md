# Tès Playwright ak sesyon Google OAuth

Sesyon Google OAuth Lovable la enjekte otomatikman nan sandbox la lè
itilizatè a **konekte yon fwa nan preview la**. Apre sa, tout tès Playwright
ka rekipere sesyon an san redemande Google.

## Etap inisyal (yon sèl fwa)

1. Ouvri preview Lovable la.
2. Ale sou `/auth` epi klike **Kontinye ak Google**.
3. Fini konsantman Google la nan navigatè w.

Depi sesyon an aktif, `LOVABLE_BROWSER_AUTH_STATUS=injected` epi variab
`LOVABLE_BROWSER_SUPABASE_*` yo disponib pou tout pwochen tou.

## Sèvi ak helper la

```python
import asyncio
from pathlib import Path
from playwright.async_api import async_playwright
from auth_helper import new_authed_page, AuthStatus

SHOTS = Path(__file__).parent / "screenshots"
SHOTS.mkdir(exist_ok=True)

async def main():
    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=True)
        page, status = await new_authed_page(browser, start_path="/dashboard")
        if status != AuthStatus.INJECTED:
            print(f"Session pa disponib ({status.value}). Konekte nan preview la.")
            return
        await page.screenshot(path=str(SHOTS / "dashboard.png"))
        print("URL:", page.url)
        await browser.close()

asyncio.run(main())
```

## Sekirite

- Pa janm `print`, log, oswa ekri sou disk kontni
  `LOVABLE_BROWSER_SUPABASE_*` yo.
- Helper la restore sesyon an sèlman sou `http://localhost:8080` — li pa fwit
  token nan lòt orijin.
- Si `LOVABLE_BROWSER_AUTH_STATUS=external_unmanaged`, tès otantifye yo pa
  posib — voye demann lan bay itilizatè a.