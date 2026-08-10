import type { Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

/** Shared WCAG2A/AA scan — used by every page audited in cross-cutting/accessibility.spec.ts. */
export function buildAxe(page: Page) {
  return new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]);
}
