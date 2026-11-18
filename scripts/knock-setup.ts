// Pushes and commits every Knock workflow in knock/workflows/ (and the
// preference categories they belong to) to the Knock Development environment,
// through Knock's Management API.
//
// Usage: npm run knock:setup
//
// Needs in .env (or the shell):
// - KNOCK_SERVICE_TOKEN: a Management API service token (Knock dashboard →
//   Settings → Service tokens).
// - KNOCK_FEED_CHANNEL_ID: the id of the in-app feed channel the workflows
//   deliver to. Its channel key is looked up and put into each workflow's
//   feed step in place of "$FEED_CHANNEL_KEY".
//
// Safe to re-run: each workflow is upserted, then committed, because Knock only
// runs committed workflows (an uncommitted one returns 404 on trigger, and its
// categories don't exist at runtime). Workflows only change in Development;
// promote a commit to other environments from the Knock dashboard.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";

const MANAGEMENT_API = "https://control.knock.app/v1";
const ENVIRONMENT = "development";
const WORKFLOWS_DIR = join(import.meta.dirname, "..", "knock", "workflows");

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `${name} is missing. Add it to .env (see the header of scripts/knock-setup.ts).`
    );
  }
  return value;
}

async function management(
  token: string,
  method: "GET" | "PUT",
  path: string,
  body?: unknown
): Promise<unknown> {
  const response = await fetch(`${MANAGEMENT_API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(
      `${method} ${path} failed with ${response.status}: ${text}`
    );
  }
  return text ? JSON.parse(text) : null;
}

async function feedChannelKey(token: string, feedChannelId: string) {
  const result = await management(token, "GET", "/channels");
  const entries =
    isRecord(result) && Array.isArray(result.entries) ? result.entries : [];
  const channel = entries.find(
    (entry): entry is Record<string, unknown> =>
      isRecord(entry) && entry.id === feedChannelId
  );
  if (!channel || typeof channel.key !== "string") {
    throw new Error(
      `No Knock channel has the id KNOCK_FEED_CHANNEL_ID (${feedChannelId}).`
    );
  }
  if (channel.type !== "in_app_feed") {
    throw new Error(
      `Channel ${channel.key} is a ${String(channel.type)} channel, not an in-app feed.`
    );
  }
  return channel.key;
}

async function main() {
  if (existsSync(".env")) process.loadEnvFile(".env");
  const token = requireEnv("KNOCK_SERVICE_TOKEN");
  const channelKey = await feedChannelKey(
    token,
    requireEnv("KNOCK_FEED_CHANNEL_ID")
  );

  const files = readdirSync(WORKFLOWS_DIR).filter((file) =>
    file.endsWith(".json")
  );
  if (files.length === 0)
    throw new Error(`No workflows found in ${WORKFLOWS_DIR}`);

  for (const file of files) {
    const key = basename(file, ".json");
    const workflow: unknown = JSON.parse(
      readFileSync(join(WORKFLOWS_DIR, file), "utf8").replaceAll(
        "$FEED_CHANNEL_KEY",
        channelKey
      )
    );
    if (!isRecord(workflow)) throw new Error(`${file} is not a JSON object`);

    // Knock refuses a workflow whose categories aren't in the project's
    // preference category catalog, so upsert them first.
    const categories = Array.isArray(workflow.categories)
      ? workflow.categories
      : [];
    for (const category of categories) {
      if (typeof category !== "string")
        throw new Error(`${file} has a non-string category`);
      await management(
        token,
        "PUT",
        `/preference_categories/${encodeURIComponent(category)}?environment=${ENVIRONMENT}`,
        { preference_category: { name: category } }
      );
      console.log(`✓ preference category ${category}`);
    }

    const query = new URLSearchParams({
      environment: ENVIRONMENT,
      commit: "true",
      commit_message: `Sync ${key} from knock/workflows/${file}`,
    });
    await management(token, "PUT", `/workflows/${key}?${query}`, { workflow });
    console.log(
      `✓ ${key}: pushed and committed to ${ENVIRONMENT} (feed channel ${channelKey})`
    );
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
