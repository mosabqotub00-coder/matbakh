import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Clipboard, KeyRound, Link2, RefreshCw, ShieldCheck, Trash2, Webhook } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";

type IntegrationPanelProps = {
  /** Parent may pass useBranch().branchId; null keeps all branch data disabled. */
  branchId?: number | null;
};

type RevealedKey = {
  label: string;
  key: string;
  tokenPrefix: string;
};

/**
 * Management-only UI. The panel intentionally describes the provider as pending:
 * no UNIFYERP endpoint, credential, or successful outbound call is fabricated here.
 */
export default function IntegrationPanel({ branchId = null }: IntegrationPanelProps) {
  const api = (trpc as any).integration;
  const queryBranchId = branchId ?? 0;
  const enabled = Boolean(branchId && branchId > 0);
  const [webhookUrl, setWebhookUrl] = useState("");
  const [keyLabel, setKeyLabel] = useState("");
  const [revealedKey, setRevealedKey] = useState<RevealedKey | null>(null);
  const [showAttempts, setShowAttempts] = useState(false);

  const config = api.config.useQuery({ branchId: queryBranchId }, { enabled, retry: false });
  const keys = api.listKeys.useQuery({ branchId: queryBranchId }, { enabled, retry: false });
  const attempts = api.attempts.useQuery({ branchId: queryBranchId, limit: 20, offset: 0 }, { enabled: showAttempts && enabled, retry: false });
  const utils = trpc.useUtils() as any;
  useEffect(() => {
    if (config.data && !webhookUrl) setWebhookUrl(config.data.webhookUrl ?? "");
  }, [config.data, webhookUrl]);
  const saveConfig = api.save.useMutation({
    onSuccess: (value: any) => {
      setWebhookUrl(value.webhookUrl ?? "");
      void config.refetch();
      toast.success("تم حفظ إعداد التكامل؛ الإرسال ما زال معطلاً حتى وصول توثيق المزود.");
    },
    onError: (error: any) => toast.error(error.message),
  });
  const createKey = api.createKey.useMutation({
    onSuccess: (value: RevealedKey) => {
      setKeyLabel("");
      setRevealedKey(value);
      void utils.integration.listKeys.invalidate({ branchId: queryBranchId });
      toast.success("تم إنشاء المفتاح. سيظهر السر مرة واحدة فقط.");
    },
    onError: (error: any) => toast.error(error.message),
  });
  const revokeKey = api.revokeKey.useMutation({
    onSuccess: () => {
      void utils.integration.listKeys.invalidate({ branchId: queryBranchId });
      toast.success("تم إلغاء المفتاح.");
    },
    onError: (error: any) => toast.error(error.message),
  });
  const flush = api.flush.useMutation({ onError: (error: any) => toast.error(error.message), onSuccess: (value: any) => toast.info(value.message) });

  const configMessage = config.data?.message ?? "توثيق UNIFYERP وعنوانه ومصادقته غير متاح بعد.";
  const activeKeys = useMemo(() => keys.data ?? [], [keys.data]);

  if (!enabled) {
    return <section className="manager-section integration-panel"><div className="empty-banner"><span className="empty-banner-icon"><Webhook size={19} /></span><div><strong>اختر فرعًا لإدارة التكامل</strong><p>مفاتيح API وإعدادات Webhook معزولة لكل فرع ولا تُعرض دون فرع مصادق عليه.</p></div></div></section>;
  }

  return <section className="manager-section integration-panel" dir="rtl">
    <div className="manager-section-head">
      <div><h2><Webhook size={20} /> تكامل الطلبات</h2><p>إعداد تمهيدي محصور بالفرع. لا يوجد ربط فعلي مع UNIFYERP قبل توفير وثائقه وعنوانه ومصادقته.</p></div>
      <span className="count-badge"><ShieldCheck size={15} /> فرع {branchId}</span>
    </div>

    <div className="manager-overdue-alert" role="status">
      <AlertTriangle size={19} />
      <div><strong>الإرسال الخارجي معطّل عمدًا</strong><p>{configMessage} لن تُرسل بيانات الطلبات أو الأسرار إلى عنوان غير موثق.</p></div>
    </div>

    <div className="integration-grid">
      <article className="product-add-card integration-card">
        <div className="add-card-title"><span className="section-icon green"><Link2 size={18} /></span><div><strong>عنوان Webhook</strong><small>HTTPS عام فقط؛ تُفحص DNS وتُمنع العناوين المحلية والخاصة وإعادة التوجيه.</small></div></div>
        <form className="product-new-form" onSubmit={event => { event.preventDefault(); saveConfig.mutate({ branchId: branchId!, webhookUrl: webhookUrl.trim() || null, enabled: false }); }}>
          <label><span>العنوان الموثق</span><input type="url" value={webhookUrl} onChange={event => setWebhookUrl(event.target.value)} placeholder="https://provider.example/webhook" maxLength={2048} /></label>
          <button className="primary-action" disabled={saveConfig.isPending} type="submit"><Link2 size={15} /> حفظ العنوان مع إبقاء الإرسال متوقفًا</button>
        </form>
      </article>

      <article className="product-add-card integration-card">
        <div className="add-card-title"><span className="section-icon green"><KeyRound size={18} /></span><div><strong>مفتاح API للفرع</strong><small>يُخزّن التجزئة فقط ويظهر السر الكامل مرة واحدة بعد الإنشاء.</small></div></div>
        <form className="product-new-form" onSubmit={event => { event.preventDefault(); if (keyLabel.trim()) createKey.mutate({ branchId: branchId!, label: keyLabel.trim() }); }}>
          <label><span>اسم المفتاح</span><input required value={keyLabel} onChange={event => setKeyLabel(event.target.value)} placeholder="نظام الطلبات الخارجي" maxLength={120} /></label>
          <button className="primary-action" disabled={createKey.isPending || !keyLabel.trim()} type="submit"><KeyRound size={15} /> إنشاء مفتاح</button>
        </form>
      </article>
    </div>

    {revealedKey && <article className="manager-tip integration-key-reveal" role="alert"><KeyRound size={17} /><div><strong>انسخ المفتاح الآن — لن يظهر كاملًا مرة أخرى</strong><p>{revealedKey.label} · {revealedKey.tokenPrefix}</p><code>{revealedKey.key}</code><button type="button" onClick={() => { void navigator.clipboard?.writeText(revealedKey.key); toast.success("تم نسخ المفتاح"); }}><Clipboard size={14} /> نسخ</button></div></article>}

    <article className="manager-products integration-key-list">
      <div className="manager-section-head"><div><h3>المفاتيح</h3><p>الإلغاء فوري ولا يحذف سجل التدقيق.</p></div><button className="secondary-action" type="button" onClick={() => void keys.refetch()}><RefreshCw size={14} /> تحديث</button></div>
      {activeKeys.length ? activeKeys.map((key: any) => <div className="manager-product" key={key.id}><div className="manager-product-icon"><KeyRound size={18} /></div><div className="manager-product-main"><strong>{key.label}</strong><span>{key.tokenPrefix}… · أُنشئ {new Date(key.createdAt).toLocaleString("ar-SA")}</span></div><span className={`product-state ${key.revokedAt ? "off" : "on"}`}>{key.revokedAt ? "ملغى" : "فعّال"}</span>{!key.revokedAt && <button className="cancel-edit" type="button" disabled={revokeKey.isPending} onClick={() => revokeKey.mutate({ branchId: branchId!, keyId: key.id })}><Trash2 size={14} /> إلغاء</button>}</div>) : <div className="empty-state">لا توجد مفاتيح لهذا الفرع.</div>}
    </article>

    <div className="integration-actions"><button className="secondary-action" type="button" onClick={() => setShowAttempts(value => !value)}><RefreshCw size={14} /> {showAttempts ? "إخفاء سجل المحاولات" : "عرض سجل المحاولات"}</button><button className="secondary-action" type="button" disabled title="معطل حتى توفر توثيق المزود" onClick={() => flush.mutate({ branchId: branchId!, limit: 20 })}><ShieldCheck size={14} /> فحص Outbox (معطّل)</button></div>
    {showAttempts && <article className="manager-products integration-attempts"><h3>آخر المحاولات</h3>{attempts.data?.length ? attempts.data.map((attempt: any) => <div className="manager-product" key={attempt.id}><div className="manager-product-main"><strong>{attempt.status}</strong><span>{attempt.error ?? "—"} · {new Date(attempt.attemptedAt).toLocaleString("ar-SA")}</span></div></div>) : <div className="empty-state">لا توجد محاولات محفوظة.</div>}</article>}
  </section>;
}
