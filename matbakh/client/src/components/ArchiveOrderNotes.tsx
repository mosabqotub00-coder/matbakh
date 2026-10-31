import { FileText, History, Mic } from "lucide-react";
import { dateTime, STATUS_LABEL, type KitchenOrder } from "@/lib/kitchen-ui";
import VoiceNotePlayer from "./VoiceNotePlayer";
import BroadcastArchive from "./BroadcastArchive";

export default function ArchiveOrderNotes({ order }: { order: KitchenOrder }) {
  const events = order.events ?? [];
  const hasExtensions = events.some(event => event.kind === "extended");
  return (
    <section className="archive-order-notes" aria-label="جميع ملاحظات الضربة">
      <h4>
        <FileText size={15} /> ملاحظات الضربة المحفوظة
      </h4>
      {order.notes?.trim() ? (
        <p className="archive-original-note">{order.notes}</p>
      ) : (
        <p className="archive-empty-note">لا توجد ملاحظات نصية مرفقة.</p>
      )}
      {order.voiceAvailable && (
        <div className="archive-original-voice">
          <span>
            <Mic size={14} /> الملاحظة الصوتية الأصلية
          </span>
          <VoiceNotePlayer orderId={order.id} />
        </div>
      )}
      {events.length > 0 && (
        <details className="archive-event-history" open={hasExtensions}>
          <summary>
            <History size={14} /> سجل الضربة وملاحظات التمديد ({events.length})
          </summary>
          <ol>
            {events.map(event => (
              <li key={event.id}>
                <div className="archive-event-head">
                  <strong>
                    {event.kind === "extended"
                      ? `تمديد المهلة${event.addedMinutes ? ` +${event.addedMinutes} دقيقة` : ""}`
                      : (STATUS_LABEL[event.status] ?? event.status)}
                  </strong>
                  <time>{dateTime(event.createdAt)}</time>
                </div>
                {event.actor && (
                  <span className="archive-event-actor">
                    نفّذه: {event.actor}
                  </span>
                )}
                {event.reason && (
                  <p className="archive-event-reason">
                    <b>السبب: </b>
                    {event.reason}
                  </p>
                )}
                {event.detail && (
                  <p className="archive-event-detail">{event.detail}</p>
                )}
                {(event.previousDueAt || event.newDueAt) && (
                  <div className="archive-event-dates">
                    <span>الموعد السابق: {dateTime(event.previousDueAt)}</span>
                    <span>الموعد بعد التمديد: {dateTime(event.newDueAt)}</span>
                  </div>
                )}
              </li>
            ))}
          </ol>
        </details>
      )}
      <BroadcastArchive orderId={order.id} />
    </section>
  );
}
