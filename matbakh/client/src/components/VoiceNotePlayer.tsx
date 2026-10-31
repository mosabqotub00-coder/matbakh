import { useEffect, useState } from "react";
import { LoaderCircle, Play, Volume2 } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { useBranch } from "@/contexts/BranchContext";

export default function VoiceNotePlayer({ orderId }: { orderId: number }) {
  const { branchInput } = useBranch();
  const user = trpc.auth.me.useQuery(undefined, { retry: false }).data;
  const [open, setOpen] = useState(false);
  const voice = trpc.orders.voiceNote.useQuery(
    { orderId, ...(branchInput ?? {}) },
    { enabled: false, staleTime: 0 }
  );
  useEffect(() => setOpen(false), [orderId, branchInput?.branchId, user?.id]);
  const play = async () => {
    if (open) {
      setOpen(false);
      return;
    }
    const result = await voice.refetch();
    if (result.error) {
      toast.error("تعذر تحميل التعليق الصوتي");
      return;
    }
    if (!result.data?.data) {
      toast.error("لا يوجد تسجيل صوتي لهذا الطلب");
      return;
    }
    setOpen(true);
  };
  return (
    <div className="voice-player-wrap">
      <button
        type="button"
        className="voice-player-button"
        onClick={play}
        disabled={voice.isFetching}
      >
        {voice.isFetching ? (
          <LoaderCircle size={14} className="spin" />
        ) : open ? (
          <Volume2 size={14} />
        ) : (
          <Play size={14} fill="currentColor" />
        )}
        {voice.isFetching
          ? "جارٍ التحميل…"
          : open
            ? "إخفاء التعليق الصوتي"
            : "استماع للملاحظة الصوتية الأصلية"}
      </button>
      {open && voice.data?.data && (
        <audio
          className="voice-player"
          controls
          autoPlay
          preload="auto"
          src={`data:${voice.data.type};base64,${voice.data.data}`}
        />
      )}
    </div>
  );
}
