import { useEffect, useState } from "react";
import {
  BellRing,
  Check,
  ChefHat,
  Clock3,
  CookingPot,
  Flame,
  History,
  Plus,
  TimerReset,
} from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { useBranch } from "@/contexts/BranchContext";
import {
  clock,
  completionInfo,
  dateTime,
  dueAt,
  deliverySeconds,
  effectiveRemainingSeconds,
  elapsedSeconds,
  graceDueAt,
  isOverdue,
  maxPrepSeconds,
  remainingSeconds,
  sourceLabel,
  STATUS_LABEL,
  ticketLabel,
  type KitchenOrder,
} from "@/lib/kitchen-ui";
import VoiceNotePlayer from "@/components/VoiceNotePlayer";
import { type StaffClientUser } from "@/components/AuthViews";

function useNow() {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);
  return now;
}
function ExtensionBox({
  order,
  canExtend,
  onExtend,
}: {
  order: KitchenOrder;
  canExtend: boolean;
  onExtend: (minutes: number, reason: string) => void;
}) {
  const [minutes, setMinutes] = useState(5);
  const [reason, setReason] = useState("");
  const [open, setOpen] = useState(false);
  if (!canExtend) return null;
  return (
    <div className="v2-extension-history">
      <button
        className="secondary-action"
        type="button"
        onClick={() => setOpen(value => !value)}
      >
        <Plus size={13} /> تمديد المهلة
      </button>
      {open && (
        <form
          onSubmit={event => {
            event.preventDefault();
            if (!reason.trim()) return toast.error("سبب التمديد إلزامي.");
            onExtend(minutes, reason.trim());
            setReason("");
            setOpen(false);
          }}
        >
          <div className="minutes-input">
            <input
              type="number"
              min={1}
              max={240}
              value={minutes}
              onChange={event => setMinutes(Number(event.target.value))}
            />
            <b>دقيقة</b>
          </div>
          <input
            required
            maxLength={240}
            value={reason}
            onChange={event => setReason(event.target.value)}
            placeholder="السبب الإلزامي للتمديد"
          />
          <button className="primary-action" type="submit">
            حفظ التمديد
          </button>
        </form>
      )}
    </div>
  );
}
function Timing({ order, now }: { order: KitchenOrder; now: number }) {
  const hasTimer = order.items.every(item => item.hasTimer !== false);
  if (!hasTimer)
    return (
      <div className="v2-timing">
        <div className="v2-timing-row">
          <span>نوع الطلب</span>
          <strong>طلب مباشر — بدون مؤقت</strong>
        </div>
      </div>
    );
  const due = dueAt(order);
  const grace = graceDueAt(order);
  const effective = effectiveRemainingSeconds(order, now);
  const fixedDeliverySeconds = deliverySeconds(order);
  const prepFrozen =
    order.acceptedAt && order.readyAt
      ? elapsedSeconds(order.acceptedAt, new Date(order.readyAt).getTime())
      : null;
  if (order.status === "new")
    return (
      <div className="v2-timing">
        <div className="v2-timing-row">
          <span>حالة الانتظار</span>
          <strong>بانتظار الاستلام</strong>
        </div>
      </div>
    );
  if (order.status === "preparing")
    return (
      <div className="v2-timing">
        <div className="v2-timing-row">
          <span>المتبقي الفعلي</span>
          <strong className={effective < 0 ? "v2-timing-row late" : ""}>
            {effective < 0 ? `+${clock(-effective)}` : clock(effective)}
          </strong>
        </div>
        <div className="v2-timing-row grace">
          <span>السماح حتى</span>
          <strong>{grace ? dateTime(grace) : "—"}</strong>
        </div>
        <div className="v2-timing-row">
          <span>الموعد الفعلي</span>
          <strong>{due ? dateTime(due) : "—"}</strong>
        </div>
        {order.extensionMinutes ? (
          <div className="v2-timing-row">
            <span>إضافي محفوظ</span>
            <strong>+{order.extensionMinutes} د</strong>
          </div>
        ) : null}
      </div>
    );
  return (
    <div className="v2-timing">
      <div className="v2-timing-row">
        <span>زمن التحضير الثابت</span>
        <strong>{prepFrozen == null ? "—" : clock(prepFrozen)}</strong>
      </div>
      <div className="v2-timing-row">
        <span>جهزت في</span>
        <strong>{dateTime(order.readyAt)}</strong>
      </div>
      {order.status === "received" && (
        <div className="v2-timing-row">
          <span>زمن التسليم</span>
          <strong>
            {fixedDeliverySeconds == null ? "—" : clock(fixedDeliverySeconds)}
          </strong>
        </div>
      )}
      {order.status === "received" && (
        <div className="v2-timing-row">
          <span>استُلم</span>
          <strong>{dateTime(order.receivedAt)}</strong>
        </div>
      )}
    </div>
  );
}
function Ticket({
  order,
  now,
  canTransition,
  canReceive,
  canExtend,
  transition,
  receive,
  extend,
}: {
  order: KitchenOrder;
  now: number;
  canTransition: boolean;
  canReceive: boolean;
  canExtend: boolean;
  transition: (nextStatus: "preparing" | "ready") => void;
  receive: () => void;
  extend: (minutes: number, reason: string) => void;
}) {
  const late = isOverdue(order, now);
  const completion =
    order.status === "ready" || order.status === "received"
      ? completionInfo(order)
      : null;
  return (
    <article className={`ticket ${late ? "overdue" : ""}`}>
      <div className="ticket-top">
        <div className="ticket-code">
          <span className="ticket-type">
            {order.status === "new" ? (
              <Flame size={12} />
            ) : order.status === "preparing" ? (
              <CookingPot size={12} />
            ) : (
              <Check size={12} />
            )}
            {order.status === "new"
              ? "من السخان"
              : order.status === "preparing"
                ? "قيد التنفيذ"
                : "جاهز للتسليم"}
          </span>
          <strong>{ticketLabel(order)}</strong>
        </div>
        <span className={`status-pill ${order.status}`}>
          <i />
          {STATUS_LABEL[order.status]}
        </span>
      </div>
      <div className="ticket-time">
        {completion ? (
          <div className="completion-stamp">
            <Clock3 size={17} />
            <div className="completion-details">
              <strong>{completion.value}</strong>
              <span>{completion.label}</span>
            </div>
          </div>
        ) : (
          <>
            <div className="timer-large">
              <Clock3 size={17} />
              <strong>
                {clock(
                  elapsedSeconds(
                    order.status === "preparing"
                      ? order.acceptedAt
                      : order.createdAt,
                    now
                  )
                )}
              </strong>
            </div>
            <span>
              {order.status === "new" ? "وقت الانتظار" : "منذ القبول"}
            </span>
          </>
        )}
      </div>
      <Timing order={order} now={now} />
      <div className="ticket-items">
        {order.items.map(item => (
          <div className="ticket-item" key={item.id}>
            <span>
              <b>{String(item.quantity).padStart(2, "0")}</b>
              {item.productName}
            </span>
            <small>{item.hasTimer === false ? "مباشر" : `${item.prepMinutes} د`}</small>
          </div>
        ))}
      </div>
      {Boolean(
        (order.orderSource ?? order.source) &&
          (order.orderSource ?? order.source) !== "internal"
      ) && (
        <span className="v2-source-badge">
          {sourceLabel(order)}
          {order.createdByName ? ` · ${order.createdByName}` : ""}
        </span>
      )}
      {order.notes && (
        <div className="ticket-note">
          <span>ملاحظة السخان</span>
          <p>{order.notes}</p>
        </div>
      )}
      {order.voiceAvailable && <VoiceNotePlayer orderId={order.id} />}
      <div className="ticket-meta">
        <span>وقت الإرسال</span>
        <strong>{dateTime(order.createdAt)}</strong>
      </div>
      {order.acceptedAt && (
        <div className="ticket-meta">
          <span>قبله</span>
          <strong>
            {order.acceptedByName ?? "المطبخ"} · {dateTime(order.acceptedAt)}
          </strong>
        </div>
      )}
      <ExtensionBox
        order={order}
        canExtend={canExtend && order.status === "preparing"}
        onExtend={extend}
      />
      {canTransition &&
        order.status !== "ready" &&
        order.status !== "received" && (
          <button
            className={`ticket-action ${order.status === "new" ? "accept" : "ready"}`}
            onClick={() =>
              transition(order.status === "new" ? "preparing" : "ready")
            }
          >
            <>
              {order.status === "new" ? (
                <ChefHat size={16} />
              ) : (
                <Check size={16} />
              )}{" "}
              {order.status === "new" ? "استلام وبدء التحضير" : "جاهز للتسليم"}
            </>
          </button>
        )}
      {order.status === "ready" && canReceive && (
        <button className="ticket-action ready" onClick={receive}>
          <Check size={16} /> تأكيد استلام السخان
        </button>
      )}
    </article>
  );
}

