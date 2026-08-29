'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { captionsToSrt, captionsToVtt, type Caption } from '../lib/subtitles';

const MAX_FILE_SIZE = 25 * 1024 * 1024;

type Phase = 'idle' | 'loading' | 'processing' | 'editor' | 'error';
type SaveState = 'saved' | 'saving' | 'unsaved';
type TranscriptionResult = {
  projectId: string;
  name: string;
  fileName: string;
  language: string;
  durationMs: number;
  captions: Caption[];
  error?: string;
  status?: string;
  errorMessage?: string | null;
};

function vietnameseHttpError(status: number) {
  if (status === 400) return 'Dữ liệu upload không hợp lệ.';
  if (status === 401 || status === 403) return 'Khóa OpenAI không hợp lệ hoặc chưa được cấp quyền.';
  if (status === 413) return 'Tệp video quá lớn. Hãy chọn tệp nhỏ hơn 25 MB.';
  if (status === 415) return 'Định dạng video chưa được hỗ trợ.';
  if (status === 429) return 'Dịch vụ đang bận. Vui lòng thử lại sau ít phút.';
  if (status === 404) return 'Không tìm thấy dự án.';
  if (status >= 500) return 'Máy chủ đang gặp sự cố. Vui lòng thử lại sau.';
  return 'Không thể hoàn tất yêu cầu. Vui lòng thử lại.';
}

function isVietnamese(message: string) {
  return /[à-ỹÀ-Ỹ]/.test(message);
}

function needsOpenAIBilling(message: string) {
  return message.includes('hết hạn mức') || message.includes('giới hạn chi tiêu');
}

async function readApiJson<T>(response: Response, fallback: string): Promise<T> {
  const raw = await response.text();
  let payload: (T & { error?: string }) | null = null;
  try {
    payload = JSON.parse(raw) as T & { error?: string };
  } catch {
    if (!response.ok) throw new Error(vietnameseHttpError(response.status));
    throw new Error(fallback);
  }
  if (!response.ok) {
    const message = payload?.error;
    throw new Error(message && isVietnamese(message) ? message : vietnameseHttpError(response.status));
  }
  return payload as T;
}

