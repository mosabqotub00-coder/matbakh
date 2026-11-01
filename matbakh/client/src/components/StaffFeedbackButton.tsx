import { useState } from "react";
import { createPortal } from "react-dom";
import { MessageSquarePlus, X } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { useBranch } from "@/contexts/BranchContext";

async function fileToBase64(file: File) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000)
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

export default function StaffFeedbackButton() {
  const { activeBranchId } = useBranch();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState<"low" | "normal" | "high" | "urgent">("normal");
  const [orderId, setOrderId] = useState("");
  const [attachment, setAttachment] = useState<File | null>(null);
  const utils = trpc.useUtils();
  const submit = trpc.developer.feedbackCreate.useMutation({
    onSuccess: () => {
      toast.success("تم إرسال ملاحظتك إلى المطوّر بنجاح.");
      void utils.developer.dashboard.invalidate();
      setTitle("");
      setDescription("");
      setOrderId("");
      setAttachment(null);
      setOpen(false);
    },
    onError: error => toast.error(error.message),
  });

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!title.trim() || !description.trim()) {
      toast.error("اكتب عنوان المشكلة وتفاصيلها.");
      return;
    }
    if (attachment && attachment.size > 5 * 1024 * 1024) {
      toast.error("المرفق يجب ألا يتجاوز 5 ميجابايت.");
      return;
    }
    submit.mutate({
      title,
      description,
      priority,
      branchId: activeBranchId ?? null,
      orderId: orderId.trim() ? Number(orderId) : null,
      attachmentBase64: attachment ? await fileToBase64(attachment) : null,
      attachmentName: attachment?.name ?? null,
      attachmentType: attachment?.type ?? null,
    });
  }

  return (
    <>
      <button type="button" className="staff-feedback-trigger" onClick={() => setOpen(true)}>
        <MessageSquarePlus size={16} /> ملاحظة للمطوّر
      </button>
      {open && createPortal(
        <div className="staff-feedback-backdrop" role="presentation" onMouseDown={event => event.target === event.currentTarget && setOpen(false)}>
          <section className="staff-feedback-dialog" role="dialog" aria-modal="true" aria-labelledby="feedback-title" dir="rtl">
            <header><div><h2 id="feedback-title">إرسال ملاحظة للمطوّر</h2><p>ستصل الملاحظة مع الفرع والحساب ووقت الإرسال.</p></div><button type="button" onClick={() => setOpen(false)} aria-label="إغلاق"><X size={20} /></button></header>
            <form onSubmit={onSubmit}>
              <label><span>عنوان المشكلة</span><input value={title} onChange={event => setTitle(event.target.value)} placeholder="مثال: الطلب لم يظهر في شاشة المطبخ" /></label>
              <label><span>التفاصيل</span><textarea value={description} onChange={event => setDescription(event.target.value)} rows={5} placeholder="اكتب ماذا حدث والخطوات التي سبقت المشكلة" /></label>
              <div className="staff-feedback-grid">
                <label><span>الأولوية</span><select value={priority} onChange={event => setPriority(event.target.value as typeof priority)}><option value="low">منخفضة</option><option value="normal">عادية</option><option value="high">عالية</option><option value="urgent">عاجلة</option></select></label>
                <label><span>رقم الطلب (اختياري)</span><input inputMode="numeric" value={orderId} onChange={event => setOrderId(event.target.value.replace(/\D/g, ""))} /></label>
              </div>
              <label><span>صورة أو تسجيل صوتي (اختياري)</span><input type="file" accept="image/*,audio/*" onChange={event => setAttachment(event.target.files?.[0] ?? null)} /><small>{attachment ? attachment.name : "لا يوجد مرفق"}</small></label>
              <button className="primary-action" type="submit" disabled={submit.isPending}>{submit.isPending ? "جارٍ الإرسال…" : "إرسال الملاحظة"}</button>
            </form>
          </section>
        </div>,
        document.body
      )}
    </>
  );
}
