// PROTOTYPE — throwaway spike for wayfinder ticket "Does Knock hold up against Cadence?" (#26).
// Visit /prototype/knock. Switch users with the DevUI panel and watch the feed switch.
// Not production code. Deliberately ugly: this is about vendor fit, not the Feed's look.
import { useCallback, useEffect, useRef, useState } from "react";
import { Form, useActionData } from "react-router";
import { eq } from "drizzle-orm";
import KnockClient, { type Feed, type FeedStoreState } from "@knocklabs/client";
import type { Route } from "./+types/prototype.knock";
import { db } from "~/db";
import { users } from "~/db/schema";
import { getCurrentUserId } from "~/lib/session";
import {
  knock,
  knockPublicConfig,
  knockUserId,
  notifyDiscussionReply,
  notifyNewEnrollment,
  signFeedToken,
} from "~/prototype/knock.server";

const getUser = (id: number) =>
  db.select().from(users).where(eq(users.id, id)).get();

export async function loader({ request }: Route.LoaderArgs) {
  const currentUserId = await getCurrentUserId(request);
  const allUsers = db.select().from(users).all();
  if (!currentUserId) {
    return { signedIn: false as const, allUsers };
  }
  const token = await signFeedToken(currentUserId);
  const [header, payload] = token
    .split(".")
    .slice(0, 2)
    .map((part) => JSON.parse(Buffer.from(part, "base64url").toString()));
  return {
    signedIn: true as const,
    allUsers,
    currentUser: getUser(currentUserId)!,
    knockUserId: knockUserId(currentUserId),
    token,
    tokenHeader: header,
    tokenPayload: payload,
    ...knockPublicConfig(),
  };
}

export async function action({ request }: Route.ActionArgs) {
  const currentUserId = await getCurrentUserId(request);
  if (!currentUserId) throw new Response("Pick a user", { status: 401 });
  const me = getUser(currentUserId)!;
  const form = await request.formData();
  const intent = form.get("intent");
  const other = getUser(Number(form.get("userId")));

  try {
    if (intent === "discussion-reply" && other) {
      const result = await notifyDiscussionReply({
        replier: me,
        questionAuthor: other,
        lessonTitle: "Prototype lesson",
        lessonUrl: "/prototype/knock",
        replyExcerpt: `Reply from ${me.name} at ${new Date().toLocaleTimeString()}`,
      });
      return { intent, to: other.name, result };
    }
    if (intent === "new-enrollment" && other) {
      const result = await notifyNewEnrollment({
        student: me,
        instructor: other,
        courseTitle: "Prototype course",
      });
      return { intent, to: other.name, result };
    }
    if (intent === "server-read-preferences") {
      // What the server (secret key) sees for the current user, to compare
      // with what the browser (user token) sees.
      const result = await knock.users.getPreferences(
        knockUserId(currentUserId),
        "default"
      );
      return { intent, result };
    }
    if (intent === "server-unset-preferences") {
      await knock.users.unsetPreferences(knockUserId(currentUserId), "default");
      return { intent, result: "unset — user now falls back to defaults" };
    }
  } catch (error) {
    return { intent, error: String(error) };
  }
  return { intent, error: "unknown intent" };
}

const pre = "overflow-auto rounded bg-muted p-3 text-xs";
const btn = "rounded border px-2 py-1 text-xs hover:bg-muted";
const box = "space-y-3 rounded border p-4";

export default function KnockPrototype({ loaderData }: Route.ComponentProps) {
  const actionData = useActionData<typeof action>();

  if (!loaderData.signedIn) {
    return <p className="p-8">Pick a user in the DevUI panel first.</p>;
  }
  const { currentUser, allUsers } = loaderData;

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-8">
      <h1 className="text-2xl font-bold">PROTOTYPE: Knock spike</h1>
      <p className="text-sm text-muted-foreground">
        Signed in as <b>{currentUser.name}</b> ({currentUser.role}) → Knock user{" "}
        <code>{loaderData.knockUserId}</code>. Switch users in the DevUI panel.
      </p>

      <section className={box}>
        <h2 className="font-semibold">1. Signed user token</h2>
        <pre className={pre}>
          {JSON.stringify(
            { header: loaderData.tokenHeader, payload: loaderData.tokenPayload },
            null,
            2
          )}
        </pre>
      </section>

      <section className={box}>
        <h2 className="font-semibold">2. Trigger (server, Node SDK)</h2>
        <p className="text-xs text-muted-foreground">
          The current user is the actor. A real reply on a lesson page also
          fires Discussion Reply.
        </p>
        {(
          [
            ["discussion-reply", "Discussion Reply → question author"],
            ["new-enrollment", "new Enrollment → Instructor"],
          ] as const
        ).map(([intent, label]) => (
          <Form method="post" key={intent} className="flex items-center gap-2">
            <input type="hidden" name="intent" value={intent} />
            <span className="w-72 text-sm">{label}</span>
            <select name="userId" className="rounded border p-1 text-sm">
              {allUsers
                .filter((u) => u.id !== currentUser.id)
                .map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name} ({u.role})
                  </option>
                ))}
            </select>
            <button className={btn}>Trigger</button>
          </Form>
        ))}
        <div className="flex gap-2">
          {(
            [
              ["server-read-preferences", "Server: read my preferences"],
              ["server-unset-preferences", "Server: unset my preferences"],
            ] as const
          ).map(([intent, label]) => (
            <Form method="post" key={intent}>
              <input type="hidden" name="intent" value={intent} />
              <button className={btn}>{label}</button>
            </Form>
          ))}
        </div>
        <pre className={pre}>
          {JSON.stringify(actionData ?? "no action yet", null, 2)}
        </pre>
      </section>

      {/* key: a fresh Knock client per user, so switching users switches everything */}
      <ClientSide key={loaderData.knockUserId} {...loaderData} />
    </div>
  );
}