function formatSize(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function formatClock(seconds: number) {
  const safe = Math.max(0, seconds || 0);
  const minutes = Math.floor(safe / 60);
  const secs = Math.floor(safe % 60);
  const tenths = Math.floor((safe % 1) * 10);
  return `${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}.${tenths}`;
}

function downloadText(text: string, fileName: string, type: string) {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
}

function Logo() {
  return (
    <div className="flex items-center gap-3">
      <span className="grid h-9 w-9 place-items-center rounded-[12px] bg-[#1f3b2d] text-sm font-bold text-[#d7ff67] shadow-[0_8px_24px_rgba(31,59,45,0.16)]">S</span>
      <span className="text-[17px] font-semibold tracking-[-0.03em]">Subly</span>
    </div>
  );
}

export default function SubtitleStudio() {
  const [phase, setPhase] = useState<Phase>('idle');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [videoUrl, setVideoUrl] = useState('');
  const [language, setLanguage] = useState('auto');
  const [projectId, setProjectId] = useState('');
  const [projectName, setProjectName] = useState('Video mới');
  const [fileName, setFileName] = useState('');
  const [captions, setCaptions] = useState<Caption[]>([]);
  const [error, setError] = useState('');
  const [progress, setProgress] = useState(8);
  const [currentTime, setCurrentTime] = useState(0);
  const [saveState, setSaveState] = useState<SaveState>('saved');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (!selectedFile) return;
    const url = URL.createObjectURL(selectedFile);
    setVideoUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [selectedFile]);

  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get('project');
    if (!id) return;
    setPhase('loading');
    fetch(`/api/projects/${encodeURIComponent(id)}`)
      .then(async (response) => {
        const data = await readApiJson<TranscriptionResult>(response, 'Không thể mở dự án.');
        if (data.status === 'failed') {
          const message = data.errorMessage || '';
          throw new Error(isVietnamese(message) ? message : 'Dự án xử lý thất bại.');
        }
        setProjectId(data.projectId);
        setProjectName(data.name);
        setFileName(data.fileName);
        setLanguage(data.language || 'auto');
        setCaptions(data.captions || []);
        setVideoUrl(`/api/projects/${encodeURIComponent(data.projectId)}/media`);
        setPhase('editor');
      })
      .catch((reason: Error) => {
        setError(isVietnamese(reason.message) ? reason.message : 'Không thể mở dự án. Vui lòng thử lại.');
        setPhase('error');
      });
  }, []);

  useEffect(() => {
    if (phase !== 'processing') return;
    setProgress(8);
    const timer = window.setInterval(() => {
      setProgress((value) => Math.min(92, value + Math.max(1, Math.round((94 - value) / 11))));
    }, 650);
    return () => window.clearInterval(timer);
  }, [phase]);

  useEffect(() => {
    if (phase !== 'editor' || !projectId || !captions.length) return;
    setSaveState('unsaved');
    const timer = window.setTimeout(async () => {
      setSaveState('saving');
      try {
        const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ captions }),
        });
        if (!response.ok) throw new Error('Không thể lưu thay đổi.');
        setSaveState('saved');
      } catch {
        setSaveState('unsaved');
      }
    }, 900);
    return () => window.clearTimeout(timer);
  }, [captions, phase, projectId]);

  const activeIndex = useMemo(
    () => captions.findIndex((caption) => currentTime >= caption.start && currentTime <= caption.end),
    [captions, currentTime],
  );
  const activeCaption = activeIndex >= 0 ? captions[activeIndex] : null;

  async function transcribe(file: File) {
    setSelectedFile(file);
    setFileName(file.name);
    setProjectName(file.name.replace(/\.[^.]+$/, '') || 'Video mới');
    setError('');
    setPhase('processing');

    try {
      const form = new FormData();
      form.set('file', file);
      form.set('language', language);
      const response = await fetch('/api/transcribe', { method: 'POST', body: form });
      const data = await readApiJson<TranscriptionResult>(response, 'Không thể tạo phụ đề.');
      setProgress(100);
      setProjectId(data.projectId);
      setProjectName(data.name);
      setFileName(data.fileName);
      setLanguage(data.language || language);
      setCaptions(data.captions);
      setSaveState('saved');
      window.history.replaceState({}, '', `?project=${encodeURIComponent(data.projectId)}`);
      window.setTimeout(() => setPhase('editor'), 350);
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : '';
      setError(isVietnamese(message) ? message : 'Không thể kết nối tới máy chủ. Vui lòng thử lại.');
      setPhase('error');
    }
  }

  function handleFile(file: File | undefined) {
    if (!file) return;
    if (!file.type.startsWith('video/') && !file.type.startsWith('audio/')) {
      setError('Hãy chọn file MP4, MOV hoặc WebM.');
      return;
    }
    if (file.size > MAX_FILE_SIZE) {
      setError('Video vượt quá 25 MB. Hãy chọn video ngắn hơn cho bản thử nghiệm.');
      return;
    }
    void transcribe(file);
  }

  function resetProject() {
    setPhase('idle');
    setSelectedFile(null);
    setVideoUrl('');
    setProjectId('');
    setProjectName('Video mới');
    setFileName('');
    setCaptions([]);
    setError('');
    setCurrentTime(0);
    window.history.replaceState({}, '', window.location.pathname);
  }

  function updateCaption(id: string, changes: Partial<Caption>) {
    setCaptions((items) =>
      items.map((item) => {
        if (item.id !== id) return item;
        const updated = { ...item, ...changes };
        if (updated.end <= updated.start) updated.end = updated.start + 0.5;
        return updated;
      }),
    );
  }

  function seekTo(caption: Caption) {
    setCurrentTime(caption.start);
    if (videoRef.current) {
      videoRef.current.currentTime = caption.start;
      void videoRef.current.play().catch(() => undefined);
    }
  }

  function addCaption(afterIndex: number) {
    const previous = captions[Math.max(0, afterIndex)];
    const start = previous ? previous.end + 0.1 : currentTime;
    const next: Caption = {
      id: `caption-${Date.now()}`,
      start,
      end: start + 2.5,
      text: 'Nhập phụ đề mới…',
    };
    const copy = [...captions];
    copy.splice(afterIndex + 1, 0, next);
    setCaptions(copy);
  }

  function removeCaption(id: string) {
    setCaptions((items) => items.filter((item) => item.id !== id));
  }

  function exportCaptions(kind: 'srt' | 'vtt') {
    const base = (projectName || 'phu-de').replace(/[\\/:*?"<>|]/g, '-');
    if (kind === 'srt') downloadText(captionsToSrt(captions), `${base}.srt`, 'application/x-subrip;charset=utf-8');
    else downloadText(captionsToVtt(captions), `${base}.vtt`, 'text/vtt;charset=utf-8');
  }

  if (phase === 'loading') {
    return (
      <main className="grid min-h-screen place-items-center bg-[#f4f2ed] px-5 text-[#1c1f1a]">
        <div className="text-center">
          <div className="mx-auto mb-5 h-11 w-11 animate-spin rounded-full border-4 border-[#d8ddd3] border-t-[#1f3b2d]" />
          <p className="font-semibold">Đang mở dự án…</p>
        </div>
      </main>
    );
  }

  if (phase === 'editor') {
    return (
      <main className="min-h-screen bg-[#eeece6] text-[#1c1f1a]">
        <header className="sticky top-0 z-30 border-b border-[#d8d6cf] bg-[#f8f7f3]/95 backdrop-blur-xl">
          <div className="mx-auto flex h-[72px] max-w-[1500px] items-center justify-between gap-4 px-4 sm:px-6">
            <div className="flex min-w-0 items-center gap-5">
              <button onClick={resetProject} aria-label="Về trang đầu"><Logo /></button>
              <span className="hidden h-7 w-px bg-[#dedcd5] sm:block" />
              <div className="min-w-0">
                <p className="max-w-[38vw] truncate text-sm font-semibold sm:max-w-md">{projectName}</p>
                <p className="mt-0.5 text-[11px] text-[#7d8279]" aria-live="polite">
                  {saveState === 'saved' ? '✓ Đã lưu' : saveState === 'saving' ? 'Đang lưu…' : 'Chưa lưu'}
                </p>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <button onClick={() => exportCaptions('vtt')} className="hidden rounded-full border border-[#d2d1ca] bg-white px-4 py-2.5 text-sm font-semibold transition hover:border-[#9fa49a] sm:block">Xuất VTT</button>
              <button onClick={() => exportCaptions('srt')} className="rounded-full bg-[#1f3b2d] px-4 py-2.5 text-sm font-semibold text-white shadow-[0_8px_18px_rgba(31,59,45,0.16)] transition hover:bg-[#294c3a] sm:px-5">Tải SRT ↓</button>
            </div>
          </div>
        </header>

        <div className="mx-auto grid max-w-[1500px] gap-5 p-4 sm:p-6 lg:grid-cols-[minmax(0,1.18fr)_minmax(390px,0.82fr)]">
          <section className="min-w-0">
            <div className="relative overflow-hidden rounded-[26px] bg-[#111611] shadow-[0_24px_60px_rgba(28,34,27,0.15)]">
              <video
                ref={videoRef}
                src={videoUrl}
                controls
                className="aspect-video w-full bg-black object-contain"
                onTimeUpdate={(event) => setCurrentTime(event.currentTarget.currentTime)}
              />
              {activeCaption && (
                <div className="pointer-events-none absolute inset-x-5 bottom-16 flex justify-center">
                  <p className="max-w-[82%] rounded-lg bg-black/78 px-4 py-2 text-center text-[clamp(1rem,2.2vw,1.55rem)] font-semibold leading-snug text-white shadow-lg backdrop-blur-sm">{activeCaption.text}</p>
                </div>
              )}
            </div>

            <div className="mt-5 rounded-[24px] border border-[#dbd9d1] bg-[#faf9f6] p-5">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[#8a8f85]">Đang phát</p>
                  <p className="mt-1 font-mono text-2xl font-semibold tracking-[-0.04em]">{formatClock(currentTime)}</p>
                </div>
                <div className="flex items-center gap-3 text-xs font-medium text-[#62685f]">
                  <span className="rounded-full bg-[#e4edc4] px-3 py-1.5">{language === 'vi' ? 'Tiếng Việt' : language === 'en' ? 'English' : language}</span>
                  <span>{captions.length} đoạn</span>
                </div>
              </div>
              <div className="mt-5 flex h-16 items-end gap-[3px] overflow-hidden rounded-xl bg-[#ecece5] px-3 py-2" aria-hidden="true">
                {Array.from({ length: 72 }, (_, index) => {
                  const height = 18 + ((index * 17) % 38);
                  const active = captions.length && index / 72 <= currentTime / Math.max(1, captions[captions.length - 1].end);
                  return <span key={index} className={`min-w-[2px] flex-1 rounded-full ${active ? 'bg-[#789b32]' : 'bg-[#c5c9be]'}`} style={{ height }} />;
                })}
              </div>
            </div>
          </section>

          <section className="flex min-h-[620px] flex-col overflow-hidden rounded-[26px] border border-[#d9d7d0] bg-[#f9f8f4] shadow-[0_18px_50px_rgba(38,45,37,0.08)] lg:h-[calc(100vh-120px)]">
            <div className="flex items-center justify-between border-b border-[#e2e0d9] px-5 py-4">
              <div>
                <h1 className="text-lg font-semibold tracking-[-0.03em]">Phụ đề</h1>
                <p className="text-xs text-[#858a81]">Chọn một câu để phát từ đoạn đó</p>
              </div>
              <button onClick={() => addCaption(Math.max(-1, activeIndex))} className="grid h-9 w-9 place-items-center rounded-full bg-[#e7eccd] text-xl text-[#35513e] transition hover:bg-[#dce6ae]" aria-label="Thêm phụ đề">+</button>
            </div>

            <div className="flex-1 space-y-3 overflow-y-auto p-3 sm:p-4">
              {captions.map((caption, index) => (
                <article
                  key={caption.id}
                  className={`group rounded-[18px] border p-3 transition ${index === activeIndex ? 'border-[#789b32] bg-[#f1f6df] shadow-[0_8px_24px_rgba(76,96,48,0.09)]' : 'border-[#e2e0d9] bg-white hover:border-[#bfc4b8]'}`}
                >
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <button onClick={() => seekTo(caption)} className="flex items-center gap-2 text-left text-[11px] font-semibold text-[#6c7468]">
                      <span className={`grid h-6 w-6 place-items-center rounded-full ${index === activeIndex ? 'bg-[#789b32] text-white' : 'bg-[#eceee7]'}`}>{index === activeIndex ? '▶' : index + 1}</span>
                      PHÁT ĐOẠN NÀY
                    </button>
                    <button onClick={() => removeCaption(caption.id)} className="rounded-md px-2 py-1 text-xs text-[#a1a59e] opacity-0 transition hover:bg-[#f3e9e5] hover:text-[#9e4934] group-hover:opacity-100 focus:opacity-100" aria-label={`Xóa phụ đề ${index + 1}`}>Xóa</button>
                  </div>
                  <textarea
                    value={caption.text}
                    onChange={(event) => updateCaption(caption.id, { text: event.target.value })}
                    className="min-h-[68px] w-full resize-y rounded-xl border-0 bg-transparent p-1 text-[15px] font-medium leading-6 outline-none placeholder:text-[#aaa]"
                    aria-label={`Nội dung phụ đề ${index + 1}`}
                  />
                  <div className="mt-2 grid grid-cols-[1fr_auto_1fr] items-center gap-2">
                    <label className="rounded-lg bg-[#f1f1ec] px-2 py-1.5 text-[10px] font-semibold text-[#858a81]">
                      BẮT ĐẦU
                      <input type="number" min="0" step="0.1" value={caption.start.toFixed(1)} onChange={(event) => updateCaption(caption.id, { start: Number(event.target.value) })} className="ml-2 w-14 bg-transparent font-mono text-xs text-[#41463f] outline-none" />
                    </label>
                    <span className="text-[#a8aca4]">→</span>
                    <label className="rounded-lg bg-[#f1f1ec] px-2 py-1.5 text-[10px] font-semibold text-[#858a81]">
                      KẾT THÚC
                      <input type="number" min="0" step="0.1" value={caption.end.toFixed(1)} onChange={(event) => updateCaption(caption.id, { end: Number(event.target.value) })} className="ml-2 w-14 bg-transparent font-mono text-xs text-[#41463f] outline-none" />
                    </label>
                  </div>
                </article>
              ))}
            </div>
            <div className="border-t border-[#e2e0d9] bg-white/70 p-3 sm:hidden">
              <button onClick={() => exportCaptions('vtt')} className="w-full rounded-full border border-[#d2d1ca] bg-white px-4 py-2.5 text-sm font-semibold">Xuất VTT</button>
            </div>
          </section>
        </div>
      </main>
    );
  }

  if (phase === 'processing') {
    return (
      <main className="min-h-screen bg-[#f4f2ed] px-5 py-6 text-[#1c1f1a] sm:px-8">
        <header className="mx-auto flex max-w-[1160px] items-center justify-between"><Logo /><span className="text-xs font-medium text-[#777d74]">Đang tạo dự án</span></header>
        <section className="mx-auto grid min-h-[calc(100vh-90px)] max-w-[920px] place-items-center py-12">
          <div className="w-full rounded-[32px] border border-white bg-[#fcfbf8] p-5 shadow-[0_30px_90px_rgba(38,45,37,0.13)] sm:p-8">
            <div className="grid gap-7 sm:grid-cols-[180px_1fr] sm:items-center">
              <div className="overflow-hidden rounded-[20px] bg-[#192019]">
                {videoUrl ? <video src={videoUrl} muted className="aspect-video h-full w-full object-cover sm:aspect-[4/3]" /> : <div className="aspect-video sm:aspect-[4/3]" />}
              </div>
              <div className="min-w-0">
                <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[#789b32]">AI đang lắng nghe</p>
                <h1 className="mt-2 text-2xl font-semibold tracking-[-0.04em] sm:text-3xl">Đang tạo phụ đề…</h1>
                <p className="mt-2 truncate text-sm text-[#777d74]">{fileName} · {selectedFile ? formatSize(selectedFile.size) : ''}</p>
                <div className="mt-6 h-2 overflow-hidden rounded-full bg-[#e5e6df]"><div className="h-full rounded-full bg-[#8ebd27] transition-all duration-500" style={{ width: `${progress}%` }} /></div>
                <div className="mt-5 grid grid-cols-3 gap-2 text-center text-[11px] font-semibold text-[#858a81]">
                  <span className="text-[#35513e]">✓ Tải video</span>
                  <span className={progress > 35 ? 'text-[#35513e]' : ''}>{progress > 65 ? '✓' : '●'} Nhận giọng</span>
                  <span className={progress > 78 ? 'text-[#35513e]' : ''}>{progress >= 100 ? '✓' : '○'} Canh thời gian</span>
                </div>
              </div>
            </div>
            <p className="mt-7 border-t border-[#e4e2db] pt-5 text-center text-xs leading-5 text-[#8a8f86]">Bạn có thể giữ trang này mở. Video được xử lý riêng tư trong dự án của bạn.</p>
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className="min-h-screen overflow-hidden bg-[#f4f2ed] text-[#1c1f1a]">
      <header className="mx-auto flex max-w-[1240px] items-center justify-between px-5 py-5 sm:px-8 lg:px-10">
        <Logo />
        <div className="flex items-center gap-3 text-sm"><span className="hidden text-[#6f756c] sm:inline">Không cần cài đặt</span><button onClick={() => fileInputRef.current?.click()} className="rounded-full border border-[#d9d7d0] bg-white/70 px-4 py-2 font-medium transition hover:border-[#a9ada4] hover:bg-white">Tạo phụ đề</button></div>
      </header>

      <section className="mx-auto grid min-h-[calc(100vh-80px)] max-w-[1240px] items-center gap-12 px-5 pb-16 pt-8 sm:px-8 lg:grid-cols-[0.88fr_1.12fr] lg:px-10 lg:pb-24 lg:pt-4">
        <div className="relative z-10 max-w-xl">
          <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-[#d8dbcf] bg-[#f9f8f4] px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.12em] text-[#4d6758]"><span className="h-2 w-2 rounded-full bg-[#9dca2b] shadow-[0_0_0_4px_rgba(157,202,43,0.14)]" />Phụ đề AI cho tiếng Việt</div>
          <h1 className="max-w-[620px] text-[clamp(3.25rem,7vw,6.5rem)] font-semibold leading-[0.9] tracking-[-0.075em]">Video vào.<span className="block text-[#5e7467]">Phụ đề ra.</span></h1>
          <p className="mt-7 max-w-lg text-base leading-7 text-[#666c63] sm:text-lg">Tự động nghe, canh thời gian và tạo phụ đề có thể chỉnh sửa. Xuất SRT hoặc VTT chỉ trong vài phút.</p>
          <div className="mt-9 flex flex-wrap gap-x-6 gap-y-3 text-sm font-medium text-[#4f564d]">
            {['Tự nhận diện ngôn ngữ', 'Chỉnh sửa từng câu', 'Xuất SRT & VTT'].map((item) => <span className="flex items-center gap-2" key={item}><span className="grid h-5 w-5 place-items-center rounded-full bg-[#dceaa7] text-[11px] text-[#294332]">✓</span>{item}</span>)}
          </div>
        </div>

        <div className="relative">
          <div className="absolute -left-16 -top-16 h-52 w-52 rounded-full bg-[#d9ff71]/55 blur-3xl" />
          <div className="absolute -bottom-12 -right-8 h-64 w-64 rounded-full bg-[#c3ddd0]/55 blur-3xl" />
          <div className="relative rounded-[32px] border border-white/80 bg-[#fcfbf8] p-3 shadow-[0_30px_90px_rgba(38,45,37,0.13)] sm:p-5">
            <div className="flex items-center justify-between px-2 pb-4 pt-1 text-xs font-medium text-[#777c74]"><span>DỰ ÁN MỚI</span><label className="flex items-center gap-2"><span>NGÔN NGỮ</span><select value={language} onChange={(event) => setLanguage(event.target.value)} className="rounded-full border border-[#deddd6] bg-white px-2 py-1 outline-none"><option value="auto">Tự động</option><option value="vi">Tiếng Việt</option><option value="en">English</option></select></label></div>
            <div
              onDragOver={(event) => { event.preventDefault(); event.currentTarget.classList.add('border-[#789b32]'); }}
              onDragLeave={(event) => event.currentTarget.classList.remove('border-[#789b32]')}
              onDrop={(event) => { event.preventDefault(); event.currentTarget.classList.remove('border-[#789b32]'); handleFile(event.dataTransfer.files[0]); }}
              className="grid min-h-[430px] place-items-center rounded-[24px] border border-dashed border-[#aeb5a8] bg-[#f5f5ee] p-7 text-center transition hover:border-[#6d806f] hover:bg-[#f1f3e9] sm:min-h-[500px]"
            >
              <div className="max-w-sm">
                <div className="mx-auto mb-7 grid h-20 w-20 place-items-center rounded-[26px] bg-[#1f3b2d] text-[#d7ff67] shadow-[0_16px_36px_rgba(31,59,45,0.2)]"><span className="text-3xl leading-none">↑</span></div>
                <h2 className="text-2xl font-semibold tracking-[-0.04em]">Thả video vào đây</h2>
                <p className="mt-2 text-sm leading-6 text-[#747a71]">hoặc chọn một video từ máy tính của bạn</p>
                <input ref={fileInputRef} type="file" accept="video/mp4,video/quicktime,video/webm,audio/*" className="sr-only" onChange={(event) => handleFile(event.target.files?.[0])} />
                <button onClick={() => fileInputRef.current?.click()} className="mt-7 rounded-full bg-[#d7ff67] px-6 py-3 text-sm font-semibold text-[#203429] shadow-[0_8px_20px_rgba(154,195,58,0.22)] transition hover:-translate-y-0.5 hover:bg-[#caff48]">Chọn video</button>
                <p className="mt-6 text-xs text-[#92968f]">MP4, MOV, WebM · Tối đa 25 MB</p>
                {error && phase === 'idle' && <p className="mt-4 rounded-xl bg-[#f8e9e4] px-3 py-2 text-sm text-[#9b4937]" role="alert">{error}</p>}
              </div>
            </div>
          </div>
        </div>
      </section>

      {phase === 'error' && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-[#132018]/50 px-5 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="error-title">
          <div className="w-full max-w-md rounded-[28px] bg-[#fcfbf8] p-7 shadow-2xl">
            <span className="grid h-11 w-11 place-items-center rounded-2xl bg-[#f5ded6] font-bold text-[#a84f39]">!</span>
            <h2 id="error-title" className="mt-5 text-2xl font-semibold tracking-[-0.04em]">Chưa thể tạo phụ đề</h2>
            <p className="mt-2 text-sm leading-6 text-[#6e746b]">{error}</p>
            {error.includes('OPENAI_API_KEY') && <p className="mt-4 rounded-xl bg-[#f1f3e8] p-3 text-xs leading-5 text-[#596456]">Thêm khóa vào file <code>.dev.vars</code> theo mẫu trong dự án, sau đó chạy lại app.</p>}
            {needsOpenAIBilling(error) && (
              <div className="mt-4 rounded-xl bg-[#f1f3e8] p-3 text-xs leading-5 text-[#596456]">
                <p>Hãy nạp credit hoặc điều chỉnh giới hạn chi tiêu của dự án OpenAI, sau đó bấm “Thử lại”.</p>
                <a
                  href="https://platform.openai.com/settings/organization/billing/overview"
                  target="_blank"
                  rel="noreferrer"
                  className="mt-2 inline-flex font-semibold text-[#35513e] underline decoration-[#9cbc4c] underline-offset-2"
                >
                  Mở Billing OpenAI ↗
                </a>
              </div>
            )}
            <div className="mt-6 flex gap-3">
              <button onClick={resetProject} className="flex-1 rounded-full border border-[#d4d2cb] px-4 py-2.5 text-sm font-semibold">Chọn video khác</button>
              {selectedFile && <button onClick={() => void transcribe(selectedFile)} className="flex-1 rounded-full bg-[#1f3b2d] px-4 py-2.5 text-sm font-semibold text-white">Thử lại</button>}
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
