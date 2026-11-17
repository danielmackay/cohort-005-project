// PROTOTYPE: floating variant switcher. Never rendered in production builds.
import { useEffect, useState } from "react";
import { useFetcher, useSearchParams } from "react-router";
import { ChevronLeft, ChevronRight } from "lucide-react";

export const VARIANTS = {
  A: "Bell popover",
  B: "Sidebar item + drawer",
  C: "Full page + toasts",
} as const;
export type VariantKey = keyof typeof VARIANTS;
const keys = Object.keys(VARIANTS) as VariantKey[];
const isKey = (v: string | null): v is VariantKey => !!v && v in VARIANTS;

// The URL param wins; sessionStorage keeps the variant across in-app links that drop it.
export function useVariant(): [VariantKey, (v: VariantKey) => void] {
  const [params, setParams] = useSearchParams();
  const fromUrl = params.get("variant");
  const [stored, setStored] = useState<VariantKey>("A");
  useEffect(() => {
    const s = sessionStorage.getItem("prototype-feed-variant");
    if (isKey(s)) setStored(s);
  }, []);
  useEffect(() => {
    if (isKey(fromUrl)) setStored(fromUrl);
  }, [fromUrl]);
  const current = isKey(fromUrl) ? fromUrl : stored;
  useEffect(() => sessionStorage.setItem("prototype-feed-variant", current), [current]);
  const set = (v: VariantKey) => {
    setStored(v);
    setParams((p) => { p.set("variant", v); return p; }, { replace: true });
  };
  return [current, set];
}

export function PrototypeSwitcher({ current, onChange }: { current: VariantKey; onChange: (v: VariantKey) => void }) {
  const seed = useFetcher();
  const i = keys.indexOf(current);
  const step = (d: number) => onChange(keys[(i + d + keys.length) % keys.length]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest("input, textarea, select, [contenteditable]")) return;
      if (e.key === "ArrowLeft") step(-1);
      if (e.key === "ArrowRight") step(1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  if (!import.meta.env.DEV) return null;
  return (
    <div className="fixed bottom-4 left-1/2 z-[100] flex -translate-x-1/2 items-center gap-2 rounded-full bg-black px-2 py-1.5 text-sm text-white shadow-xl ring-2 ring-yellow-400">
      <button onClick={() => step(-1)} className="rounded-full p-1 hover:bg-white/20"><ChevronLeft className="size-4" /></button>
      <span className="min-w-48 text-center font-mono">{current} ({VARIANTS[current]})</span>
      <button onClick={() => step(1)} className="rounded-full p-1 hover:bg-white/20"><ChevronRight className="size-4" /></button>
      <seed.Form method="post" action="/api/prototype-notifications" className="flex gap-1 border-l border-white/30 pl-2">
        <button className="rounded-full bg-yellow-400 px-2 py-0.5 text-xs font-semibold text-black">
          {seed.state === "idle" ? "Seed 7" : "Sending…"}
        </button>
      </seed.Form>
      <seed.Form method="post" action="/api/prototype-notifications">
        <input type="hidden" name="kind" value="discussion-reply" />
        <button className="rounded-full bg-white/15 px-2 py-0.5 text-xs">+1 reply</button>
      </seed.Form>
    </div>
  );
}
