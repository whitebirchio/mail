// UI smoke test against the dev fake mailbox, in the installed Chrome:
//
//   MAIL_DEV_FAKE=1 … npm run dev -w mail-web     (see CLAUDE.md)
//   npm run smoke -w mail-web
//
// It clicks through triage, Undo, thread navigation and sending, and checks
// the security properties a unit test can't: no script runs in a message
// frame, the frame has no allow-scripts, and no request leaves localhost
// until "Show images". Every message it touches is invented.
import { chromium } from "playwright-core";

const BASE = process.env.SMOKE_URL ?? "http://localhost:3000";
const failures = [];
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "✓" : "✗"} ${name}${detail ? ` (${detail})` : ""}`);
  if (!ok) failures.push(name);
};

const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage({ viewport: { width: 1300, height: 900 } });
const offsite = [];
page.on("request", (r) => {
  const host = new URL(r.url()).hostname;
  if (host !== "localhost" && host !== "127.0.0.1") offsite.push(r.url());
});
const dialogs = [];
page.on("dialog", async (d) => {
  dialogs.push(d.message());
  await d.dismiss();
});
const rowTitled = (text) => page.locator("li", { hasText: text }).first();

try {
  // Inbox
  await page.goto(`${BASE}/inbox`);
  await page.getByRole("heading", { name: "Inbox" }).waitFor();
  check("inbox lists 25 rows", (await page.locator("main ul > li").count()) === 25);
  check("tab title carries the unread count", /^(Inbox \(\d+\) · )?Mail$/.test(await page.title()), await page.title());

  // Star a row from the list
  const dee = rowTitled("Photos from the trip");
  await dee.getByRole("button", { name: "Unstar" }).click();
  await dee.getByRole("button", { name: "Star", exact: true }).waitFor();
  check("unstar from the list", true);
  await dee.getByRole("button", { name: "Star", exact: true }).click();
  await dee.getByRole("button", { name: "Unstar" }).waitFor();

  // Bulk: select two filler rows, archive, then Undo
  const fillers = page.locator("main ul > li", { hasText: "Invented message number" });
  const [subjA, subjB] = [/number \d+(?= —)/.exec(await fillers.nth(0).innerText())[0], /number \d+(?= —)/.exec(await fillers.nth(1).innerText())[0]];
  const filler = (n) => page.locator("main ul > li", { hasText: new RegExp(`Invented message ${n} —`) });
  await filler(subjA).getByRole("checkbox").check();
  await filler(subjB).getByRole("checkbox").check();
  check("selection count shows", await page.getByText("2 selected").isVisible());
  await page.getByRole("toolbar", { name: "Selected conversations" }).getByRole("button", { name: "Archive" }).click();
  await page.getByText("2 conversations archived.").waitFor();
  await filler(subjA).waitFor({ state: "detached" });
  check("bulk archive removes rows and offers Undo", true);
  await page.getByRole("button", { name: "Undo" }).click();
  await page.getByText("Action undone.").waitFor();
  await filler(subjA).waitFor();
  check("Undo brings them back", true);

  // Open the receipt: frame safety, images gated, attachments
  await page.getByRole("link", { name: /Your order #10442 has shipped/ }).click();
  await page.getByRole("heading", { name: "Your order #10442 has shipped" }).waitFor();
  const frame = page.locator("iframe").first();
  const sandbox = await frame.getAttribute("sandbox");
  check("message frame is sandboxed without allow-scripts", sandbox !== null && !sandbox.includes("allow-scripts"), sandbox ?? "none");
  const body = await frame.contentFrame().locator("body").innerText();
  check("message body renders", body.includes("Your package is on its way"));
  let height = 0;
  for (let i = 0; i < 30 && height <= 150; i++, await page.waitForTimeout(100)) height = (await frame.boundingBox()).height;
  check("frame sized to content", height > 150, `${height}px`);
  check("no dialog fired from the email's script", dialogs.length === 0, dialogs.join(" | "));
  check("no request left localhost before Show images", offsite.length === 0, offsite.join(", "));
  const pdf = page.getByRole("link", { name: /receipt-10442\.pdf/ });
  const res = await page.request.get(new URL(await pdf.getAttribute("href"), BASE).toString());
  check("attachment downloads with a sandbox CSP", res.ok() && res.headers()["content-security-policy"] === "sandbox; default-src 'none'" && (await res.text()).startsWith("%PDF"));
  await page.getByRole("link", { name: "Show images" }).click();
  await page.waitForTimeout(1500);
  check("Show images lets remote images load", offsite.some((u) => u.includes("tracker.example")), offsite.join(", "));
  offsite.length = 0;

  // Archive from the thread: moves on, with Undo
  await page.getByRole("toolbar", { name: "Conversation actions" }).getByRole("button", { name: "Archive" }).click();
  await page.getByText("Conversation archived.").waitFor();
  await page.waitForURL(/\/t\//);
  check("archive moves on to the next conversation", !page.url().includes("th-receipt"), page.url());
  await page.getByRole("button", { name: "Undo" }).click();
  await page.getByText("Action undone.").waitFor();

  // Reply, then send
  await page.goto(`${BASE}/t/th-lunch?back=/inbox`);
  await page.getByRole("link", { name: "Reply", exact: true }).last().click();
  await page.getByRole("heading", { name: "Reply" }).waitFor();
  check("reply is addressed to the sender", (await page.getByLabel("To", { exact: true }).inputValue()).includes("ann@example.org"));
  await page.getByLabel("Message").press("Control+Home");
  await page.getByLabel("Message").pressSequentially("Sounds good — see you then. 🎉");
  await page.getByLabel("To", { exact: true }).fill("ann@example.org, not an address");
  await page.getByRole("button", { name: "Send" }).click();
  await page.getByRole("alert").filter({ hasText: "isn't a valid address" }).waitFor();
  check("invalid recipient is refused, naming it", true);
  await page.getByLabel("To", { exact: true }).fill("Ann Example <ann@example.org>");
  await page.getByRole("button", { name: "Send" }).click();
  await page.getByText("Message sent.").waitFor();
  await page.waitForURL(/\/t\/th-lunch/);
  check("send returns to where you came from", true);

  // Search
  await page.getByRole("searchbox", { name: "Search mail" }).fill("Photos");
  await page.getByRole("searchbox", { name: "Search mail" }).press("Enter");
  await page.getByRole("heading", { name: /Results for/ }).waitFor();
  check("search finds the thread", await page.getByText("Photos from the trip").isVisible());
} catch (e) {
  failures.push(String(e));
  console.error(e);
} finally {
  await browser.close();
}

if (failures.length > 0) {
  console.error(`\n${failures.length} failed`);
  process.exit(1);
}
console.log("\nall passed");
