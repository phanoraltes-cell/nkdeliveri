import { chromium } from "playwright";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1024, height: 1536 } });
await page.goto("file://" + process.cwd().replace(/\\/g, "/") + "/ruler.html");
await page.waitForTimeout(300);
await page.screenshot({ path: "ruler-out.png" });
await browser.close();
