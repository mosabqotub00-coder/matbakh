import { useEffect, useRef, useState } from "react";
import {
  Mic,
  MicOff,
  Radio,
  Volume2,
  Square,
  Archive,
  AlertCircle,
} from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { useBranch } from "@/contexts/BranchContext";
import {
  base64ToBytes,
  bytesToBase64,
  createBroadcastPlayback,
  openMicrophone,
} from "@/lib/broadcast-client";
import { dateTime, ticketLabel } from "@/lib/kitchen-ui";
import "@/communications.css";

type Microphone = Awaited<ReturnType<typeof openMicrophone>>;
type Playback = Awaited<ReturnType<typeof createBroadcastPlayback>>;

export default function Communications() {
  const { branchId } = useBranch();
  const user = trpc.auth.me.useQuery().data;
  const utils = trpc.useUtils();
  const pushAudio = trpc.communications.pushAudio.useMutation();
  const startBroadcast = trpc.communications.start.useMutation();
  const endBroadcast = trpc.communications.end.useMutation();
  const markListened = trpc.communications.markListened.useMutation();
  const api = {
    communications: {
      pushAudio: { mutate: pushAudio.mutateAsync },
      start: { mutate: startBroadcast.mutateAsync },
      end: { mutate: endBroadcast.mutateAsync },
      markListened: { mutate: markListened.mutateAsync },
      audioChunks: { query: utils.communications.audioChunks.fetch },
    },
  };
  const orders = trpc.orders.monitor.useQuery(
    { branchId: branchId ?? undefined },
    { enabled: Boolean(branchId && user?.canBroadcast), refetchInterval: 10000 }
  );
  const list = trpc.communications.list.useQuery(
    { branchId: branchId ?? undefined },
    { enabled: Boolean(user && branchId), refetchInterval: 2000 }
  );
  const [targetSection, setTargetSection] = useState<"station" | "kitchen">(
    "kitchen"
  );
  const [title, setTitle] = useState("");
  const [orderId, setOrderId] = useState("");
  const [sendingId, setSendingId] = useState<number | null>(null);
  const [listeningId, setListeningId] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const microphone = useRef<Microphone | null>(null);
  const playback = useRef<Playback | null>(null);
  const queue = useRef<Array<{ sequence: number; data: string }>>([]);
  const nextSequence = useRef(0);
  const uploading = useRef(false);
  const currentSending = useRef<number | null>(null);
  const listenerEpoch = useRef(0);
  const mounted = useRef(true);
  const captureAllowed = useRef(false);
  const pendingStart = useRef<Promise<{ id: number }> | null>(null);
  const finishing = useRef<Promise<void> | null>(null);
  const [connectionError, setConnectionError] = useState<string | null>(null);

  const drain = async () => {
    if (uploading.current || !currentSending.current) return;
    uploading.current = true;
    try {
      while (queue.current.length && currentSending.current) {
        const packet = queue.current[0];
        await api.communications.pushAudio.mutate({
          id: currentSending.current,
          ...packet,
        });
        queue.current.shift();
        if (mounted.current) setConnectionError(null);
      }
    } catch (error) {
      if (mounted.current)
        setConnectionError(
          error instanceof Error ? error.message : "تعذر إرسال الصوت."
        );
    } finally {
      uploading.current = false;
    }
  };

  async function stopSending(notify = true) {
    if (finishing.current) return finishing.current;
    const work = (async () => {
      await Promise.resolve();
      if (mounted.current) setBusy(true);
      try {
        const started = currentSending.current
          ? null
          : await pendingStart.current?.catch(() => null);
        const id = currentSending.current ?? started?.id;
        if (id) currentSending.current = id;
        await microphone.current?.close();
        microphone.current = null;
        captureAllowed.current = false;
        if (!id) return;
        for (
          let attempt = 0;
          attempt < 50 && (queue.current.length || uploading.current);
          attempt++
        ) {
          await drain();
          await new Promise(resolve => setTimeout(resolve, 100));
        }
        if (notify && mounted.current && queue.current.length)
          toast.warning("حُفظ الصوت المستلم؛ بعض الدفعات لم تصل بسبب الاتصال.");
        await api.communications.end.mutate({ id });
        if (notify && mounted.current)
          toast.success("انتهى البث وحُفظ تسجيله.");
      } catch (error) {
        if (notify && mounted.current)
          toast.error(
            error instanceof Error
              ? error.message
              : "تعذر إنهاء البث؛ الصوت المستلم محفوظ."
          );
      } finally {
        currentSending.current = null;
        pendingStart.current = null;
        queue.current = [];
        finishing.current = null;
        if (mounted.current) {
          setSendingId(null);
          setBusy(false);
          setSeconds(0);
          void list.refetch();
        }
      }
    })();
    finishing.current = work;
    return work;
  }

  async function startSending() {
    if (!branchId || busy || currentSending.current) return;
    setBusy(true);
    setConnectionError(null);
    let capture: Microphone | null = null;
    try {
      nextSequence.current = 0;
      queue.current = [];
      captureAllowed.current = true;
      capture = await openMicrophone(packet => {
        if (!captureAllowed.current) return;
        if (queue.current.length >= 12) {
          setConnectionError(
            "الاتصال بطيء؛ أوقف البث وأعد المحاولة كي لا يتأخر الصوت."
          );
          return;
        }
        queue.current.push({
          sequence: nextSequence.current++,
          data: bytesToBase64(packet),
        });
        void drain();
      });
      if (!mounted.current) {
        await capture.close();
        captureAllowed.current = false;
        return;
      }
      microphone.current = capture;
      pendingStart.current = api.communications.start.mutate({
        branchId,
        targetSection,
        title: title.trim() || "بث مباشر للقسم",
        orderId: orderId ? Number(orderId) : undefined,
      });
      const result = await pendingStart.current;
      currentSending.current = result.id;
      if (!mounted.current) {
        await stopSending(false);
        return;
      }
      void drain();
      setSendingId(result.id);
      microphone.current = capture;
      setSeconds(0);
      toast.success("بدأ البث؛ صوتك ينقل الآن ويُسجّل.");
      void list.refetch();
    } catch (error) {
      await capture?.close();
      captureAllowed.current = false;
      pendingStart.current = null;
      queue.current = [];
      if (mounted.current)
        toast.error(
          error instanceof Error
            ? error.message
            : "تعذر فتح الميكروفون أو بدء البث."
        );
    } finally {
      if (mounted.current) setBusy(false);
    }
  }

  async function stopListening() {
    listenerEpoch.current++;
    await playback.current?.close();
    playback.current = null;
    setListeningId(null);
  }
  async function listen(id: number) {
    await stopListening();
    try {
      const player = await createBroadcastPlayback();
      playback.current = player;
      const initial = await api.communications.audioChunks.query({
        id,
        afterSequence: -1,
      });
      // Start at the current live edge instead of replaying minutes of old live audio.
      let lastSequence = initial.totalChunks - 1;
      const epoch = ++listenerEpoch.current;
      setListeningId(id);
      setConnectionError(null);
      const poll = async () => {
        if (epoch !== listenerEpoch.current) return;
        try {
          const result = await api.communications.audioChunks.query({
            id,
            afterSequence: lastSequence,
          });
          if (epoch !== listenerEpoch.current) return;
          for (const chunk of result.chunks) {
            await player.append(base64ToBytes(chunk.data), result.sampleRate);
            lastSequence = chunk.sequence;
          }
          if (
            result.status !== "live" &&
            lastSequence >= result.totalChunks - 1
          ) {
            await api.communications.markListened.mutate({ id });
            toast.info("انتهى البث، والتسجيل محفوظ في الأرشيف.");
            // Let scheduled audio finish before releasing the playback context.
            setTimeout(
              () => {
                if (epoch === listenerEpoch.current) void stopListening();
              },
              Math.max(1500, player.remainingMs() + 100)
            );
            return;
          }
          if (mounted.current) setConnectionError(null);
        } catch (error) {
          setConnectionError(
            error instanceof Error ? error.message : "تعذر استقبال الصوت."
          );
        }
        if (epoch === listenerEpoch.current) setTimeout(() => void poll(), 500);
      };
      void poll();
    } catch (error) {
      await stopListening();
      toast.error(error instanceof Error ? error.message : "تعذر تشغيل الصوت.");
    }
  }

  useEffect(() => {
    if (!sendingId) return;
    const timer = window.setInterval(() => {
      setSeconds(value => value + 1);
      void drain();
    }, 1000);
    return () => window.clearInterval(timer);
  }, [sendingId]);
  useEffect(() => {
    if (seconds >= 10 * 60 && sendingId) void stopSending();
  }, [seconds, sendingId]);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      void stopSending(false);
      listenerEpoch.current++;
      void playback.current?.close();
    };
  }, []);
  useEffect(() => {
    if (currentSending.current) void stopSending();
    void stopListening();
  }, [branchId]);

  const active = list.data?.filter(item => item.status === "live") ?? [];
  const archived = list.data?.filter(item => item.status !== "live") ?? [];
  return (
    <div className="communications-page">
      <section className="page-heading">
        <div>
          <div className="eyebrow">تواصل الأقسام</div>
          <h1>بث مباشر ومسجّل</h1>
          <p>صوت باتجاه واحد أثناء الكلام، ثم تسجيل محفوظ للرجوع إليه.</p>
        </div>
        <div className="heading-badge">
          <Radio size={16} /> {active.length} بث مباشر
        </div>
      </section>
      <div className="broadcast-permission-note">
        <AlertCircle size={18} />
        <p>
          الاستقبال الحي يحتاج صفحة مفتوحة وزر تفعيل الصوت. إشعار الهاتف المقفل
          لا يضمن تشغيل البث تلقائيًا. جميع عمليات البث مُسجّلة، والحد عشر
          دقائق.
        </p>
      </div>
      {user?.canBroadcast && (
        <section className="panel broadcast-compose">
          <div className="section-heading">
            <Mic size={20} />
            <div>
              <h2>تحدث إلى قسم</h2>
              <p>ضمن الفرع المحدد في الشريط العلوي</p>
            </div>
          </div>
          <div className="broadcast-fields">
            <label>
              القسم
              <select
                value={targetSection}
                disabled={Boolean(sendingId)}
                onChange={event =>
                  setTargetSection(event.target.value as "station" | "kitchen")
                }
              >
                <option value="kitchen">المطبخ</option>
                <option value="station">السخان</option>
              </select>
            </label>
            <label>
              عنوان مختصر
              <input
                value={title}
                disabled={Boolean(sendingId)}
                onChange={event => setTitle(event.target.value)}
                maxLength={160}
                placeholder="مثال: تنسيق تجهيز طلبات الوردية"
              />
            </label>
            <label>
              ربط بتذكرة — اختياري
              <select
                value={orderId}
                disabled={Boolean(sendingId)}
                onChange={event => setOrderId(event.target.value)}
              >
                <option value="">بث عام للقسم</option>
                {orders.data?.map(order => (
                  <option key={order.id} value={order.id}>
                    {ticketLabel(order)} —{" "}
                    {order.items.map(item => item.productName).join("، ")}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="broadcast-send-actions">
            {sendingId ? (
              <>
                <span className="broadcast-recording">
                  <span /> يُبث ويُسجّل الآن — {Math.floor(seconds / 60)}:
                  {String(seconds % 60).padStart(2, "0")}
                </span>
                <button
                  className="broadcast-stop"
                  disabled={busy}
                  onClick={() => void stopSending()}
                >
                  <Square size={16} /> إنهاء وحفظ
                </button>
              </>
            ) : (
              <button
                className="primary-action"
                disabled={
                  busy ||
                  !branchId ||
                  (Boolean(orderId) &&
                    (!Number.isSafeInteger(Number(orderId)) ||
                      Number(orderId) <= 0))
                }
                onClick={() => void startSending()}
              >
                <Mic size={16} /> {busy ? "فتح الميكروفون…" : "ابدأ التحدث"}
              </button>
            )}
          </div>
        </section>
      )}
      {connectionError && (
        <div className="broadcast-error" role="alert">
          {connectionError}
        </div>
      )}
      <section className="panel">
        <div className="section-heading">
          <Radio size={20} />
          <h2>البث الجاري للقسم</h2>
        </div>
        {list.isError ? (
          <div className="empty-state">
            تعذر الاتصال.{" "}
            <button onClick={() => void list.refetch()}>إعادة المحاولة</button>
          </div>
        ) : active.length ? (
          <div className="broadcast-cards">
            {active.map(item => (
              <article className="broadcast-card live" key={item.id}>
                <div>
                  <span className="broadcast-live-label">مباشر · مسجّل</span>
                  <h3>{item.title}</h3>
                  <p>
                    {item.senderName} →{" "}
                    {item.targetSection === "kitchen" ? "المطبخ" : "السخان"}
                  </p>
                  <small>{dateTime(item.startedAt)}</small>
                </div>
                {item.senderId === user?.id ? (
                  <span>بثك الحالي</span>
                ) : listeningId === item.id ? (
                  <button
                    className="secondary-action"
                    onClick={() => void stopListening()}
                  >
                    <MicOff size={16} /> إيقاف الاستماع
                  </button>
                ) : (
                  <button
                    className="primary-action"
                    onClick={() => void listen(item.id)}
                  >
                    <Volume2 size={16} /> استمع الآن
                  </button>
                )}
              </article>
            ))}
          </div>
        ) : (
          <div className="empty-state">لا يوجد بث جارٍ لهذا الفرع/القسم.</div>
        )}
      </section>
      <section className="panel">
        <div className="section-heading">
          <Archive size={20} />
          <h2>تسجيلات التواصل</h2>
          <span className="count-badge">{archived.length}</span>
        </div>
        {archived.length ? (
          <div className="broadcast-cards">
            {archived.map(item => (
              <article className="broadcast-card" key={item.id}>
                <div>
                  <h3>{item.title}</h3>
                  <p>
                    {item.senderName} ·{" "}
                    {item.targetSection === "kitchen" ? "المطبخ" : "السخان"} ·{" "}
                    {item.status === "interrupted"
                      ? "انقطع البث؛ الصوت المستلم محفوظ"
                      : "انتهى البث"}
                  </p>
                  <small>
                    {dateTime(item.startedAt)}
                    {item.orderId != null
                      ? ` · تذكرة ${ticketLabel({ id: item.orderId, orderCode: item.orderCode })}`
                      : " · بث عام"}
                  </small>
                </div>
                {item.totalBytes ? (
                  <audio
                    controls
                    preload="none"
                    src={`/api/communications/${item.id}/recording.wav`}
                    onPlay={() =>
                      void api.communications.markListened.mutate({
                        id: item.id,
                      })
                    }
                  />
                ) : (
                  <span>لا صوت محفوظ</span>
                )}
              </article>
            ))}
          </div>
        ) : (
          <div className="empty-state">
            ستظهر التسجيلات هنا بعد انتهاء البث.
          </div>
        )}
      </section>
    </div>
  );
}
