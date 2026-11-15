// PROTOTYPE — end-to-end run of checks 2–4 for ticket #26.
// Triggers go through the running app (POST /prototype/knock as the DevUI user);
// feed + preference reads/writes go straight to Knock with that user's signed token,
// exactly as the browser would. Run: node --env-file=.env app/prototype/knock-checks.mjs
import { signUserToken } from "@knocklabs/node";
const APP = process.env.APP_URL ?? "http://localhost:5199";
const { KNOCK_PUBLIC_API_KEY: PK, KNOCK_SIGNING_KEY: SK, KNOCK_FEED_CHANNEL_ID: CH, KNOCK_SERVICE_TOKEN: ST } = process.env;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const kid = (id) => `cadence-user-${id}`;

async function asUser(id) {
  const r = await fetch(`${APP}/api/switch-user`, { method: "POST", body: new URLSearchParams({ userId: id }), redirect: "manual" });
  return r.headers.get("set-cookie").split(";")[0];
}
async function trigger(actorId, intent, recipientId) {
  const r = await fetch(`${APP}/prototype/knock`, { method: "POST", headers: { Cookie: await asUser(actorId) }, body: new URLSearchParams({ intent, userId: recipientId }) });
  const html = await r.text();
  const run = html.match(/workflow_run_id[^0-9a-f]*([0-9a-f-]{36})/)?.[1];
  console.log(`  trigger ${intent} ${actorId}→${recipientId}: HTTP ${r.status}, workflow_run_id ${run ?? "NOT FOUND"}`);
}
async function knockAs(id, method, path, body) {
  const token = await signUserToken(kid(id), { signingKey: SK, expiresInSeconds: 120 });
  const r = await fetch(`https://api.knock.app/v1${path}`, { method, headers: { Authorization: `Bearer ${PK}`, "X-Knock-User-Token": token, "Content-Type": "application/json" }, body: body && JSON.stringify(body) });
  return { status: r.status, json: await r.json().catch(() => null) };
}
async function feed(id) {
  const { json } = await knockAs(id, "GET", `/users/${kid(id)}/feeds/${CH}`);
  return { total: json.meta.total_count, unread: json.meta.unread_count, unseen: json.meta.unseen_count, entries: json.entries };
}
const show = async (label, id) => { const f = await feed(id); console.log(`  ${label}: total ${f.total}, unread ${f.unread}, unseen ${f.unseen}`); return f; };

const EMMA = 5, JAMES = 6, SARAH = 2, MARCUS = 3;

console.log("CHECK 2 — Discussion Reply → question author");
await trigger(EMMA, "discussion-reply", JAMES);
await wait(4000);
const james = await show("James (recipient)", JAMES);
await show("Emma (actor)", EMMA);
const item = james.entries[0];
console.log("  item:", JSON.stringify({ workflow: item.source.key, categories: item.source.categories, actor: item.actors[0]?.name, body: item.blocks[0]?.rendered, data: item.data }));

console.log("CHECK 3 — headless feed: seen / read / unread");
for (const status of ["seen", "read"]) {
  const r = await knockAs(JAMES, "PUT", `/messages/${item.id}/${status}`);
  console.log(`  mark ${status}: HTTP ${r.status}`);
  await show(`after ${status}`, JAMES);
}
console.log(`  mark unread: HTTP ${(await knockAs(JAMES, "DELETE", `/messages/${item.id}/read`)).status}`);
await show("after unread", JAMES);

console.log("CHECK 4 — new Enrollment → Instructor, off by default, opt-in");
const defaults = { preference_set: { categories: { enrollments: { channel_types: { in_app_feed: false } } } } };
const d = await fetch("https://control.knock.app/v1/environments/development/defaults", { method: "PUT", headers: { Authorization: `Bearer ${ST}`, "Content-Type": "application/json" }, body: JSON.stringify(defaults) });
console.log(`  set environment default (enrollments feed off): HTTP ${d.status} ${(await d.text()).slice(0, 200)}`);
await wait(2000);
console.log("  4a. Sarah has never set preferences:");
const before = (await show("Sarah before", SARAH)).total;
await trigger(EMMA, "new-enrollment", SARAH);
await wait(4000);
const afterDefault = (await show("Sarah after trigger (expect no change)", SARAH)).total;
console.log("  Sarah's effective preferences:", JSON.stringify((await knockAs(SARAH, "GET", `/users/${kid(SARAH)}/preferences/default`)).json));
console.log("  4b. Sarah opts in with her own user token:");
const opt = await knockAs(SARAH, "PUT", `/users/${kid(SARAH)}/preferences/default/categories/enrollments`, { subscribed: { channel_types: { in_app_feed: true } } });
console.log(`  opt in: HTTP ${opt.status} ${JSON.stringify(opt.json).slice(0, 300)}`);
await wait(1500);
await trigger(EMMA, "new-enrollment", SARAH);
await wait(4000);
const afterOptIn = (await show("Sarah after opt-in trigger (expect +1)", SARAH)).total;
console.log("  4c. Marcus (no opt-in) still gets nothing, but default-on categories still reach him:");
await trigger(EMMA, "new-enrollment", MARCUS);
await trigger(EMMA, "discussion-reply", MARCUS);
await wait(4000);
const marcus = await show("Marcus", MARCUS);
console.log("  Marcus items:", marcus.entries.map((e) => e.source.key).join(", ") || "none");

console.log("\nVERDICT");
console.log("  check 4 default-off:", afterDefault === before ? "PASS" : "FAIL");
console.log("  check 4 opt-in:", afterOptIn === afterDefault + 1 ? "PASS" : "FAIL");
