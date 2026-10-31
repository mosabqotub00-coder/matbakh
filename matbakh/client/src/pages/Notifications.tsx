import { useEffect, useState } from "react";
import {
  AlertTriangle,
  Archive,
  Bell,
  Check,
  CheckCheck,
  Clock3,
  Loader2,
  Radio,
  RefreshCw,
  Search,
  ShieldAlert,
  Smartphone,
  TimerReset,
} from "lucide-react";
import { trpc } from "@/lib/trpc";
import { useBranch } from "@/contexts/BranchContext";
import { dateTime, ticketLabel } from "@/lib/kitchen-ui";
import { humanTicketText } from "../../../shared/ticket-label";
import {
  filterNotificationFeed,
  groupNotificationFeed,
  type NotificationEntry,
  type NotificationPeriod,
} from "../../../shared/notification-feed";
import NotificationDeviceSettings from "@/components/NotificationDeviceSettings";
import "@/notification-center.css";

type CenterTab = "new" | "archive" | "device";
const PAGE_SIZE = 20;
const phaseLabels: Record<string, string> = {
  order_created: "وصول ضربة",
  near_due: "اقتراب الموعد",
  grace_entered: "وقت السماح",
  late: "تنبيه تأخير",
  extended: "تمديد المهلة",
  ready: "جاهز للاستلام",
  received: "تم الاستلام",
  broadcast_started: "بث مباشر",
};
function notificationKind(type: string) {
  if (type === "late") return { Icon: AlertTriangle, style: "is-late" };
  if (type === "ready" || type === "received")
    return { Icon: CheckCheck, style: "is-ready" };
  if (type === "near_due" || type === "grace_entered")
    return { Icon: Clock3, style: "is-pending" };
  if (type === "extended") return { Icon: TimerReset, style: "is-default" };
  if (type === "broadcast_started") return { Icon: Radio, style: "is-default" };
  return { Icon: Bell, style: "is-default" };
}

