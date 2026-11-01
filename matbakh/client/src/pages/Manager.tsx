import { useEffect, useMemo, useState, type FormEvent } from "react";
import {
  Archive,
  BellRing,
  Building2,
  CalendarDays,
  Check,
  Clock3,
  Edit3,
  PackagePlus,
  Plus,
  Search,
  TimerReset,
  Users,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import StaffAccountsPanel from "@/components/StaffAccountsPanel";
import GlobalAdministration from "@/components/GlobalAdministration";
import ArchiveOrderNotes from "@/components/ArchiveOrderNotes";
import IntegrationPanel from "@/components/IntegrationPanel";
import { useBranch } from "@/contexts/BranchContext";
import type { StaffClientUser } from "@/components/AuthViews";
import {
  clock,
  completionInfo,
  dateTime,
  deliverySeconds,
  elapsedSeconds,
  isOverdue,
  normalizeTicketSearch,
  sourceLabel,
  ticketLabel,
  type KitchenOrder,
  type Product,
} from "@/lib/kitchen-ui";

const PRODUCT_GRACE_MAX = 120;
type ProductDraft = {
  name: string;
  category: string;
  prepMinutes: number;
  graceMinutes: number;
  hasTimer: boolean;
};
type LiveStatus = "new" | "preparing" | "ready";

function useNow() {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);
  return now;
}

function ProductEditor({
  product,
  onSave,
  onCancel,
  busy,
}: {
  product?: Product;
  onSave: (value: ProductDraft) => void;
  onCancel?: () => void;
  busy: boolean;
}) {
  const [name, setName] = useState(product?.name ?? "");
  const [category, setCategory] = useState(product?.category ?? "");
  const [prepMinutes, setPrepMinutes] = useState(product?.prepMinutes ?? 10);
  const [graceMinutes, setGraceMinutes] = useState(product?.graceMinutes ?? 5);
  const [hasTimer, setHasTimer] = useState(product?.hasTimer ?? true);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedName = name.trim();
    const trimmedCategory = category.trim();
    if (!trimmedName || !trimmedCategory) {
      toast.error("اسم الصنف والفئة مطلوبان.");
      return;
    }
    if (
      !Number.isInteger(prepMinutes) ||
      prepMinutes < 0 ||
      prepMinutes > 240
    ) {
      toast.error("مدة التحضير يجب أن تكون بين 0 و240 دقيقة.");
      return;
    }
    if (!hasTimer && prepMinutes !== 0) {
      toast.error("الصنف المباشر يجب أن تكون مدة تحضيره صفرًا.");
      return;
    }
    if (
      !Number.isInteger(graceMinutes) ||
      graceMinutes < 0 ||
      graceMinutes > PRODUCT_GRACE_MAX
    ) {
      toast.error("مدة السماح يجب أن تكون بين 0 و120 دقيقة.");
      return;
    }
    onSave({
      name: trimmedName,
      category: trimmedCategory,
      prepMinutes,
      graceMinutes,
      hasTimer,
    });
  }

  return (
    <form
      className={product ? "product-edit-form" : "product-new-form"}
      onSubmit={submit}
    >
      <label>
        <span>اسم الصنف</span>
        <input
          required
          value={name}
          onChange={event => setName(event.target.value)}
        />
      </label>
      <label>
        <span>الفئة</span>
        <input
          required
          value={category}
          onChange={event => setCategory(event.target.value)}
        />
      </label>
      <label className="minutes-field">
        <span>التحضير</span>
        <input
          type="number"
          min={1}
          max={240}
          step={1}
          required
          value={prepMinutes}
          onChange={event => setPrepMinutes(Number(event.target.value))}
        />
      </label>
      <label className="minutes-field">
        <span>السماح</span>
        <input
          type="number"
          min={0}
          max={PRODUCT_GRACE_MAX}
          step={1}
          required
          value={graceMinutes}
          onChange={event => setGraceMinutes(Number(event.target.value))}
        />
      </label>
      <label className="product-timer-toggle">
        <input
          type="checkbox"
          checked={hasTimer}
          onChange={event => {
            const enabled = event.target.checked;
            setHasTimer(enabled);
            if (!enabled) {
              setPrepMinutes(0);
              setGraceMinutes(0);
            } else if (prepMinutes === 0) {
              setPrepMinutes(10);
              setGraceMinutes(5);
            }
          }}
        />
        <span>يحتاج مؤقتًا وتنبيه تأخير</span>
      </label>
      <div className="product-form-actions">
        <button
          type="submit"
          className="primary-action"
          disabled={busy || !name.trim()}
        >
          <SaveIcon />
          {product ? "حفظ" : "إضافة الصنف"}
        </button>
        {product && onCancel && (
          <button type="button" className="cancel-edit" onClick={onCancel}>
            <X size={14} /> إلغاء
          </button>
        )}
      </div>
    </form>
  );
}