function ClientSide(props: {
  knockUserId: string;
  token: string;
  publicApiKey: string;
  feedChannelId: string;
}) {
  const feedRef = useRef<Feed | null>(null);
  const knockRef = useRef<KnockClient | null>(null);
  const [feedState, setFeedState] = useState<FeedStoreState | null>(null);
  const [prefs, setPrefs] = useState<unknown>(null);
  const [log, setLog] = useState<string[]>([]);
  const say = (line: string) =>
    setLog((l) => [`${new Date().toLocaleTimeString()} ${line}`, ...l]);

  const refresh = useCallback(() => {
    if (feedRef.current) setFeedState({ ...feedRef.current.getState() });
  }, []);

  useEffect(() => {
    const client = new KnockClient(props.publicApiKey);
    client.authenticate(props.knockUserId, props.token);
    knockRef.current = client;

    const feed = client.feeds.initialize(props.feedChannelId);
    feedRef.current = feed;
    feed.on("items.received.realtime", () => {
      say("realtime: items received");
      refresh();
    });
    feed.on("items.*", refresh);
    feed.listenForUpdates();
    feed.fetch().then((r) => {
      say(`feed.fetch → ${r?.status}`);
      refresh();
    });
    client.preferences
      .get()
      .then(setPrefs)
      .catch((e) => setPrefs({ error: String(e) }));

    return () => {
      feed.teardown();
      client.teardown();
    };
  }, [props.knockUserId, props.token, props.publicApiKey, props.feedChannelId, refresh]);

  const feed = feedRef.current;
  const run = (label: string, fn: () => Promise<unknown>) => async () => {
    try {
      await fn();
      say(`${label} ok`);
    } catch (e) {
      say(`${label} FAILED ${String(e)}`);
    }
    refresh();
  };

  const setCategory = (category: string, value: boolean) =>
    run(`setCategory ${category}=${value}`, async () => {
      setPrefs(
        await knockRef.current!.preferences.setCategory(category, {
          channel_types: { in_app_feed: value },
        })
      );
    });

  return (
    <>
      <section className={box}>
        <h2 className="font-semibold">3. Headless feed (browser, user token)</h2>
        <pre className={pre}>
          {JSON.stringify(feedState?.metadata ?? "loading", null, 2)}
        </pre>
        <div className="flex gap-2">
          <button className={btn} onClick={run("fetch", () => feed!.fetch())}>
            Refetch
          </button>
          <button className={btn} onClick={run("markAllAsSeen", () => feed!.markAllAsSeen())}>
            Mark all seen
          </button>
          <button className={btn} onClick={run("markAllAsRead", () => feed!.markAllAsRead())}>
            Mark all read
          </button>
        </div>
        <ul className="space-y-2">
          {feedState?.items.map((item) => (
            <li key={item.id} className="rounded border p-2 text-sm">
              <div
                dangerouslySetInnerHTML={{
                  __html: item.blocks
                    .map((b) => ("rendered" in b ? b.rendered : ""))
                    .join(""),
                }}
              />
              <div className="text-xs text-muted-foreground">
                workflow <code>{item.source.key}</code> · categories{" "}
                <code>{JSON.stringify(item.source.categories)}</code> · actor{" "}
                {item.actors.map((a) => ("name" in a ? a.name : a.id)).join(", ")} ·
                seen {item.seen_at ? "yes" : "no"} · read {item.read_at ? "yes" : "no"}
              </div>
              <pre className={pre}>{JSON.stringify(item.data, null, 2)}</pre>
              <div className="mt-1 flex gap-2">
                <button className={btn} onClick={run("markAsSeen", () => feed!.markAsSeen(item))}>
                  seen
                </button>
                <button className={btn} onClick={run("markAsRead", () => feed!.markAsRead(item))}>
                  read
                </button>
                <button className={btn} onClick={run("markAsUnread", () => feed!.markAsUnread(item))}>
                  unread
                </button>
                <button className={btn} onClick={run("markAsArchived", () => feed!.markAsArchived(item))}>
                  archive
                </button>
              </div>
            </li>
          ))}
          {feedState?.items.length === 0 && <li className="text-sm">Feed is empty.</li>}
        </ul>
      </section>

      <section className={box}>
        <h2 className="font-semibold">4. Preferences (browser, user token)</h2>
        <p className="text-xs text-muted-foreground">
          What Knock returns for this user, including any environment default.
          A user who has never touched preferences should already show{" "}
          <code>enrollments</code> off.
        </p>
        <div className="flex flex-wrap gap-2">
          {["enrollments", "discussions"].map((category) => (
            <span key={category} className="flex gap-1">
              <button className={btn} onClick={setCategory(category, true)}>
                {category}: feed ON
              </button>
              <button className={btn} onClick={setCategory(category, false)}>
                {category}: feed OFF
              </button>
            </span>
          ))}
        </div>
        <pre className={pre}>{JSON.stringify(prefs, null, 2)}</pre>
      </section>

      <section className={box}>
        <h2 className="font-semibold">Log</h2>
        <pre className={pre}>{log.join("\n") || "—"}</pre>
      </section>
    </>
  );
}