export default function Notifications() {
  const { activeBranchId, activeBranch } = useBranch();
  const branchInput = activeBranchId ? { branchId: activeBranchId } : undefined;
  const list = trpc.notifications.list.useQuery(branchInput, {
    enabled: Boolean(activeBranchId),
    refetchInterval: 20_000,
  });
  const [tab, setTab] = useState<CenterTab>("new");
  const [search, setSearch] = useState("");
  const [kind, setKind] = useState("all");
  const [period, setPeriod] = useState<NotificationPeriod>("all");
  const [page, setPage] = useState(0);
  const [feedback, setFeedback] = useState<string | null>(null);
  const markRead = trpc.notifications.markRead.useMutation({
    onSuccess: () => {
      void list.refetch();
      setFeedback("تمت المراجعة. الإشعار موجود الآن في أرشيف الإشعارات.");
    },
    onError: () =>
      setFeedback("تعذر حفظ المراجعة. تحقق من الاتصال وحاول مجددًا."),
  });
  const markAll = trpc.notifications.markAllRead.useMutation({
    onSuccess: () => {
      void list.refetch();
      setFeedback("نُقلت التنبيهات الجديدة المحملة إلى الأرشيف دون حذفها.");
    },
    onError: () =>
      setFeedback("تعذر تحديث التنبيهات. لم يتم تأكيد نقلها للأرشيف."),
  });
  const rows = (activeBranchId ? (list.data ?? []) : []) as NotificationEntry[];
  const unread = rows.filter(row => !row.read).length;
  const archived = rows.filter(row => row.read).length;
  const late = rows.filter(row => !row.read && row.type === "late").length;
  const filtered = filterNotificationFeed(rows, {
    mode: tab === "archive" ? "archive" : "new",
    search,
    kind,
    period,
  });
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentRows = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  const groups = groupNotificationFeed(currentRows);

  useEffect(() => {
    setPage(0);
    setFeedback(null);
  }, [activeBranchId, tab, search, kind, period]);
  useEffect(() => {
    if (page >= pageCount) setPage(pageCount - 1);
  }, [page, pageCount]);
  function resetFilters() {
    setSearch("");
    setKind("all");
    setPeriod("all");
  }

  return (
    <section
      className="notification-center"
      dir="rtl"
      aria-labelledby="notification-center-title"
    >
      <header className="notification-center-header">
        <div className="notification-heading">
          <span className="eyebrow">تنبيهات الفرع</span>
          <h1 id="notification-center-title">مركز التنبيهات</h1>
          <p>
            {activeBranch ? activeBranch.name : "اختر فرعًا للمتابعة"} · الجديدة
            والأرشيف وإعدادات الهاتف، كل قسم في مكانه.
          </p>
        </div>
        <div className="notification-header-tools">
          <button
            className="secondary-action"
            type="button"
            onClick={() => void list.refetch()}
            disabled={!activeBranchId || list.isFetching}
          >
            {list.isFetching ? (
              <Loader2 className="spin" size={16} />
            ) : (
              <RefreshCw size={16} />
            )}{" "}
            تحديث التنبيهات
          </button>
        </div>
      </header>

      <div className="notification-summary" aria-label="ملخص الإشعارات المحملة">
        <div className="notification-summary-item">
          <Bell size={19} />
          <span>
            تنبيهات جديدة<strong>{unread}</strong>
          </span>
        </div>
        <div className="notification-summary-item">
          <Archive size={19} />
          <span>
            في أرشيف الإشعارات<strong>{archived}</strong>
          </span>
        </div>
        <div className="notification-summary-item">
          <AlertTriangle size={19} />
          <span>
            تنبيهات تأخير غير مقروءة<strong>{late}</strong>
          </span>
        </div>
      </div>

      <div
        className="notification-tabs"
        role="tablist"
        aria-label="أقسام مركز التنبيهات"
      >
        <button
          type="button"
          role="tab"
          className="notification-tab"
          id="notification-tab-new"
          aria-selected={tab === "new"}
          aria-controls="notification-panel-new"
          onClick={() => setTab("new")}
        >
          <Bell size={17} /> التنبيهات الجديدة{" "}
          <span className="notification-tab-count">{unread}</span>
        </button>
        <button
          type="button"
          role="tab"
          className="notification-tab"
          id="notification-tab-archive"
          aria-selected={tab === "archive"}
          aria-controls="notification-panel-archive"
          onClick={() => setTab("archive")}
        >
          <Archive size={17} /> أرشيف الإشعارات{" "}
          <span className="notification-tab-count">{archived}</span>
        </button>
        <button
          type="button"
          role="tab"
          className="notification-tab"
          id="notification-tab-device"
          aria-selected={tab === "device"}
          aria-controls="notification-panel-device"
          onClick={() => setTab("device")}
        >
          <Smartphone size={17} /> إعدادات الهاتف
        </button>
      </div>

      {tab === "device" ? (
        <div
          role="tabpanel"
          id="notification-panel-device"
          aria-labelledby="notification-tab-device"
        >
          <NotificationDeviceSettings />
        </div>
      ) : (
        <div
          role="tabpanel"
          id={`notification-panel-${tab}`}
          aria-labelledby={`notification-tab-${tab}`}
        >
          <div className="notification-list-head">
            <div>
              <h2>
                {tab === "archive"
                  ? "أرشيف الإشعارات المقروءة"
                  : "التنبيهات التي تحتاج مراجعة"}
              </h2>
              <p>
                {tab === "archive"
                  ? "هنا الإشعارات التي راجعتها، مع نصها ورقم الضربة وتاريخها. لا يتم حذفها عند المراجعة."
                  : "بعد مراجعة التنبيه، اضغط «تمت المراجعة» ليظهر في أرشيف الإشعارات."}
              </p>
            </div>
          </div>
          <div className="notification-toolbar">
            <label
              className="notification-field notification-search"
              htmlFor="notification-search"
            >
              <span>البحث في الإشعارات</span>
              <div>
                <Search size={17} />
                <input
                  id="notification-search"
                  value={search}
                  onChange={event => setSearch(event.target.value)}
                  placeholder="رقم الضربة أو نص الإشعار"
                />
              </div>
            </label>
            <label className="notification-field" htmlFor="notification-kind">
              <span>نوع التنبيه</span>
              <select
                id="notification-kind"
                value={kind}
                onChange={event => setKind(event.target.value)}
              >
                <option value="all">كل الأنواع</option>
                {Object.entries(phaseLabels).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label className="notification-field" htmlFor="notification-period">
              <span>الفترة</span>
              <select
                id="notification-period"
                value={period}
                onChange={event =>
                  setPeriod(event.target.value as NotificationPeriod)
                }
              >
                <option value="all">كل التواريخ المحملة</option>
                <option value="today">اليوم</option>
                <option value="week">آخر 7 أيام</option>
              </select>
            </label>
          </div>
          <div className="notification-actions">
            <span className="notification-scope">
              {filtered.length} نتيجة من {rows.length} إشعارًا محملًا لهذا
              الحساب.
            </span>
            {(search || kind !== "all" || period !== "all") && (
              <button
                type="button"
                className="secondary-action"
                onClick={resetFilters}
              >
                إلغاء التصفية
              </button>
            )}
            {tab === "new" && unread > 0 && (
              <button
                type="button"
                className="secondary-action"
                disabled={markAll.isPending}
                onClick={() => markAll.mutate(branchInput)}
              >
                <CheckCheck size={16} /> مراجعة كل الجديدة ({unread})
              </button>
            )}
          </div>
          <p className="notification-scope">
            العدادات والتصفية تخص أحدث الإشعارات المحملة لحسابك، وليست إجمالي
            السجل التاريخي.
          </p>
          {feedback && (
            <p className="notification-feedback" role="status">
              {feedback}
            </p>
          )}

          {!activeBranchId ? (
            <div className="notification-empty">
              <Bell size={28} />
              <h3>اختر فرعًا أولًا</h3>
              <p>اختر فرع المتابعة من الشريط العلوي لعرض إشعاراته وأرشيفها.</p>
            </div>
          ) : list.isLoading ? (
            <div className="notification-empty">
              <Loader2 className="spin" size={26} />
              <p>جارٍ تحميل الإشعارات…</p>
            </div>
          ) : list.isError ? (
            <div className="notification-empty">
              <ShieldAlert size={28} />
              <h3>تعذر تحميل الإشعارات</h3>
              <p>تحقق من الاتصال ثم اضغط تحديث التنبيهات.</p>
            </div>
          ) : filtered.length === 0 ? (
            <div className="notification-empty">
              {tab === "archive" ? (
                <Archive size={28} />
              ) : (
                <CheckCheck size={28} />
              )}
              <h3>
                {search || kind !== "all" || period !== "all"
                  ? "لا توجد نتائج مطابقة للتصفية"
                  : tab === "archive"
                    ? "أرشيف الإشعارات فارغ حاليًا"
                    : "لا توجد تنبيهات جديدة بحاجة للمراجعة"}
              </h3>
              <p>
                {tab === "archive"
                  ? "تظهر الإشعارات هنا بعد تعليمها كمقروءة."
                  : "يمكنك الرجوع إلى التنبيهات المقروءة من أرشيف الإشعارات."}
              </p>
              {tab === "new" && archived > 0 && (
                <button
                  type="button"
                  className="secondary-action"
                  onClick={() => setTab("archive")}
                >
                  فتح أرشيف الإشعارات
                </button>
              )}
            </div>
          ) : (
            <div className="notification-list">
              {groups.map(group => (
                <section
                  className="notification-day-group"
                  key={group.key}
                  aria-label={group.label}
                >
                  <h3 className="notification-day-heading">{group.label}</h3>
                  {group.rows.map(row => {
                    const { Icon, style } = notificationKind(row.type);
                    return (
                      <article
                        key={row.id}
                        className={`notification-card ${row.read ? "read" : "unread"} ${style}`}
                      >
                        <div className="notification-icon">
                          <Icon size={21} />
                        </div>
                        <div className="notification-content">
                          <div className="notification-card-top">
                            <span className={`notification-card-kind ${style}`}>
                              {phaseLabels[row.type] ?? "إشعار"}
                            </span>
                            <time>{dateTime(row.createdAt)}</time>
                          </div>
                          <h3 className="notification-card-title">
                            {row.title}
                          </h3>
                          <p className="notification-card-copy">
                            {row.orderId
                              ? humanTicketText(row.body, { id: row.orderId })
                              : row.body}
                          </p>
                          <div className="notification-meta">
                            {row.orderId && (
                              <strong>
                                {ticketLabel({ id: row.orderId })}
                              </strong>
                            )}
                            <span>
                              {row.read
                                ? "تمت المراجعة — في الأرشيف"
                                : "جديد — غير مقروء"}
                            </span>
                            {!row.read && (
                              <button
                                type="button"
                                className="notification-read-button"
                                disabled={markRead.isPending}
                                onClick={() => markRead.mutate({ id: row.id })}
                              >
                                <Check size={15} /> تمت المراجعة — إلى الأرشيف
                              </button>
                            )}
                          </div>
                        </div>
                      </article>
                    );
                  })}
                </section>
              ))}
            </div>
          )}
          {filtered.length > 0 && (
            <nav
              className="notification-pagination"
              aria-label="صفحات الإشعارات"
            >
              <button
                type="button"
                onClick={() => setPage(value => Math.max(0, value - 1))}
                disabled={page === 0}
              >
                السابق
              </button>
              <span>
                صفحة {page + 1} من {pageCount}
              </span>
              <button
                type="button"
                onClick={() =>
                  setPage(value => Math.min(pageCount - 1, value + 1))
                }
                disabled={page >= pageCount - 1}
              >
                التالي
              </button>
            </nav>
          )}
        </div>
      )}
    </section>
  );
}
