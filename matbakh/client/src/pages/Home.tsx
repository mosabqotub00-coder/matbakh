import { useEffect, useMemo, useState } from "react";
import {
  Archive,
  Check,
  Clock3,
  Flame,
  Minus,
  Plus,
  Search,
  Send,
  ShoppingBasket,
  Soup,
  Timer,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import VoiceNoteRecorder from "@/components/VoiceNoteRecorder";
import VoiceNotePlayer from "@/components/VoiceNotePlayer";
import ArchiveOrderNotes from "@/components/ArchiveOrderNotes";
import { useBranch } from "@/contexts/BranchContext";
import {
  clock,
  dateTime,
  elapsedSeconds,
  completionInfo,
  deliverySeconds,
  STATUS_LABEL,
  ticketLabel,
  type KitchenOrder,
  type Product,
} from "@/lib/kitchen-ui";
import { canOpenPath, type StaffClientUser } from "@/components/AuthViews";

function useNow() {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);
  return now;
}
function OrderCard({
  order,
  now,
  canReceive,
  onReceive,
}: {
  order: KitchenOrder;
  now: number;
  canReceive: boolean;
  onReceive: () => void;
}) {
  const completed = order.status === "ready" || order.status === "received";
  const phase =
    order.status === "preparing" ? order.acceptedAt : order.createdAt;
  const completion = completionInfo(order);
  const delivery = deliverySeconds(order);
  return (
    <article className="station-order">
      <div className="station-order-head">
        <div>
          <span className={`status-pill ${order.status}`}>
            <i />
            {STATUS_LABEL[order.status]}
          </span>
          <strong className="order-code">{ticketLabel(order)}</strong>
          {completed && order.everOverdue && (
            <span className="v2-ever-overdue" data-testid={`station-order-overdue-${order.id}`}>كان متأخرًا</span>
          )}
        </div>
        {completed ? (
          <div className="completion-stamp">
            <span>
              <Check size={14} /> {completion.label}
            </span>
            <strong>{completion.value}</strong>
          </div>
        ) : (
          <div className="timer-chip">
            <Clock3 size={14} /> {clock(elapsedSeconds(phase, now))}
            <small>منذ المرحلة</small>
          </div>
        )}
      </div>
      <div className="station-order-items">
        {order.items.map(item => (
          <span key={item.id}>
            {item.quantity} × {item.productName}
          </span>
        ))}
      </div>
      {completed && (
        <div className="completion-details">
          {order.status === "received" && (
            <span>جهزت في: {dateTime(order.readyAt)}</span>
          )}
          {order.status === "ready" && (
            <span>بانتظار تأكيد الاستلام من السخان</span>
          )}
          {delivery != null && (
            <span>
              مدة التسليم النهائية: <b>{clock(delivery)}</b>
            </span>
          )}
        </div>
      )}
      {completed ? (
        <ArchiveOrderNotes order={order} />
      ) : (
        <>
          {order.notes && (
            <p className="order-note">
              <span>ملاحظة</span>
              {order.notes}
            </p>
          )}
          {order.voiceAvailable && <VoiceNotePlayer orderId={order.id} />}
        </>
      )}
      <div className="station-order-foot">
        <span>أُرسل {dateTime(order.createdAt)}</span>
        {order.status === "ready" && canReceive ? (
          <button
            className="primary-action v2-touch-button"
            onClick={onReceive}
          >
            <Check size={14} /> تأكيد الاستلام
          </button>
        ) : (
          <span>
            {order.status === "received"
              ? `استلمها ${order.receivedByName ?? "السخان"}`
              : ""}
          </span>
        )}
      </div>
    </article>
  );
}
function Column({
  title,
  subtitle,
  status,
  orders,
  now,
  canReceive,
  onReceive,
}: {
  title: string;
  subtitle: string;
  status: "new" | "preparing" | "ready";
  orders: KitchenOrder[];
  now: number;
  canReceive: boolean;
  onReceive: (id: number) => void;
}) {
  return (
    <section className={`station-status-column ${status}`}>
      <div className="station-status-heading">
        <div>
          <span className={`status-pill ${status}`}>
            <i />
            {STATUS_LABEL[status]}
          </span>
          <h3>{title}</h3>
          <p>{subtitle}</p>
        </div>
        <strong>{orders.length}</strong>
      </div>
      <div className="station-orders-list">
        {orders.length ? (
          orders.map(order => (
            <OrderCard
              key={order.id}
              order={order}
              now={now}
              canReceive={canReceive}
              onReceive={() => onReceive(order.id)}
            />
          ))
        ) : (
          <div className="station-column-empty">
            <Check size={17} />
            <span>لا توجد طلبات هنا</span>
          </div>
        )}
      </div>
    </section>
  );
}