export default function Kitchen() {
  const now = useNow();
  const { branchInput } = useBranch();
  const utils = trpc.useUtils();
  const user = trpc.auth.me.useQuery(undefined, { retry: false }).data as
    | StaffClientUser
    | null
    | undefined;
  const ordersApi = trpc.orders as any;
  const orders = ordersApi.kitchen.useQuery(branchInput, {
    refetchInterval: 2500,
  }) as { data?: KitchenOrder[]; isLoading: boolean };
  const transition = ordersApi.transition.useMutation({
    onSuccess: () => {
      void utils.orders.kitchen.invalidate();
      void utils.orders.station.invalidate();
      void utils.orders.history.invalidate();
    },
    onError: (error: Error) => toast.error(error.message),
  });
  const receive = ordersApi.receive?.useMutation?.({
    onSuccess: () => {
      void utils.orders.kitchen.invalidate();
      void utils.orders.station.invalidate();
      toast.success("تم تأكيد الاستلام");
    },
    onError: (error: Error) => toast.error(error.message),
  });
  const extend = ordersApi.extend?.useMutation?.({
    onSuccess: () => {
      void utils.orders.kitchen.invalidate();
      void utils.orders.monitor.invalidate();
      toast.success("تم حفظ التمديد وإضافة سببه إلى السجل");
    },
    onError: (error: Error) => toast.error(error.message),
  });
  const data = orders.data ?? [];
  const canTransition =
    ["kitchen", "kitchen_manager", "system_admin", "branch_manager"].includes(
      user?.role ?? ""
    ) || Boolean(user?.canKitchen);
  const canReceive =
    ["station", "kitchen_manager", "system_admin", "branch_manager"].includes(
      user?.role ?? ""
    ) || Boolean(user?.canStation);
  const canExtend =
    ["kitchen_manager", "system_admin"].includes(user?.role ?? "") ||
    Boolean(user?.canExtend);
  const columns = [
    {
      id: "new",
      title: "طلبات جديدة",
      subtitle: "بانتظار استلام المطبخ",
      icon: Flame,
      orders: data.filter(order => order.status === "new"),
    },
    {
      id: "preparing",
      title: "قيد التحضير",
      subtitle: "الموعد والسماح محسوبان",
      icon: CookingPot,
      orders: data.filter(order => order.status === "preparing"),
    },
    {
      id: "ready",
      title: "جاهز للتسليم",
      subtitle: "بانتظار تأكيد الاستلام",
      icon: Check,
      orders: data.filter(order => order.status === "ready"),
    },
  ];
  const lateIds = data
    .filter(order => isOverdue(order, now))
    .map(order => order.id);
  return (
    <div className="kitchen-page">
      <section className="page-heading kitchen-heading">
        <div>
          <div className="eyebrow">
            <span className="eyebrow-line" /> تشغيل مباشر{" "}
            <span className="eyebrow-sep">/</span> المطبخ
          </div>
          <h1>لوحة المطبخ</h1>
          <p>التحضير يتوقف عند الجاهزية، ويُحفظ وقتها حتى تأكيد الاستلام.</p>
        </div>
        <div className="heading-badge">
          <span className="live-dot" /> تحديث تلقائي
        </div>
      </section>
      {lateIds.length > 0 && (
        <div className="overdue-banner">
          <BellRing size={18} />
          <div>
            <strong>تنبيه: {lateIds.length} طلب متأخر</strong>
            <span>تجاوز وقت التحضير لا يُمسح من السجل حتى بعد التمديد.</span>
          </div>
        </div>
      )}
      <div className="kitchen-stats">
        <div>
          <span>بانتظار الاستلام</span>
          <strong>{columns[0].orders.length}</strong>
          <small>لم يبدأ التحضير</small>
        </div>
        <div>
          <span>قيد التحضير</span>
          <strong>{columns[1].orders.length}</strong>
          <small>عداد فعلي</small>
        </div>
        <div>
          <span>جاهزة للتسليم</span>
          <strong>{columns[2].orders.length}</strong>
          <small>بانتظار التأكيد</small>
        </div>
        <div className="stat-alert">
          <span>تجاوزت الوقت</span>
          <strong>{lateIds.length}</strong>
          <small>تحتاج متابعة</small>
        </div>
      </div>
      <section className="kanban-board">
        {columns.map(column => {
          const Icon = column.icon;
          return (
            <div className={`kanban-column ${column.id}`} key={column.id}>
              <div className="column-head">
                <div className="column-title">
                  <span className="column-icon">
                    <Icon size={16} />
                  </span>
                  <div>
                    <h2>{column.title}</h2>
                    <p>{column.subtitle}</p>
                  </div>
                </div>
                <span className="column-count">{column.orders.length}</span>
              </div>
              <div className="column-list">
                {orders.isLoading ? (
                  <div className="column-empty">جارٍ تحميل الطلبات…</div>
                ) : column.orders.length ? (
                  column.orders.map(order => (
                    <Ticket
                      key={order.id}
                      order={order}
                      now={now}
                      canTransition={canTransition}
                      canReceive={canReceive}
                      canExtend={canExtend}
                      transition={nextStatus =>
                        transition.mutate({
                          ...(branchInput ?? {}),
                          orderId: order.id,
                          nextStatus,
                        })
                      }
                      receive={() => receive?.mutate({ orderId: order.id })}
                      extend={(minutes, reason) =>
                        extend?.mutate({ orderId: order.id, minutes, reason })
                      }
                    />
                  ))
                ) : (
                  <div className="column-empty">
                    <Check size={18} />
                    <strong>لا توجد طلبات هنا</strong>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </section>
      <div className="kitchen-footer">
        <span>
          <span className="live-dot" /> متصل
        </span>
        <span>
          <TimerReset size={13} /> مدد التمديد محفوظة مع الموعد القديم والسبب
        </span>
      </div>
    </div>
  );
}
