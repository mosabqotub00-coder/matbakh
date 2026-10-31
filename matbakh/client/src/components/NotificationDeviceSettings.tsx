import {
  AlertTriangle,
  CheckCircle2,
  CloudOff,
  Loader2,
  Server,
  Settings2,
  Smartphone,
  Workflow,
} from "lucide-react";
import { useEffect, useState } from "react";
import { trpc } from "@/lib/trpc";

function decodeBase64Url(value: string) {
  const padded = `${value}${"=".repeat((4 - (value.length % 4)) % 4)}`
    .replace(/-/g, "+")
    .replace(/_/g, "/");
  const binary = window.atob(padded);
  return Uint8Array.from(binary, char => char.charCodeAt(0));
}

type StatusTone = "ready" | "blocked" | "pending";

type StatusRowProps = {
  icon: typeof Smartphone;
  label: string;
  value: string;
  tone: StatusTone;
};

function StatusRow({ icon: Icon, label, value, tone }: StatusRowProps) {
  return (
    <div className={`notification-device-status-row is-${tone}`}>
      <span className="notification-device-status-icon" aria-hidden="true">
        <Icon size={18} />
      </span>
      <span className="notification-device-status-copy">
        <strong>{label}</strong>
        <span>{value}</span>
      </span>
      <span className="notification-device-status-mark" aria-hidden="true">
        {tone === "ready" ? (
          <CheckCircle2 size={18} />
        ) : tone === "blocked" ? (
          <AlertTriangle size={18} />
        ) : (
          <Loader2 size={18} className="notification-device-spin" />
        )}
      </span>
    </div>
  );
}

