import { useEffect, useRef, useState } from "react";
import { Mic, Square, Trash2, Volume2 } from "lucide-react";
import { toast } from "sonner";

const MAX_BYTES = 5 * 1024 * 1024;
const MIME_OPTIONS = ["audio/webm;codecs=opus", "audio/mp4", "audio/webm", "audio/ogg"];

export default function VoiceNoteRecorder({ value, onChange }: { value: Blob | null; onChange: (value: Blob | null) => void }) {
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [previewUrl, setPreviewUrl] = useState("");
  const recorder = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const chunks = useRef<Blob[]>([]);
  const stopTimer = useRef<number | null>(null);

  useEffect(() => {
    if (!value) { setPreviewUrl(""); return; }
    const url = URL.createObjectURL(value);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [value]);

  useEffect(() => {
    if (!recording) { setSeconds(0); return; }
    const start = Date.now();
    const id = window.setInterval(() => setSeconds(Math.floor((Date.now() - start) / 1000)), 250);
    return () => window.clearInterval(id);
  }, [recording]);

  useEffect(() => () => {
    if (stopTimer.current) window.clearTimeout(stopTimer.current);
    if (recorder.current?.state === "recording") recorder.current.stop();
    stream.current?.getTracks().forEach(track => track.stop());
  }, []);

  const start = async () => {
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
      toast.error("تسجيل الصوت غير مدعوم في هذا المتصفح"); return;
    }
    try {
      const media = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.current = media;
      const mimeType = MIME_OPTIONS.find(type => MediaRecorder.isTypeSupported(type));
      const instance = new MediaRecorder(media, mimeType ? { mimeType } : undefined);
      recorder.current = instance; chunks.current = [];
      instance.ondataavailable = event => { if (event.data.size) chunks.current.push(event.data); };
      instance.onstop = () => {
        const blob = new Blob(chunks.current, { type: instance.mimeType || "audio/webm" });
        media.getTracks().forEach(track => track.stop()); stream.current = null;
        setRecording(false);
        if (blob.size > MAX_BYTES) { toast.error("التسجيل تجاوز الحد الأقصى 5 ميغابايت"); onChange(null); return; }
        if (blob.size) { onChange(blob); toast.success("تم إرفاق التعليق الصوتي بالطلب"); }
      };
      instance.start(); setRecording(true);
      stopTimer.current = window.setTimeout(() => { if (instance.state === "recording") instance.stop(); }, 30_000);
    } catch {
      toast.error("تعذر الوصول إلى الميكروفون. تحقق من صلاحية الموقع");
    }
  };

  const stop = () => {
    if (stopTimer.current) window.clearTimeout(stopTimer.current);
    if (recorder.current?.state === "recording") recorder.current.stop();
  };

  return <div className="voice-recorder">
    <div className="voice-recorder-top"><div><span className="voice-icon"><Mic size={15} /></span><span><strong>تعليق صوتي للمطبخ</strong><small>اختياري · حتى 30 ثانية</small></span></div>
      {recording ? <button type="button" className="record-button stop" onClick={stop}><Square size={13} fill="currentColor" /> إيقاف <b>{String(Math.floor(seconds / 60)).padStart(2,"0")}:{String(seconds % 60).padStart(2,"0")}</b></button> : value ? <button type="button" className="record-button remove" onClick={() => onChange(null)}><Trash2 size={14} /> إزالة</button> : <button type="button" className="record-button" onClick={start}><Mic size={14} /> تسجيل</button>}
    </div>
    {recording && <div className="recording-live"><i /> جاري التسجيل… سيقف تلقائيًا بعد 30 ثانية</div>}
    {value && previewUrl && <div className="voice-preview"><Volume2 size={14} /><audio controls preload="metadata" src={previewUrl} /></div>}
  </div>;
}
