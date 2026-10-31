import { trpc } from "@/lib/trpc";
import { useBranch } from "@/contexts/BranchContext";
import { dateTime } from "@/lib/kitchen-ui";

export default function BroadcastArchive({ orderId }: { orderId: number }) {
  const { branchId } = useBranch();
  const list = trpc.communications.list.useQuery(
    { branchId: branchId ?? undefined, orderId },
    { enabled: Boolean(branchId), staleTime: 15000 }
  );
  const mark = trpc.communications.markListened.useMutation();
  const recordings =
    list.data?.filter(item => item.status !== "live" && item.totalBytes > 0) ??
    [];
  if (!recordings.length) return null;
  return (
    <div className="order-broadcast-archive">
      <strong>تواصل مسجّل مرتبط بالتذكرة</strong>
      {recordings.map(item => (
        <div key={item.id}>
          <span>
            {item.title} — {item.senderName}
          </span>
          <small>
            بدأ: {dateTime(item.startedAt)} ·{" "}
            {item.status === "interrupted"
              ? "انقطع البث"
              : `انتهى: ${dateTime(item.endedAt)}`}
          </small>
          <audio
            controls
            preload="none"
            src={`/api/communications/${item.id}/recording.wav`}
            onPlay={() => mark.mutate({ id: item.id })}
          />
        </div>
      ))}
    </div>
  );
}
