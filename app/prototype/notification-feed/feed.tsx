// PROTOTYPE: shared Knock feed state for the Notification Feed variants.
import { createContext, useContext, useEffect, useRef, useState } from "react";
import KnockClient, { type Feed, type FeedItem, type FeedStoreState } from "@knocklabs/client";
import { toast } from "sonner";
import {
  Ban,
  CheckCircle2,
  MessageCircleQuestion,
  MessageSquareReply,
  Receipt,
  UserPlus,
  UsersRound,
  type LucideIcon,
} from "lucide-react";

export type KnockConfig = {
  knockUserId: string;
  token: string;
  publicApiKey: string;
  feedChannelId: string;
};

type Ctx = { state: FeedStoreState | null; feed: Feed | null };
const FeedContext = createContext<Ctx>({ state: null, feed: null });
export const useNotificationFeed = () => useContext(FeedContext);

export function NotificationFeedProvider({
  config,
  toastOnArrival,
  children,
}: {
  config: KnockConfig;
  toastOnArrival: boolean;
  children: React.ReactNode;
}) {
  const [ctx, setCtx] = useState<Ctx>({ state: null, feed: null });
  const toastRef = useRef(toastOnArrival);
  toastRef.current = toastOnArrival;

  useEffect(() => {
    const client = new KnockClient(config.publicApiKey);
    client.authenticate(config.knockUserId, config.token);
    const feed = client.feeds.initialize(config.feedChannelId, { archived: "exclude" });
    const unsubscribe = feed.store.subscribe((state) => setCtx({ state: { ...state }, feed }));
    feed.on("items.received.realtime", ({ items }: { items: FeedItem[] }) => {
      if (!toastRef.current) return;
      for (const item of items) toast(describe(item).title, { description: describe(item).detail });
    });
    feed.listenForUpdates();
    feed.fetch().then(() => setCtx({ state: { ...feed.getState() }, feed }));
    return () => {
      unsubscribe();
      feed.teardown();
      client.teardown();
    };
  }, [config.knockUserId, config.token, config.publicApiKey, config.feedChannelId]);

  return <FeedContext.Provider value={ctx}>{children}</FeedContext.Provider>;
}

type Data = {
  kind?: string;
  course_title?: string;
  lesson_title?: string;
  excerpt?: string;
  url?: string;
};

export type Described = {
  icon: LucideIcon;
  tone: string;
  actor: string;
  title: string;
  detail?: string;
  href: string;
  category: "Refunds" | "Team" | "Enrollments" | "Discussions";
};

// Cadence owns the copy: rows are written from the trigger data, not Knock's templates.
export function describe(item: FeedItem): Described {
  const d = (item.data ?? {}) as Data;
  const first = item.actors[0];
  const actor = first && "name" in first && first.name ? first.name : "Someone";
  const course = d.course_title ?? "a course";
  const href = d.url ?? "/";
  switch (d.kind) {
    case "refund-approved":
      return { icon: CheckCircle2, tone: "text-green-600", actor, href, category: "Refunds",
        title: `Your Refund Request for ${course} was approved` };
    case "refund-declined":
      return { icon: Ban, tone: "text-red-600", actor, href, category: "Refunds",
        title: `Your Refund Request for ${course} was declined`, detail: d.excerpt };
    case "refund-request-opened":
      return { icon: Receipt, tone: "text-amber-600", actor, href, category: "Refunds",
        title: `${actor} requested a refund for ${course}` };
    case "seat-claimed":
      return { icon: UsersRound, tone: "text-blue-600", actor, href, category: "Team",
        title: `${actor} claimed a Seat on ${course}` };
    case "new-enrollment":
      return { icon: UserPlus, tone: "text-blue-600", actor, href, category: "Enrollments",
        title: `${actor} enrolled in ${course}` };
    case "discussion-question":
      return { icon: MessageCircleQuestion, tone: "text-violet-600", actor, href, category: "Discussions",
        title: `${actor} asked a question on ${d.lesson_title ?? course}`, detail: d.excerpt };
    default:
      return { icon: MessageSquareReply, tone: "text-violet-600", actor, href, category: "Discussions",
        title: `${actor} replied to your question on ${d.lesson_title ?? course}`, detail: d.excerpt };
  }
}

export function timeAgo(iso: string) {
  const s = Math.max(1, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}
