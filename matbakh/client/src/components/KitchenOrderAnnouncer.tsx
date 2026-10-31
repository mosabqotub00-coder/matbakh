import { useEffect, useRef, useState } from "react";
import { BellRing } from "lucide-react";
import { toast } from "sonner";
import { useKitchenAudio } from "@/contexts/KitchenAudioContext";
import { useBranch } from "@/contexts/BranchContext";
import {
  clock,
  remainingSeconds,
  isOverdue,
  ticketLabel,
  orderAnnouncementText,
  type KitchenOrder,
} from "@/lib/kitchen-ui";
import {
  AUDIO_ANNOUNCED_ORDER_IDS_STORAGE_KEY,
  OVERDUE_ALERTS_STORAGE_KEY,
  getAnnouncementStorage,
  persistOrderIds,
  readStoredOrderIds,
} from "@/lib/order-announcements";
import {
  playOverdueAlert,
  registerKitchenAudioUnlockListener,
  speakKitchenAnnouncement,
} from "@/lib/kitchen-audio";
import { trpc } from "@/lib/trpc";

function itemSummary(order: KitchenOrder) {
  return order.items
    .map(item => `${item.quantity} ${item.productName}`)
    .join("، ");
}
function overdue(order: KitchenOrder, now: number) {
  return isOverdue(order, now);
}
export default function KitchenOrderAnnouncer() {
  const { enabled } = useKitchenAudio();
  const { branchInput } = useBranch();
  const session = trpc.auth.me.useQuery(undefined, { retry: false });
  const user = session.data as any;
  const canMonitor = Boolean(
    user &&
      !user.mustChangePassword &&
      (user.canKitchen ||
        user.canManager ||
        [
          "kitchen",
          "kitchen_manager",
          "shift_manager",
          "system_admin",
          "branch_manager",
        ].includes(user.role))
  );
  const userId = canMonitor ? (user.id ?? null) : null;
  const ordersApi = trpc.orders as any;
  const orders = ordersApi.monitor.useQuery(branchInput, {
    refetchInterval: 2500,
    enabled: canMonitor,
  }) as {
    data?: KitchenOrder[];
    isFetching: boolean;
    isError: boolean;
    refetch: () => Promise<unknown>;
  };
  const [now, setNow] = useState(Date.now());
  const [readyUserId, setReadyUserId] = useState<number | null>(null);
  const activeUserId = useRef<number | null>(null);
  const baselineUserId = useRef<number | null>(null);
  const visualNewIds = useRef(new Set<number>());
  const audioNewIds = useRef(new Set<number>());
  const visualOverdueIds = useRef(new Set<number>());
  const audioOverdueIds = useRef(new Set<number>());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => {
    activeUserId.current = userId;
    baselineUserId.current = null;
    visualNewIds.current.clear();
    visualOverdueIds.current.clear();
    audioNewIds.current = readStoredOrderIds(
      getAnnouncementStorage(),
      AUDIO_ANNOUNCED_ORDER_IDS_STORAGE_KEY
    );
    audioOverdueIds.current = readStoredOrderIds(
      getAnnouncementStorage(),
      OVERDUE_ALERTS_STORAGE_KEY
    );
    setReadyUserId(null);
    if (userId === null) {
      if ("speechSynthesis" in window) window.speechSynthesis.cancel();
      toast.dismiss();
      return;
    }
    let cancelled = false;
    void orders.refetch().then(() => {
      if (!cancelled && activeUserId.current === userId) setReadyUserId(userId);
    });
    return () => {
      cancelled = true;
    };
  }, [userId, branchInput?.branchId]);
  useEffect(() => {
    if (enabled) registerKitchenAudioUnlockListener();
  }, [enabled]);
  const ready =
    userId !== null &&
    readyUserId === userId &&
    !orders.isFetching &&
    !orders.isError;
  useEffect(() => {
    if (!ready || !orders.data) return;
    const newOrders = orders.data.filter(order => order.status === "new");
    if (baselineUserId.current !== userId) {
      newOrders.forEach(order => visualNewIds.current.add(order.id));
      baselineUserId.current = userId;
    }
    const arrivals = newOrders.filter(
      order => !visualNewIds.current.has(order.id)
    );
    arrivals.forEach(order => visualNewIds.current.add(order.id));
    if (arrivals.length)
      toast.success(
        arrivals.length === 1
          ? "وصل طلب جديد للمطبخ"
          : `وصلت ${arrivals.length} طلبات جديدة للمطبخ`,
        {
          description: arrivals
            .map(order => `${ticketLabel(order)}: ${itemSummary(order)}`)
            .join(" | "),
          duration: 5000,
          icon: <BellRing size={18} />,
        }
      );
    const late = orders.data.filter(
      order => overdue(order, now) && !visualOverdueIds.current.has(order.id)
    );
    late.forEach(order => visualOverdueIds.current.add(order.id));
    if (late.length)
      toast.warning("تنبيه: طلبات تجاوزت السماح", {
        description: late
          .map(
            order =>
              `${ticketLabel(order)} — ${clock(-remainingSeconds(order, now))}`
          )
          .join(" | "),
        duration: 5000,
        icon: <BellRing size={18} />,
      });
  }, [ready, userId, now, orders.data]);
  useEffect(() => {
    if (!ready || !enabled || !orders.data) return;
    const late = orders.data.filter(
      order => overdue(order, now) && !audioOverdueIds.current.has(order.id)
    );
    if (late.length) {
      const text = late.map(orderAnnouncementText).join(" ");
      const tonePlayed = playOverdueAlert();
      const speechQueued = speakKitchenAnnouncement(
        `تنبيه عاجل. هناك طلبية متأخرة. ${text}`,
        true
      );
      if (tonePlayed || speechQueued) {
        late.forEach(order => audioOverdueIds.current.add(order.id));
        persistOrderIds(
          audioOverdueIds.current,
          getAnnouncementStorage(),
          OVERDUE_ALERTS_STORAGE_KEY
        );
      }
      return;
    }
    const pending = orders.data.filter(
      order => order.status === "new" && !audioNewIds.current.has(order.id)
    );
    if (
      pending.length &&
      speakKitchenAnnouncement(
        `وصل طلب جديد إلى المطبخ. ${pending.map(orderAnnouncementText).join(" ")}`
      )
    ) {
      pending.forEach(order => audioNewIds.current.add(order.id));
      persistOrderIds(
        audioNewIds.current,
        getAnnouncementStorage(),
        AUDIO_ANNOUNCED_ORDER_IDS_STORAGE_KEY
      );
    }
  }, [enabled, ready, now, orders.data]);
  return null;
}