export default function Home() {
  const { branchInput } = useBranch();
  const user = trpc.auth.me.useQuery(undefined, { retry: false }).data as
    | StaffClientUser
    | null
    | undefined;
  const now = useNow();
  const utils = trpc.useUtils();
  const [cart, setCart] = useState<Record<number, number>>({});
  const [notes, setNotes] = useState("");
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("");
  const [voiceNote, setVoiceNote] = useState<Blob | null>(null);
  const [tab, setTab] = useState<"open" | "history">("open");
  const [historyPage, setHistoryPage] = useState(0);
  const productsApi = trpc.products as any;
  const ordersApi = trpc.orders as any;
  const products = productsApi.list.useQuery(branchInput, {
    refetchInterval: 15000,
  }) as { data?: Product[]; isLoading: boolean; isError: boolean };
  const active = ordersApi.station.useQuery(branchInput, {
    refetchInterval: 4000,
  }) as { data?: KitchenOrder[]; isLoading: boolean };
  const history = ordersApi.stationHistory.useQuery(
    { ...(branchInput ?? {}), limit: 20, offset: historyPage * 20 },
    { enabled: tab === "history", refetchInterval: 15000 }
  ) as { data?: { orders: KitchenOrder[]; total: number }; isLoading: boolean };
  const create = ordersApi.create.useMutation({
    onSuccess: (result: any) => {
      setCart({});
      setNotes("");
      setVoiceNote(null);
      void utils.orders.station.invalidate();
      void utils.orders.kitchen.invalidate();
      toast.success(
        result.orders?.length === 1
          ? `تم إرسال الطلب ${ticketLabel(result.orders[0])}`
          : "تم إرسال الطلبات المستقلة للمطبخ"
      );
    },
    onError: (error: Error) => toast.error(error.message),
  });
  const receive = ordersApi.receive?.useMutation?.({
    onSuccess: () => {
      void utils.orders.station.invalidate();
      void utils.orders.stationHistory.invalidate();
      toast.success("تم تأكيد استلام الطلب");
    },
    onError: (error: Error) => toast.error(error.message),
  });
  const selected = Object.entries(cart).filter(([, quantity]) => quantity > 0);
  const categories = useMemo(
    () => [...new Set((products.data ?? []).map(product => product.category))],
    [products.data]
  );
  const visible = (products.data ?? []).filter(
    product =>
      (!category || product.category === category) &&
      product.name
        .toLocaleLowerCase("ar")
        .includes(search.trim().toLocaleLowerCase("ar"))
  );
  const adjust = (id: number, delta: number) =>
    setCart(prev => ({
      ...prev,
      [id]: Math.min(99, Math.max(0, (prev[id] ?? 0) + delta)),
    }));
  async function sendOrder() {
    let voiceData: string | undefined;
    let voiceType: string | undefined;
    if (voiceNote) {
      const bytes = new Uint8Array(await voiceNote.arrayBuffer());
      let binary = "";
      for (let i = 0; i < bytes.length; i += 0x8000)
        binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      voiceData = btoa(binary);
      voiceType = voiceNote.type.split(";")[0];
    }
    create.mutate({
      ...(branchInput ?? {}),
      items: selected.map(([productId, quantity]) => ({
        productId: Number(productId),
        quantity,
      })),
      notes,
      voiceData,
      voiceType,
    });
  }
  const canReceive = Boolean(
    (user &&
      ["station", "kitchen_manager", "system_admin", "branch_manager"].includes(
        user.role ?? ""
      )) ||
      user?.canStation
  );
  return (
    <div className="station-page">
      <section className="page-heading">
        <div>
          <div className="eyebrow">
            <span className="eyebrow-line" /> محطة السخان{" "}
            <span className="eyebrow-sep">/</span> إرسال داخلي
          </div>
          <h1>جهّز طلب المطبخ</h1>
          <p>كل صنف يُرسل كتذكرة مستقلة، مع متابعة الجاهز والاستلام.</p>
        </div>
        <div className="heading-badge">
          <Flame size={16} /> محطة السخان
        </div>
      </section>
      <div className="station-layout">
        <section className="panel menu-panel">
          <div className="section-heading">
            <div className="section-icon green">
              <Soup size={18} />
            </div>
            <div>
              <h2>الأصناف المتاحة</h2>
              <p>اضغط + لإضافة الصنف</p>
            </div>
            <span className="count-badge">
              {products.data?.length ?? 0} أصناف
            </span>
          </div>
          <div className="station-product-filters">
            <div className="search-box">
              <Search size={16} />
              <input
                aria-label="البحث عن صنف"
                value={search}
                onChange={event => setSearch(event.target.value)}
                placeholder="ابحث عن صنف…"
              />
            </div>
            <select
              value={category}
              onChange={event => setCategory(event.target.value)}
              aria-label="فئة الصنف"
            >
              <option value="">كل الفئات</option>
              {categories.map(item => (
                <option key={item}>{item}</option>
              ))}
            </select>
          </div>
          {products.isLoading ? (
            <div className="empty-state">جارٍ تحميل الأصناف…</div>
          ) : products.isError ? (
            <div className="empty-state">تعذر تحميل الأصناف.</div>
          ) : (
            <div className="product-list">
              {visible.map(product => (
                <div
                  className={`product-row ${cart[product.id] ? "chosen" : ""}`}
                  key={product.id}
                >
                  <div className="product-thumb">
                    <Soup size={20} />
                  </div>
                  <div className="product-info">
                    <strong>{product.name}</strong>
                    <span>
                      {product.category} <i /> {product.hasTimer ? (
                        <><Timer size={12} /> {product.prepMinutes} د</>
                      ) : (
                        <span className="fast-product-label">بدون مؤقت · مباشر</span>
                      )}
                    </span>
                  </div>
                  {cart[product.id] ? (
                    <div className="quantity-stepper">
                      <button
                        onClick={() => adjust(product.id, -1)}
                        aria-label="تقليل"
                      >
                        <Minus size={14} />
                      </button>
                      <b>{cart[product.id]}</b>
                      <button
                        onClick={() => adjust(product.id, 1)}
                        aria-label="زيادة"
                      >
                        <Plus size={14} />
                      </button>
                    </div>
                  ) : (
                    <button
                      className="add-product"
                      onClick={() => adjust(product.id, 1)}
                    >
                      <Plus size={16} /> إضافة
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>
        <section className="panel compose-panel">
          <div className="section-heading">
            <div className="section-icon amber">
              <ShoppingBasket size={18} />
            </div>
            <div>
              <h2>الطلب الحالي</h2>
              <p>كل صنف كتذكرة مستقلة</p>
            </div>
          </div>
          {selected.length ? (
            <div className="cart-items">
              {selected.map(([id, quantity]) => {
                const product = products.data?.find(
                  item => item.id === Number(id)
                );
                return (
                  product && (
                    <div className="cart-line" key={id}>
                      <span>
                        <b>{quantity}×</b> {product.name}
                      </span>
                      <button
                        onClick={() =>
                          setCart(prev => {
                            const next = { ...prev };
                            delete next[Number(id)];
                            return next;
                          })
                        }
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>
                  )
                );
              })}
            </div>
          ) : (
            <div className="cart-empty">
              <ShoppingBasket size={25} />
              <span>لم تتم إضافة أصناف بعد</span>
            </div>
          )}
          <label className="field-label">
            ملاحظة نصية للمطبخ
            <textarea
              className="notes-input"
              value={notes}
              onChange={event => setNotes(event.target.value)}
              maxLength={1000}
              placeholder="مثال: بدون بهارات…"
            />
          </label>
          <VoiceNoteRecorder value={voiceNote} onChange={setVoiceNote} />
          <button
            className="primary-action submit-order"
            disabled={!selected.length || create.isPending}
            onClick={() => void sendOrder()}
          >
            <Send size={17} />
            {create.isPending ? "جارٍ الإرسال…" : "إرسال الطلبات للمطبخ"}
          </button>
        </section>
      </div>
      <section className="open-orders-section">
        <div className="section-heading wide">
          <div className="section-icon blue">
            <Clock3 size={18} />
          </div>
          <div>
            <h2>طلبات قيد المتابعة</h2>
            <p>انتظر القبول ثم الجاهزية والاستلام.</p>
          </div>
        </div>
        <div className="station-order-tabs">
          <button
            className={tab === "open" ? "selected" : ""}
            onClick={() => setTab("open")}
          >
            <Clock3 size={15} /> مفتوح{" "}
            <span>
              {active.data?.filter(order => order.status !== "received")
                .length ?? 0}
            </span>
          </button>
          <button
            className={tab === "history" ? "selected" : ""}
            onClick={() => {
              setTab("history");
              setHistoryPage(0);
            }}
          >
            <Archive size={15} /> الأرشيف{" "}
            <span>{history.data?.total ?? 0}</span>
          </button>
        </div>
        {tab === "open" ? (
          <div className="station-status-columns">
            <Column
              status="new"
              title="طلبات جديدة"
              subtitle="تنتظر استلام المطبخ"
              orders={(active.data ?? []).filter(
                order => order.status === "new"
              )}
              now={now}
              canReceive={false}
              onReceive={() => undefined}
            />
            <Column
              status="preparing"
              title="قيد التحضير"
              subtitle="بدأ المطبخ العمل"
              orders={(active.data ?? []).filter(
                order => order.status === "preparing"
              )}
              now={now}
              canReceive={false}
              onReceive={() => undefined}
            />
            <Column
              status="ready"
              title="جاهز للاستلام"
              subtitle="بانتظار تأكيد السخان"
              orders={(active.data ?? []).filter(
                order => order.status === "ready"
              )}
              now={now}
              canReceive={canReceive}
              onReceive={id => receive?.mutate({ orderId: id })}
            />
          </div>
        ) : history.isLoading ? (
          <div className="empty-state">جارٍ تحميل الأرشيف…</div>
        ) : (
          <div className="station-orders-grid">
            {(history.data?.orders ?? []).map(order => (
              <OrderCard
                key={order.id}
                order={order}
                now={now}
                canReceive={false}
                onReceive={() => undefined}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