function SaveIcon() {
  return <Check size={15} />;
}

function LiveCard({ order, now }: { order: KitchenOrder; now: number }) {
  const start =
    order.status === "new"
      ? order.createdAt
      : order.status === "preparing"
        ? order.acceptedAt
        : order.readyAt;
  const statusLabel =
    order.status === "new"
      ? "جديد"
      : order.status === "preparing"
        ? "قيد التحضير"
        : order.status === "received"
          ? "مستلم"
          : "جاهز";
  const phaseLabel =
    order.status === "new"
      ? "منذ الإرسال"
      : order.status === "preparing"
        ? "منذ القبول"
        : "منذ الجاهزية";
  const late = isOverdue(order, now);
  const completion =
    order.status === "ready" || order.status === "received"
      ? completionInfo(order)
      : null;
  return (
    <article className={`manager-live-order ${late ? "overdue" : ""}`}>
      <div className="manager-live-order-top">
        <div>
          <span className={`status-pill ${order.status}`}>
            <i />
            {statusLabel}
          </span>
          <strong>{ticketLabel(order)}</strong>
        </div>
        {completion ? (
          <div className="completion-stamp">
            <Clock3 size={14} />
            <div className="completion-details">
              <b>{completion.value}</b>
              <span>{completion.label}</span>
            </div>
          </div>
        ) : order.items.every(item => item.hasTimer !== false) ? (
          <div className="manager-live-timer">
            <Clock3 size={14} />
            <b>{clock(elapsedSeconds(start, now))}</b>
          </div>
        ) : (
          <span className="fast-product-label">مباشر · بدون مؤقت</span>
        )}
      </div>
      <div className="manager-live-items">
        {order.items.map(item => (
          <span key={item.id}>
            <b>{item.quantity}×</b>
            {item.productName}{item.hasTimer === false ? " · مباشر" : ""}
          </span>
        ))}
      </div>
      <div className="manager-live-meta">
        <span>{completion ? completion.label : phaseLabel}</span>
        <strong>{completion ? completion.value : dateTime(start)}</strong>
      </div>
      {Boolean(
        (order.orderSource ?? order.source) &&
          (order.orderSource ?? order.source) !== "internal"
      ) && (
        <span className="v2-source-badge">
          {sourceLabel(order)} · {order.createdByName ?? ""}
        </span>
      )}
    </article>
  );
}

