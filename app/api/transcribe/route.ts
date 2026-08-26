import { env } from 'cloudflare:workers';
import { completeProject, createProject, ensureProjectsTable, failProject } from '../../../db/projects';
import { buildCaptions } from '../../../lib/subtitles';

const MAX_FILE_SIZE = 25 * 1024 * 1024;
const ACCEPTED_TYPES = new Set([
  'video/mp4',
  'video/quicktime',
  'video/webm',
  'audio/mpeg',
  'audio/mp4',
  'audio/wav',
  'audio/webm',
]);

type OpenAITranscription = {
  language?: string;
  duration?: number;
  words?: Array<{ word?: string; start?: number; end?: number }>;
  segments?: Array<{ text?: string; start?: number; end?: number }>;
  error?: { message?: string };
};

function jsonError(message: string, status: number) {
  return Response.json({ error: message }, { status });
}

function vietnameseError(status: number, fallback?: string) {
  if (status === 400) return 'Video không hợp lệ hoặc không thể đọc được âm thanh.';
  if (status === 401 || status === 403) return 'Khóa OpenAI không hợp lệ hoặc chưa được cấp quyền.';
  if (status === 413) return 'Tệp video quá lớn. Hãy chọn tệp nhỏ hơn 25 MB.';
  if (status === 415) return 'Định dạng video chưa được hỗ trợ.';
  if (status === 429) return 'Dịch vụ đang bận. Vui lòng thử lại sau ít phút.';
  if (status >= 500) return 'Dịch vụ tạo phụ đề đang gặp sự cố. Vui lòng thử lại sau.';
  if (fallback && /[à-ỹÀ-Ỹ]/.test(fallback)) return fallback;
  return 'Không thể tạo phụ đề lúc này. Vui lòng thử lại.';
}

function safeFileName(name: string) {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-120) || 'video.mp4';
}

export async function POST(request: Request) {
  let projectId: string | null = null;
  try {
    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      return jsonError('Dữ liệu upload không hợp lệ.', 400);
    }
    const file = form.get('file');
    const language = String(form.get('language') || 'auto');

    if (!(file instanceof File)) return jsonError('Vui lòng chọn một video hợp lệ.', 400);
    if (!file.size) return jsonError('Video đang trống.', 400);
    if (file.size > MAX_FILE_SIZE) return jsonError('Video vượt quá giới hạn 25 MB của bản thử nghiệm.', 413);
    if (!ACCEPTED_TYPES.has(file.type) && !file.type.startsWith('video/')) {
      return jsonError('Định dạng này chưa được hỗ trợ. Hãy dùng MP4, MOV hoặc WebM.', 415);
    }
    if (!env.OPENAI_API_KEY) return jsonError('Chưa cấu hình OPENAI_API_KEY cho máy chủ.', 503);

    projectId = crypto.randomUUID();
    const fileName = safeFileName(file.name);
    const fileKey = `uploads/${projectId}/${fileName}`;
    const projectName = file.name.replace(/\.[^.]+$/, '') || 'Video mới';

    await ensureProjectsTable();
    await env.FILES.put(fileKey, await file.arrayBuffer(), {
      httpMetadata: { contentType: file.type || 'application/octet-stream' },
      customMetadata: { originalName: file.name },
    });
    await createProject({
      id: projectId,
      name: projectName,
      fileName: file.name,
      fileKey,
      fileType: file.type || 'video/mp4',
      language,
    });

    const openAIForm = new FormData();
    openAIForm.set('file', file, fileName);
    openAIForm.set('model', 'whisper-1');
    openAIForm.set('response_format', 'verbose_json');
    openAIForm.append('timestamp_granularities[]', 'word');
    if (language !== 'auto') openAIForm.set('language', language);

    const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}` },
      body: openAIForm,
    });
    const rawResponse = await response.text();
    let result: OpenAITranscription = {};
    try {
      result = JSON.parse(rawResponse) as OpenAITranscription;
    } catch {
      throw new Error(vietnameseError(response.status));
    }
    if (!response.ok) {
      throw new Error(vietnameseError(response.status, result.error?.message));
    }

    const captions = buildCaptions(result.words, result.segments);
    if (!captions.length) throw new Error('Không tìm thấy giọng nói rõ ràng trong video.');
    const detectedLanguage = result.language || language;
    const durationMs = Math.round((result.duration || captions[captions.length - 1].end) * 1000);
    await completeProject(projectId, captions, detectedLanguage, durationMs);
    return Response.json({ projectId, name: projectName, fileName: file.name, language: detectedLanguage, durationMs, captions });
  } catch (error) {
    const rawMessage = error instanceof Error ? error.message : '';
    const message = /[à-ỹÀ-Ỹ]/.test(rawMessage) ? rawMessage : vietnameseError(500);
    if (projectId) {
      try {
        await failProject(projectId, message);
      } catch {
        // Preserve the original transcription error.
      }
    }
    return jsonError(message, 500);
  }
}
