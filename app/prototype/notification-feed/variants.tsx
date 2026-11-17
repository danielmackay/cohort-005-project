// PROTOTYPE: three Notification Feed variants for "What does the Notification Feed look like in Cadence?".
// A: bell popover in the sidebar header. Badge = unseen; opening marks all seen.
// B: "Notifications" sidebar item + right drawer. Badge = unread; only reading clears it.
// C: "Notifications" sidebar item (dot only) + full page, with toasts as Notifications arrive.
import { useEffect, useRef, useState } from "react";
import { NavLink, useNavigate } from "react-router";
import type { FeedItem } from "@knocklabs/client";
import { Archive, Bell, BellDot, Check, Circle, X } from "lucide-react";
import { cn } from "~/lib/utils";
import { describe, timeAgo, useNotificationFeed } from "./feed";

function useOpen(item: FeedItem, after?: () => void) {
  const { feed } = useNotificationFeed();
  const navigate = useNavigate();
  return () => {
    if (!item.read_at) feed?.markAsRead(item);
    after?.();
    navigate(describe(item).href);
  };
}

const Empty = () => (
  <div className="p-6 text-center text-sm text-muted-foreground">
    You're all caught up. (Use "Seed 7" in the prototype bar.)
  </div>
);

// ───────────────────────── A: bell popover ─────────────────────────
export function VariantABell() {
  const { state, feed } = useNotificationFeed();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const unseen = state?.metadata.unseen_count ?? 0;

  useEffect(() => {
    if (!open) return;
    feed?.markAllAsSeen();
    const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open, feed]);

  return (
    <div ref={ref} className="relative ml-auto">
      <button onClick={() => setOpen((o) => !o)} className="relative rounded-md p-1.5 text-sidebar-foreground/70 hover:bg-sidebar-accent" title="Notifications">
        <Bell className="size-5" />
        {unseen > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex min-w-4 items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-bold leading-4 text-white">
            {unseen > 9 ? "9+" : unseen}
          </span>
        )}
      </button>
      {open && (
        <div className="absolute left-full top-0 z-50 ml-3 w-96 overflow-hidden rounded-lg border bg-popover text-popover-foreground shadow-xl">
          <div className="flex items-center justify-between border-b px-4 py-2.5">
            <span className="font-semibold">Notifications</span>
            <button onClick={() => feed?.markAllAsRead()} className="text-xs text-primary hover:underline">Mark all as read</button>
          </div>
          <ul className="max-h-[70vh] divide-y overflow-y-auto">
            {state?.items.map((item) => <RowA key={item.id} item={item} close={() => setOpen(false)} />)}
          </ul>
          {state?.items.length === 0 && <Empty />}
        </div>
      )}
    </div>
  );
}

function RowA({ item, close }: { item: FeedItem; close: () => void }) {
  const d = describe(item);
  const open = useOpen(item, close);
  return (
    <li>
      <button onClick={open} className={cn("flex w-full gap-3 px-4 py-3 text-left hover:bg-muted", !item.read_at && "bg-primary/5")}>
        <d.icon className={cn("mt-0.5 size-4 shrink-0", d.tone)} />
        <div className="min-w-0 flex-1">
          <div className={cn("text-sm", !item.read_at && "font-medium")}>{d.title}</div>
          <div className="text-xs text-muted-foreground">{timeAgo(item.inserted_at)}</div>
        </div>
        {!item.read_at && <span className="mt-1.5 size-2 shrink-0 rounded-full bg-primary" />}
      </button>
    </li>
  );
}

// ───────────────────── B: sidebar item + drawer ─────────────────────
export function VariantBNavItem() {
  const { state } = useNotificationFeed();
  const [open, setOpen] = useState(false);
  const unread = state?.metadata.unread_count ?? 0;
  return (
    <>
      <button onClick={() => setOpen(true)} className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground">
        <Bell className="size-4" />
        Notifications
        {unread > 0 && <span className="ml-auto rounded-full bg-primary px-1.5 text-xs font-semibold text-primary-foreground">{unread}</span>}
      </button>
      {open && <DrawerB close={() => setOpen(false)} />}
    </>
  );
}

function DrawerB({ close }: { close: () => void }) {
  const { state, feed } = useNotificationFeed();
  const [tab, setTab] = useState<"unread" | "all">("unread");
  const items = (state?.items ?? []).filter((i) => tab === "all" || !i.read_at);
  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/30" onMouseDown={close}>
      <aside className="flex h-full w-[28rem] flex-col bg-background shadow-2xl" onMouseDown={(e) => e.stopPropagation()}>
        <div className="flex h-14 items-center gap-3 border-b px-5">
          <span className="text-lg font-semibold">Notifications</span>
          <button onClick={() => feed?.markAllAsRead()} className="ml-auto text-xs text-primary hover:underline">Mark all as read</button>
          <button onClick={close} className="rounded p-1 hover:bg-muted"><X className="size-4" /></button>
        </div>
        <div className="flex gap-1 border-b px-5 py-2">
          {(["unread", "all"] as const).map((t) => (
            <button key={t} onClick={() => setTab(t)} className={cn("rounded-full px-3 py-1 text-sm capitalize", tab === t ? "bg-primary text-primary-foreground" : "hover:bg-muted")}>
              {t}{t === "unread" && ` (${state?.metadata.unread_count ?? 0})`}
            </button>
          ))}
        </div>
        <ul className="flex-1 space-y-2 overflow-y-auto p-4">
          {items.map((item) => <RowB key={item.id} item={item} close={close} />)}
          {items.length === 0 && <Empty />}
        </ul>
      </aside>
    </div>
  );
}