function HistoryCard({ order }: { order: KitchenOrder }) {
  const prepSeconds =
    order.acceptedAt && order.readyAt
      ? elapsedSeconds(order.acceptedAt, new Date(order.readyAt).getTime())
      : 0;
  const fixedDeliverySeconds = deliverySeconds(order);
  return (
    <article className="history-card">
      <div className="history-card-top">
        <div>
          <strong>{ticketLabel(order)}</strong>
          <span className="history-date">
            <CalendarDays size={13} /> {dateTime(order.createdAt)}
          </span>
        </div>
        <div className="history-order-status">
          <span
            className={`v2-history-badge ${order.status === "received" ? "received" : "ready"}`}
          >
            {order.status === "received" ? "انتهت بالتسليم" : "جاهز"}
          </span>
          {order.everOverdue && (
            <span className="v2-ever-overdue">كان متأخرًا</span>
          )}
        </div>
      </div>
      <div className="history-items">
        {order.items.map(item => (
          <span key={item.id}>
            <b>{item.quantity}×</b> {item.productName}
          </span>
        ))}
      </div>
      <div className="v2-history-timeline">
        <span>أُرسل: {dateTime(order.createdAt)}</span>
        <span>قُبل: {dateTime(order.acceptedAt)}</span>
        <span>جاهز: {dateTime(order.readyAt)}</span>
        <span>استُلم: {dateTime(order.receivedAt)}</span>
      </div>
      <div className="duration-strip">
        <div>
          <Clock3 size={14} /> التحضير <strong>{clock(prepSeconds)}</strong>
        </div>
        {fixedDeliverySeconds != null && (
          <div>
            <TimerReset size={14} /> التسليم{" "}
            <strong>{clock(fixedDeliverySeconds)}</strong>
          </div>
        )}
      </div>
      <ArchiveOrderNotes order={order} />
    </article>
  );
}

export default function Manager() {
  const { isSystemAdmin, activeBranchId } = useBranch();
  if (isSystemAdmin && !activeBranchId) {
    return <GlobalAdministration branchManagement={<BranchAdmin />} />;
  }
  return <BranchManagerDashboard key={activeBranchId ?? "account-branch"} />;
}

