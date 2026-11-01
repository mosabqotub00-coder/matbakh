import { useState } from "react";
import { KeyRound, Mail } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";

/** Optional: lets a signed-in staff member link an email so they can also log in with it. */
export default function AccountEmailSettings() {
  const utils = trpc.useUtils();
  const me = trpc.auth.me.useQuery(undefined, { retry: false });
  const current = (me.data as { email?: string | null } | null | undefined)?.email ?? "";
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const save = trpc.auth.setEmail.useMutation({
    onSuccess: user => { utils.auth.me.setData(undefined, user); setPassword(""); setEmail(""); toast.success("تم حفظ البريد الإلكتروني."); },
    onError: error => toast.error(error.message),
  });
  return (
    <section className="manager-section account-email-card" data-testid="account-email-settings" dir="rtl">
      <div className="manager-section-head"><div><h2><Mail size={18} /> البريد الإلكتروني للحساب (اختياري)</h2>
        <p className="staff-hint">{current ? <>البريد الحالي: <bdi dir="ltr" data-testid="account-email-current">{current}</bdi>. يمكنك الدخول به بدل اسم المستخدم.</> : "اربط بريدًا لتتمكن من الدخول به بدل اسم المستخدم."}</p></div></div>
      <form className="auth-form" onSubmit={event => { event.preventDefault(); save.mutate({ email: email.trim() || null, currentPassword: password }); }}>
        <label><span>البريد الإلكتروني</span><div className="auth-input-wrap"><Mail size={17} /><input data-testid="account-email-input" type="email" dir="ltr" autoComplete="email" maxLength={320} value={email} onChange={event => setEmail(event.target.value)} placeholder={current || "name@example.com"} /></div></label>
        <label><span>كلمة المرور الحالية</span><div className="auth-input-wrap"><KeyRound size={17} /><input data-testid="account-email-password" type="password" required autoComplete="current-password" value={password} onChange={event => setPassword(event.target.value)} /></div></label>
        <button type="submit" className="auth-submit" data-testid="account-email-save" disabled={save.isPending || (!email.trim() && !current)}>{save.isPending ? "جارٍ الحفظ…" : email.trim() ? "حفظ البريد" : "إزالة البريد"}</button>
      </form>
    </section>
  );
}
