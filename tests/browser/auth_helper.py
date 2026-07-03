"""Reusable Playwright auth helper for NK Delivery.

Restores the Lovable-injected Supabase session (from Google OAuth sign-in in
the Lovable preview) so tests don't need to complete the Google flow manually.

Usage:
    from auth_helper import new_authed_page, AuthStatus

    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=True)
        page, status = await new_authed_page(browser, start_path="/dashboard")
        if status != AuthStatus.INJECTED:
            print("No session available — sign in via the Lovable preview once.")
            return
        # ... run test ...

Notes:
- Session vars are minted by Lovable when the user signs in via the preview.
  If LOVABLE_BROWSER_AUTH_STATUS != "injected", ask the user to sign in once;
  the session persists automatically across future turns.
- Never log the session JSON, access token, or cookies.
"""

from __future__ import annotations

import json
import os
from enum import Enum
from typing import Tuple

BASE_URL = os.environ.get("LOVABLE_APP_URL", "http://localhost:8080")


class AuthStatus(str, Enum):
    INJECTED = "injected"
    SIGNED_OUT = "signed_out"
    EXTERNAL_UNMANAGED = "external_unmanaged"
    NO_SUPABASE = "no_supabase"


def current_status() -> AuthStatus:
    raw = os.environ.get("LOVABLE_BROWSER_AUTH_STATUS", "no_supabase")
    try:
        return AuthStatus(raw)
    except ValueError:
        return AuthStatus.NO_SUPABASE


async def restore_session(context, page) -> AuthStatus:
    """Restore Supabase session cookies + localStorage on the localhost origin.

    Must be called after the browser context is created and before navigating
    to any authenticated route. Returns the current auth status.
    """
    status = current_status()
    if status != AuthStatus.INJECTED:
        return status

    cookies_json = os.environ.get("LOVABLE_BROWSER_SUPABASE_COOKIES_JSON")
    storage_key = os.environ.get("LOVABLE_BROWSER_SUPABASE_STORAGE_KEY")
    session_json = os.environ.get("LOVABLE_BROWSER_SUPABASE_SESSION_JSON")

    if cookies_json:
        cookies = json.loads(cookies_json)
        for c in cookies:
            c["url"] = BASE_URL
        await context.add_cookies(cookies)

    # Establish localhost origin so localStorage write lands there.
    await page.goto(BASE_URL, wait_until="domcontentloaded")
    if storage_key and session_json:
        await page.evaluate(
            f"window.localStorage.setItem({json.dumps(storage_key)}, {json.dumps(session_json)})"
        )

    return status


async def new_authed_page(
    browser,
    start_path: str = "/",
    viewport=None,
) -> Tuple[object, AuthStatus]:
    """Create a new context+page with the Supabase session restored.

    Navigates to `start_path` after restoring the session. Returns (page, status).
    """
    context = await browser.new_context(
        viewport=viewport or {"width": 1280, "height": 1800}
    )
    page = await context.new_page()
    status = await restore_session(context, page)
    if start_path and start_path != "/":
        await page.goto(BASE_URL + start_path, wait_until="domcontentloaded")
    return page, status


async def assert_authed(page) -> bool:
    """Return True if the app reports an active Supabase session in-browser."""
    return await page.evaluate(
        """async () => {
            try {
                const keys = Object.keys(window.localStorage).filter(k => k.startsWith('sb-') && k.endsWith('-auth-token'));
                if (keys.length === 0) return false;
                const raw = window.localStorage.getItem(keys[0]);
                if (!raw) return false;
                const parsed = JSON.parse(raw);
                return Boolean(parsed && parsed.access_token);
            } catch { return false; }
        }"""
    )