function BranchManagerDashboard() {
  const now = useNow();
  const {
    branchInput,
    branches,
    branchId,
    isSystemAdmin: systemAdmin,
  } = useBranch();
  const user = trpc.auth.me.useQuery(undefined, { retry: false }).data as
    | StaffClientUser
    | null
    | undefined;
  const [tab, setTab] = useState<
    "overview" | "products" | "history" | "users" | "branches" | "integration"
  >("overview");
  const [period, setPeriod] = useState("all");
  const [search, setSearch] = useState("");
  const [historyPage, setHistoryPage] = useState(0);
  const [editingProductId, setEditingProductId] = useState<number | null>(null);
  const utils = trpc.useUtils();
  const active = trpc.orders.monitor.useQuery(branchInput, {
    refetchInterval: 3000,
  });
  const products = trpc.products.managerList.useQuery(branchInput, {
    refetchInterval: 10000,
  });
  const from = useMemo(
    () =>
      period === "today"
        ? new Date(new Date().setHours(0, 0, 0, 0))
        : period === "7days"
          ? new Date(Date.now() - 7 * 86_400_000)
          : undefined,
    [period]
  );
  const history = trpc.orders.history.useQuery(
    { ...(branchInput ?? {}), limit: 50, offset: historyPage * 50, from },
    { refetchInterval: 15000 }
  );
  const create = trpc.products.create.useMutation({
    onSuccess: () => {
      void utils.products.managerList.invalidate();
      void utils.products.list.invalidate();
      toast.success("تمت إضافة الصنف");
    },
    onError: error => toast.error(error.message),
  });
  const update = trpc.products.update.useMutation({
    onSuccess: () => {
      void utils.products.managerList.invalidate();
      void utils.products.list.invalidate();
      setEditingProductId(null);
      toast.success("تم حفظ التعديلات");
    },
    onError: error => toast.error(error.message),
  });
  const canMutate = systemAdmin || user?.role === "branch_manager";
  const live = active.data ?? [];
  const late = live.filter(order => isOverdue(order, now));
  const visibleHistory = (history.data?.orders ?? []).filter(order => {
    const q = normalizeTicketSearch(search);
    return (
      !q ||
      [ticketLabel(order), String(order.id), order.orderCode].some(value =>
        normalizeTicketSearch(value).includes(q)
      ) ||
      order.items.some(item =>
        normalizeTicketSearch(item.productName).includes(q)
      )
    );
  });
  const historyPages = Math.max(1, Math.ceil((history.data?.total ?? 0) / 50));
  const allowedTabs: Array<
    "overview" | "products" | "history" | "users" | "branches" | "integration"
  > = ["overview", "history"];
  if (canMutate) allowedTabs.push("products", "users");
  if (systemAdmin || user?.role === "branch_manager")
    allowedTabs.push("integration");

  useEffect(() => {
    setHistoryPage(0);
  }, [period, branchId]);
  useEffect(() => {
    if (historyPage >= historyPages)
      setHistoryPage(Math.max(0, historyPages - 1));
  }, [historyPage, historyPages]);

  return (
    <div className="manager-page">
      <section className="page-heading">
        <div>
          <div className="eyebrow">
            <span className="eyebrow-line" /> لوحة الإدارة{" "}
            <span className="eyebrow-sep">/</span>{" "}
            {branches.find(branch => branch.id === branchId)?.name ?? "الفرع"}
          </div>
          <h1>مركز التشغيل والإدارة</h1>
          <p>متابعة حية، أرشيف ثابت، وإدارة محكومة بالدور والفرع.</p>
        </div>
        <div className="heading-badge">
          <Archive size={16} />{" "}
          {user?.role === "shift_manager" ? "وضع متابعة" : "صلاحيات آمنة"}
        </div>
      </section>
      {user?.role === "shift_manager" && (
        <p className="v2-readonly-note">
          مدير الشفت يملك المتابعة والتواصل فقط؛ تعديل الحسابات والأصناف محجوب.
        </p>
      )}
      {late.length > 0 && (
        <section className="manager-overdue-alert" role="alert">
          <BellRing size={19} />
          <div>
            <strong>{late.length} طلبات تجاوزت وقت التحضير</strong>
            <p>{late.map(order => ticketLabel(order)).join("، ")}</p>
          </div>
        </section>
      )}
      <div className="manager-summary">
        <div>
          <span className="summary-icon green">
            <PackagePlus size={18} />
          </span>
          <div>
            <small>طلبات مفتوحة</small>
            <strong>{live.length}</strong>
          </div>
        </div>
        <div>
          <span className="summary-icon amber">
            <Clock3 size={18} />
          </span>
          <div>
            <small>متأخرة تاريخيًا/حاليًا</small>
            <strong>{late.length}</strong>
          </div>
        </div>
        <div>
          <span className="summary-icon blue">
            <TimerReset size={18} />
          </span>
          <div>
            <small>أصناف الفرع</small>
            <strong>{products.data?.length ?? 0}</strong>
          </div>
        </div>
      </div>
      <div className="manager-tabs">
        {allowedTabs.map(item => (
          <button
            key={item}
            className={tab === item ? "selected" : ""}
            onClick={() => setTab(item)}
          >
            {item === "overview" ? (
              <>
                <Clock3 size={16} /> متابعة
              </>
            ) : item === "products" ? (
              <>
                <PackagePlus size={16} /> الأصناف
              </>
            ) : item === "history" ? (
              <>
                <Archive size={16} /> الأرشيف
              </>
            ) : item === "users" ? (
              <>
                <Users size={16} /> الحسابات
              </>
            ) : item === "branches" ? (
              <>
                <Building2 size={16} /> الفروع
              </>
            ) : (
              <>التكامل</>
            )}
          </button>
        ))}
      </div>
      {tab === "users" ? (
        <StaffAccountsPanel />
      ) : tab === "products" ? (
        <section className="manager-section">
          <div className="manager-section-head">
            <div>
              <h2>أصناف المطبخ ومددها</h2>
              <p>السماح snapshot مع التذكرة ولا يتغير في الأرشيف.</p>
            </div>
          </div>
          <div className="product-add-card">
            <ProductEditor
              onSave={value =>
                create.mutate({ ...value, branchId: branchId ?? undefined })
              }
              busy={create.isPending}
            />
          </div>
          <div className="manager-products">
            {products.isLoading ? (
              <div className="empty-state">جارٍ التحميل…</div>
            ) : (
              (products.data ?? []).map(product =>
                editingProductId === product.id ? (
                  <article className="manager-product" key={product.id}>
                    <ProductEditor
                      product={product}
                      onSave={value =>
                        update.mutate({
                          id: product.id,
                          ...value,
                          branchId: branchId ?? undefined,
                        })
                      }
                      onCancel={() => setEditingProductId(null)}
                      busy={update.isPending}
                    />
                  </article>
                ) : (
                  <article
                    className={`manager-product ${product.isActive ? "" : "inactive"}`}
                    key={product.id}
                  >
                    <div className="manager-product-icon">
                      <PackagePlus size={19} />
                    </div>
                    <div className="manager-product-main">
                      <strong>{product.name}</strong>
                      <span>{product.category}</span>
                    </div>
                    <div className="prep-target">
                      {product.hasTimer ? (
                        <>
                          <Clock3 size={14} />
                          <strong>{product.prepMinutes}</strong>
                          <span>د / سماح {product.graceMinutes ?? 5}</span>
                        </>
                      ) : (
                        <span className="fast-product-label">بدون مؤقت · مباشر</span>
                      )}
                    </div>
                    <button
                      type="button"
                      className="product-actions"
                      onClick={() => setEditingProductId(product.id)}
                    >
                      <Edit3 size={14} /> تعديل
                    </button>
                    <button
                      type="button"
                      className="product-actions"
                      onClick={() =>
                        update.mutate({
                          id: product.id,
                          isActive: !product.isActive,
                          branchId: branchId ?? undefined,
                        })
                      }
                      disabled={update.isPending}
                    >
                      {product.isActive ? "إيقاف" : "تفعيل"}
                    </button>
                  </article>
                )
              )
            )}
          </div>
        </section>
      ) : tab === "history" ? (
        <section className="manager-section history-section">
          <div className="manager-section-head">
            <div>
              <h2>الأرشيف</h2>
              <p>الجاهز والمستلم منفصلان، ولا تُمحى حالة التأخير السابقة.</p>
            </div>
            <span className="count-badge">
              {history.data?.total ?? 0} محفوظ
            </span>
          </div>
          <div className="history-filters">
            <div className="search-box">
              <Search size={16} />
              <input
                value={search}
                onChange={event => setSearch(event.target.value)}
                placeholder="ابحث برقم الطلب أو الصنف"
              />
            </div>
            <select
              value={period}
              onChange={event => setPeriod(event.target.value)}
            >
              <option value="all">كل الفترات</option>
              <option value="today">اليوم</option>
              <option value="7days">آخر 7 أيام</option>
            </select>
          </div>
          {history.isLoading ? (
            <div className="empty-state">جارٍ تحميل الأرشيف…</div>
          ) : (
            <>
              <div className="history-list">
                {visibleHistory.length ? (
                  visibleHistory.map(order => (
                    <HistoryCard key={order.id} order={order} />
                  ))
                ) : (
                  <div className="empty-state">لا توجد طلبات مطابقة.</div>
                )}
              </div>
              <div className="history-pagination">
                <button
                  type="button"
                  onClick={() => setHistoryPage(page => Math.max(0, page - 1))}
                  disabled={historyPage === 0 || history.isFetching}
                >
                  السابق
                </button>
                <span>
                  صفحة {historyPage + 1} من {historyPages}
                </span>
                <button
                  type="button"
                  onClick={() =>
                    setHistoryPage(page => Math.min(historyPages - 1, page + 1))
                  }
                  disabled={
                    historyPage >= historyPages - 1 || history.isFetching
                  }
                >
                  التالي
                </button>
              </div>
            </>
          )}
        </section>
      ) : tab === "branches" ? (
        <BranchAdmin />
      ) : tab === "integration" ? (
        <IntegrationPanel branchId={branchId} />
      ) : (
        <section className="manager-section live-orders-section">
          <div className="manager-section-head">
            <div>
              <h2>متابعة الطلبات المفتوحة</h2>
              <p>قراءة مشتركة للأدوار الإدارية الأربعة، مع عزل الفرع.</p>
            </div>
            <span className="count-badge">تحديث كل 3 ثوانٍ</span>
          </div>
          <div className="manager-live-columns">
            {(
              [
                "new",
                "preparing",
                "ready",
              ] as const satisfies readonly LiveStatus[]
            ).map(status => (
              <section className={`manager-live-column ${status}`} key={status}>
                <div className="manager-live-column-head">
                  <div>
                    <h3>
                      {status === "new"
                        ? "طلبات تنتظر القبول"
                        : status === "preparing"
                          ? "قيد التحضير"
                          : "جاهزة بانتظار الاستلام"}
                    </h3>
                  </div>
                  <strong>
                    {live.filter(order => order.status === status).length}
                  </strong>
                </div>
                <div className="manager-live-list">
                  {live
                    .filter(order => order.status === status)
                    .map(order => (
                      <LiveCard key={order.id} order={order} now={now} />
                    ))}
                  {live.every(order => order.status !== status) && (
                    <div className="manager-live-empty">
                      لا توجد طلبات في هذه المرحلة.
                    </div>
                  )}
                </div>
              </section>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function BranchAdmin() {
  const { branches } = useBranch();
  const utils = trpc.useUtils();
  const [name, setName] = useState("");
  const [city, setCity] = useState("");
  const create = trpc.branches.create.useMutation({
    onSuccess: () => {
      void utils.branches.list.invalidate();
      setName("");
      setCity("");
      toast.success("تم إنشاء الفرع");
    },
    onError: error => toast.error(error.message),
  });
  const update = trpc.branches.update.useMutation({
    onSuccess: () => {
      void utils.branches.list.invalidate();
      toast.success("تم تحديث استقبال الطلبات");
    },
    onError: error => toast.error(error.message),
  });

  return (
    <section className="manager-section">
      <div className="manager-section-head">
        <div>
          <h2>الفروع</h2>
          <p>مدير النظام فقط ينشئ ويحدّث الفروع.</p>
        </div>
      </div>
      <form
        className="product-new-form"
        onSubmit={event => {
          event.preventDefault();
          create.mutate({
            name: name.trim(),
            city: city.trim(),
            ordersEnabled: true,
          });
        }}
      >
        <input
          required
          placeholder="اسم الفرع"
          value={name}
          onChange={event => setName(event.target.value)}
        />
        <input
          required
          placeholder="المدينة"
          value={city}
          onChange={event => setCity(event.target.value)}
        />
        <button
          type="submit"
          className="primary-action"
          disabled={create.isPending}
        >
          <Plus size={15} /> {create.isPending ? "جارٍ الإنشاء…" : "إضافة فرع"}
        </button>
      </form>
      <div className="manager-products">
        {branches.map(branch => (
          <article className="manager-product" key={branch.id}>
            <Building2 size={18} />
            <strong>{branch.name}</strong>
            <span>{branch.city}</span>
            <span
              className={`product-state ${branch.ordersEnabled === false ? "off" : "on"}`}
            >
              {branch.ordersEnabled === false ? "موقوف" : "يستقبل الطلبات"}
            </span>
            <button
              type="button"
              className="product-actions"
              onClick={() =>
                update.mutate({
                  id: branch.id,
                  ordersEnabled: branch.ordersEnabled === false,
                })
              }
              disabled={update.isPending}
            >
              {update.isPending
                ? "جارٍ الحفظ…"
                : branch.ordersEnabled === false
                  ? "تفعيل الطلبات"
                  : "إيقاف الطلبات"}
            </button>
          </article>
        ))}
      </div>
    </section>
  );
}
