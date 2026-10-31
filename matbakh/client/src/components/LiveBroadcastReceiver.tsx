import { useEffect, useRef, useState } from "react";
import { Radio, VolumeX } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { useBranch } from "@/contexts/BranchContext";
import { base64ToBytes, createBroadcastPlayback } from "@/lib/broadcast-client";

type Playback = Awaited<ReturnType<typeof createBroadcastPlayback>>;

export default function LiveBroadcastReceiver() {
  const { branchId } = useBranch();
  const user = trpc.auth.me.useQuery().data;
  const utils = trpc.useUtils();
  const [enabled, setEnabled] = useState(false);
  const [playingTitle, setPlayingTitle] = useState("");
  const [error, setError] = useState("");
  const context = useRef<Playback | null>(null);
  const cursor = useRef({ id: 0, sequence: -1 });
  const busy = useRef(false);
  const epoch = useRef(0);
  const active = trpc.communications.list.useQuery(
    { branchId: branchId ?? undefined },
    { enabled: Boolean(user && branchId && enabled), refetchInterval: 1000 }
  );
  const section =
    user?.role === "station"
      ? "station"
      : user?.role === "kitchen"
        ? "kitchen"
        : window.location.pathname === "/"
          ? "station"
          : "kitchen";
  const row =
    active.data?.find(
      item =>
        item.status === "live" &&
        item.senderId !== user?.id &&
        item.targetSection === section
    ) ??
    active.data?.find(
      item =>
        item.id === cursor.current.id &&
        item.totalChunks > cursor.current.sequence + 1
    );

  async function disable() {
    epoch.current++;
    setEnabled(false);
    setPlayingTitle("");
    cursor.current = { id: 0, sequence: -1 };
    await context.current?.close();
    context.current = null;
  }
  async function enable() {
    try {
      await disable();
      context.current = await createBroadcastPlayback();
      setError("");
      setEnabled(true);
    } catch {
      setError("تعذر تفعيل الصوت. تحقق من المتصفح ومستوى الصوت.");
    }
  }
  useEffect(() => {
    if (
      !enabled ||
      !row ||
      !context.current ||
      window.location.pathname === "/communications"
    )
      return;
    const generation = epoch.current;
    let cancelled = false;
    const player = context.current;
    if (cursor.current.id !== row.id) {
      const justStarted = Date.now() - new Date(row.startedAt).getTime() < 5000;
      cursor.current = {
        id: row.id,
        sequence: justStarted ? -1 : Math.max(-1, row.totalChunks - 3),
      };
      setPlayingTitle(`${row.senderName} — ${row.title}`);
    }
    const poll = async () => {
      if (cancelled || generation !== epoch.current || busy.current) return;
      busy.current = true;
      try {
        const result = await utils.communications.audioChunks.fetch({
          id: row.id,
          afterSequence: cursor.current.sequence,
        });
        if (cancelled || generation !== epoch.current) return;
        for (const chunk of result.chunks) {
          if (chunk.sequence <= cursor.current.sequence) continue;
          await player.append(base64ToBytes(chunk.data), result.sampleRate);
          cursor.current.sequence = chunk.sequence;
        }
        setError("");
      } catch {
        setError("انقطع استقبال البث؛ نحاول الاتصال من جديد.");
      } finally {
        busy.current = false;
      }
    };
    void poll();
    const timer = window.setInterval(() => void poll(), 500);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [enabled, row?.id, branchId, section]);
  useEffect(() => {
    if (!row) setPlayingTitle("");
  }, [row?.id]);
  useEffect(() => {
    void disable();
  }, [branchId, user?.id]);
  useEffect(
    () => () => {
      epoch.current++;
      void context.current?.close();
    },
    []
  );
  if (!user || user.mustChangePassword) return null;
  return (
    <div className="live-receiver-strip">
      <button
        type="button"
        onClick={() => (enabled ? void disable() : void enable())}
        aria-pressed={enabled}
      >
        {enabled ? <Radio size={15} /> : <VolumeX size={15} />}
        {enabled ? "استقبال البث مفعّل" : "تفعيل استقبال البث"}
      </button>
      <span>
        {playingTitle
          ? `بث مباشر مسجّل: ${playingTitle}`
          : error ||
            (enabled
              ? `بانتظار بث إلى ${section === "station" ? "السخان" : "المطبخ"}`
              : "فعّل الصوت مرة واحدة لسماع بث المدير داخل هذه الصفحة")}
      </span>
    </div>
  );
}