function RowB({ item, close }: { item: FeedItem; close: () => void }) {
  const { feed } = useNotificationFeed();
  const d = describe(item);
  const open = useOpen(item, close);
  const initials = d.actor.split(" ").map((p) => p[0]).join("").slice(0, 2);
  return (
    <li className={cn("group relative rounded-lg border p-3", !item.read_at ? "border-primary/40 bg-primary/5" : "opacity-75")}>
      <button onClick={open} className="flex w-full gap-3 text-left">
        <div className="relative">
          <div className="flex size-9 items-center justify-center rounded-full bg-muted text-xs font-semibold">{initials}</div>
          <d.icon className={cn("absolute -bottom-1 -right-1 size-4 rounded-full bg-background", d.tone)} />
        </div>
        <div className="min-w-0 flex-1 pr-14">
          <div className="text-sm font-medium">{d.title}</div>
          {d.detail && <div className="mt-1 line-clamp-2 border-l-2 pl-2 text-xs italic text-muted-foreground">{d.detail}</div>}
          <div className="mt-1 text-xs text-muted-foreground">{d.category} · {timeAgo(item.inserted_at)}</div>
        </div>
      </button>
      <div className="absolute right-2 top-2 hidden gap-1 group-hover:flex">
        <button title={item.read_at ? "Mark as unread" : "Mark as read"} onClick={() => (item.read_at ? feed?.markAsUnread(item) : feed?.markAsRead(item))} className="rounded p-1 hover:bg-muted">
          {item.read_at ? <Circle className="size-3.5" /> : <Check className="size-3.5" />}
        </button>
        <button title="Archive" onClick={() => feed?.markAsArchived(item)} className="rounded p-1 hover:bg-muted"><Archive className="size-3.5" /></button>
      </div>
    </li>
  );
}

// ─────────────────── C: sidebar item + full page ───────────────────
export function VariantCNavItem() {
  const { state } = useNotificationFeed();
  const unseen = state?.metadata.unseen_count ?? 0;
  return (
    <NavLink to="/prototype/notifications" className={({ isActive }) => cn("flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors", isActive ? "bg-sidebar-accent text-sidebar-accent-foreground" : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground")}>
      {unseen > 0 ? <BellDot className="size-4 text-red-600" /> : <Bell className="size-4" />}
      Notifications
    </NavLink>
  );
}

export function VariantCPage() {
  const { state, feed } = useNotificationFeed();
  const [category, setCategory] = useState<string>("All");

  // Visiting the page counts as seeing everything on it.
  const unseen = state?.metadata.unseen_count ?? 0;
  useEffect(() => { if (unseen > 0) feed?.markAllAsSeen(); }, [unseen, feed]);

  const all = state?.items ?? [];
  const categories = ["All", ...new Set(all.map((i) => describe(i).category))];
  const items = all.filter((i) => category === "All" || describe(i).category === category);
  const today = new Date().toDateString();
  const groups = [
    ["Today", items.filter((i) => new Date(i.inserted_at).toDateString() === today)],
    ["Earlier", items.filter((i) => new Date(i.inserted_at).toDateString() !== today)],
  ] as const;

  return (
    <div className="mx-auto max-w-3xl p-8">
      <div className="mb-6 flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-bold">Notifications</h1>
          <p className="text-sm text-muted-foreground">{state?.metadata.unread_count ?? 0} unread</p>
        </div>
        <button onClick={() => feed?.markAllAsRead()} className="rounded-md border px-3 py-1.5 text-sm hover:bg-muted">Mark all as read</button>
      </div>
      <div className="mb-6 flex gap-2">
        {categories.map((c) => (
          <button key={c} onClick={() => setCategory(c)} className={cn("rounded-md border px-3 py-1 text-sm", category === c ? "border-primary bg-primary/10 text-primary" : "hover:bg-muted")}>{c}</button>
        ))}
      </div>
      {groups.map(([label, list]) => list.length > 0 && (
        <section key={label} className="mb-8">
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">{label}</h2>
          <table className="w-full text-sm">
            <tbody className="divide-y">
              {list.map((item) => <RowC key={item.id} item={item} />)}
            </tbody>
          </table>
        </section>
      ))}
      {all.length === 0 && <Empty />}
    </div>
  );
}

function RowC({ item }: { item: FeedItem }) {
  const { feed } = useNotificationFeed();
  const d = describe(item);
  const open = useOpen(item);
  return (
    <tr className="group cursor-pointer hover:bg-muted/60" onClick={open}>
      <td className="w-6 py-3 pl-2">{!item.read_at && <span className="block size-2 rounded-full bg-primary" />}</td>
      <td className="w-8 py-3"><d.icon className={cn("size-4", d.tone)} /></td>
      <td className={cn("py-3", !item.read_at ? "font-medium" : "text-muted-foreground")}>
        {d.title}
        {d.detail && <span className="ml-2 font-normal text-muted-foreground">“{d.detail}”</span>}
      </td>
      <td className="w-24 whitespace-nowrap py-3 text-right text-xs text-muted-foreground">{timeAgo(item.inserted_at)}</td>
      <td className="w-24 py-3 pr-2 text-right">
        {item.read_at && (
          <button onClick={(e) => { e.stopPropagation(); feed?.markAsUnread(item); }} className="invisible text-xs text-primary group-hover:visible">Mark unread</button>
        )}
      </td>
    </tr>
  );
}