export default function NotificationDeviceSettings() {
  const status = trpc.notifications.status.useQuery(undefined, {
    retry: false,
  });
  const subscribe = trpc.notifications.subscribe.useMutation();
  const unsubscribe = trpc.notifications.unsubscribe.useMutation();
  const user = trpc.auth.me.useQuery(undefined, { retry: false }).data;
  const configure = trpc.notifications.configure.useMutation();
  const [contactSubject, setContactSubject] = useState(
    () => window.location.origin
  );
  const [deadlineTaskUid, setDeadlineTaskUid] = useState("");
  const [pushMessage, setPushMessage] = useState<string | null>(null);
  const [pushBusy, setPushBusy] = useState(false);
  const [pushEnabled, setPushEnabled] = useState(false);

  useEffect(() => {
    let cancelled = false;

    if (
      typeof window === "undefined" ||
      typeof navigator === "undefined" ||
      !("serviceWorker" in navigator) ||
      !("PushManager" in window)
    ) {
      return () => {
        cancelled = true;
      };
    }

    void navigator.serviceWorker
      .getRegistration("/")
      .then(async registration => {
        if (cancelled || !registration) return;
        const current = await registration.pushManager.getSubscription();
        if (!cancelled) setPushEnabled(Boolean(current));
      })
      .catch(() => {
        if (!cancelled) setPushEnabled(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  async function enablePush() {
    setPushBusy(true);
    setPushMessage(null);
    try {
      if (
        !("serviceWorker" in navigator) ||
        !("PushManager" in window) ||
        !("Notification" in window)
      ) {
        setPushMessage("هذا المتصفح لا يدعم إشعارات Push.");
        return;
      }
      if (status.data?.status !== "ready" || !status.data.publicKey) {
        setPushMessage(
          status.data?.reason ?? "إعداد Push غير مكتمل على الخادم المنشور."
        );
        return;
      }
      const permission =
        Notification.permission === "granted"
          ? "granted"
          : await Notification.requestPermission();
      if (permission !== "granted") {
        setPushMessage(
          "لم تُمنح صلاحية الإشعارات. يمكنك تفعيلها من إعدادات المتصفح."
        );
        return;
      }
      const registration = await navigator.serviceWorker.register("/sw.js", {
        scope: "/",
      });
      await navigator.serviceWorker.ready;
      const existing = await registration.pushManager.getSubscription();
      const current =
        existing ??
        (await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: decodeBase64Url(status.data.publicKey),
        }));
      await subscribe.mutateAsync({
        endpoint: current.endpoint,
        keys: {
          p256dh: btoa(
            String.fromCharCode(...new Uint8Array(current.getKey("p256dh")!))
          )
            .replace(/\+/g, "-")
            .replace(/\//g, "_")
            .replace(/=+$/, ""),
          auth: btoa(
            String.fromCharCode(...new Uint8Array(current.getKey("auth")!))
          )
            .replace(/\+/g, "-")
            .replace(/\//g, "_")
            .replace(/=+$/, ""),
        },
      });
      setPushEnabled(true);
      setPushMessage("تم تفعيل إشعارات هذا الجهاز.");
    } catch {
      setPushMessage(
        "تعذر تفعيل الإشعارات. تحقق من الصلاحية واتصال الخادم ثم حاول مجددًا."
      );
    } finally {
      setPushBusy(false);
    }
  }

  async function disablePush() {
    setPushBusy(true);
    setPushMessage(null);
    try {
      const registration = await navigator.serviceWorker?.getRegistration("/");
      const current = await registration?.pushManager.getSubscription();
      if (current) {
        await unsubscribe.mutateAsync({ endpoint: current.endpoint });
        await current.unsubscribe();
      }
      setPushEnabled(false);
      setPushMessage("تم إلغاء اشتراك هذا الجهاز.");
    } catch {
      setPushMessage("تعذر إلغاء الاشتراك. حاول مجددًا.");
    } finally {
      setPushBusy(false);
    }
  }

  const permissionBlocked =
    typeof Notification !== "undefined" && Notification.permission === "denied";
  const pushSupported =
    typeof window !== "undefined" &&
    typeof navigator !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window;
  const deviceStatus = !pushSupported
    ? "هذا المتصفح لا يدعم Push"
    : permissionBlocked
      ? "صلاحية الإشعارات محجوبة من المتصفح"
      : pushEnabled
        ? "اشتراك هذا الهاتف مفعّل"
        : "لم يُفعّل هذا الهاتف بعد";
  const deviceTone: StatusTone =
    pushEnabled && !permissionBlocked ? "ready" : "blocked";
  const serverTone: StatusTone = status.isLoading
    ? "pending"
    : status.data?.backendReady
      ? "ready"
      : "blocked";
  const scheduleTone: StatusTone = status.isLoading
    ? "pending"
    : status.data?.backgroundScheduleReady
      ? "ready"
      : "blocked";

  return (
    <section
      className="notification-device-panel"
      dir="rtl"
      aria-labelledby="notification-device-heading"
    >
      <div className="notification-device-panel-heading">
        <div>
          <span className="notification-device-eyebrow">
            <Smartphone size={17} aria-hidden="true" /> إعدادات الهاتف
          </span>
          <h2 id="notification-device-heading">إشعارات هذا الهاتف</h2>
          <p>
            تحكم في اشتراك هذا المتصفح فقط. لا يبدأ الاشتراك ولا تتغير صلاحية
            المتصفح تلقائيًا.
          </p>
        </div>
        <span
          className={`notification-device-state is-${pushEnabled ? "ready" : "off"}`}
        >
          <span aria-hidden="true" />
          {pushEnabled ? "مفعّل" : "غير مفعّل"}
        </span>
      </div>

      <div
        className="notification-device-status"
        aria-label="حالة إشعارات Push"
      >
        <StatusRow
          icon={Smartphone}
          label="حالة الجهاز"
          value={deviceStatus}
          tone={deviceTone}
        />
        <StatusRow
          icon={Server}
          label="إعداد الخادم"
          value={
            status.isLoading
              ? "جارٍ فحص إعداد الخادم…"
              : status.data?.backendReady
                ? "مفتاح إرسال Push مضبوط"
                : (status.data?.reason ??
                  "إعداد Push غير مكتمل على الخادم المنشور.")
          }
          tone={serverTone}
        />
        <StatusRow
          icon={Workflow}
          label="ربط الفحص"
          value={
            status.isLoading
              ? "بانتظار نتيجة فحص إعداد الفحص"
              : status.data?.backgroundScheduleReady
                ? "معرّف الفحص مرتبط بالإعداد"
                : "لم يُربط معرّف الفحص بعد"
          }
          tone={scheduleTone}
        />
      </div>

      <div className="notification-device-actions">
        {pushEnabled ? (
          <button
            type="button"
            className="notification-device-button notification-device-button-secondary"
            disabled={pushBusy}
            onClick={() => void disablePush()}
          >
            {pushBusy ? (
              <Loader2 className="notification-device-spin" size={18} />
            ) : (
              <CloudOff size={18} />
            )}
            إلغاء إشعارات هذا الهاتف
          </button>
        ) : (
          <button
            type="button"
            className="notification-device-button notification-device-button-primary"
            disabled={pushBusy || status.isLoading}
            onClick={() => void enablePush()}
          >
            {pushBusy ? (
              <Loader2 className="notification-device-spin" size={18} />
            ) : (
              <Smartphone size={18} />
            )}
            تفعيل إشعارات هذا الهاتف
          </button>
        )}
        <p className="notification-device-action-note">
          {permissionBlocked
            ? "إذن المتصفح غير مسموح. فعّله من إعدادات المتصفح ثم أعد المحاولة."
            : pushEnabled
              ? "يمكنك إلغاء اشتراك هذا الهاتف في أي وقت."
              : "لن يُنشأ اشتراك قبل ضغط الزر وموافقة المتصفح."}
        </p>
      </div>

      {pushMessage && (
        <p className="notification-feedback" role="status">
          {pushMessage}
        </p>
      )}

      {(user?.role === "system_admin" || user?.role === "developer") && (
        <details className="notification-device-settings">
          <summary>
            <Settings2 size={18} aria-hidden="true" />
            إعدادات الإدارة المتقدمة
          </summary>
          <div className="notification-device-settings-body">
            <p>
              احفظ رابط الموقع الحقيقي لإعداد مفتاح Push مرة واحدة. معرّف الجدول
              يُؤخذ من جدول الفحص بعد النشر، وليس اسمًا تختاره هنا.
            </p>
            <form
              onSubmit={event => {
                event.preventDefault();
                void configure
                  .mutateAsync({
                    subject: contactSubject,
                    deadlineTaskUid: deadlineTaskUid.trim() || undefined,
                  })
                  .then(() => {
                    void status.refetch();
                    setPushMessage(
                      "حُفظ إعداد الخادم. تفعيل الجهاز وتشغيل الجدول المنشور خطوتان مستقلتان."
                    );
                  })
                  .catch(error =>
                    setPushMessage(
                      error instanceof Error
                        ? error.message
                        : "تعذر حفظ الإعداد."
                    )
                  );
              }}
            >
              <label>
                رابط الموقع HTTPS
                <input
                  type="url"
                  required
                  value={contactSubject}
                  onChange={event => setContactSubject(event.target.value)}
                />
              </label>
              <label>
                معرّف جدول فحص المواعيد — اختياري
                <input
                  value={deadlineTaskUid}
                  onChange={event => setDeadlineTaskUid(event.target.value)}
                  placeholder="taskUid الحقيقي بعد النشر"
                />
              </label>
              <button
                type="submit"
                className="notification-device-button notification-device-button-primary"
                disabled={configure.isPending}
              >
                {configure.isPending && (
                  <Loader2 className="notification-device-spin" size={18} />
                )}
                {configure.isPending ? "حفظ الإعداد…" : "حفظ إعداد الخادم"}
              </button>
            </form>
          </div>
        </details>
      )}
    </section>
  );
}
