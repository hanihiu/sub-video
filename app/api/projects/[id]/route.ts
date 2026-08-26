import { ensureProjectsTable, getProject, saveProjectCaptions } from '../../../../db/projects';
import type { Caption } from '../../../../lib/subtitles';

type RouteContext = { params: Promise<{ id: string }> };

function errorResponse(status: number) {
  if (status === 404) return Response.json({ error: 'Không tìm thấy dự án.' }, { status });
  if (status === 400) return Response.json({ error: 'Dữ liệu phụ đề không hợp lệ.' }, { status });
  return Response.json({ error: 'Không thể xử lý dự án lúc này. Vui lòng thử lại.' }, { status });
}

export async function GET(_request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    await ensureProjectsTable();
    const project = await getProject(id);
    if (!project) return errorResponse(404);
    return Response.json({
      projectId: project.id,
      name: project.name,
      fileName: project.fileName,
      language: project.language,
      durationMs: project.durationMs,
      status: project.status,
      captions: project.captions,
      errorMessage: project.errorMessage,
    });
  } catch {
    return errorResponse(500);
  }
}

export async function PUT(request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    let body: { captions?: Caption[] };
    try {
      body = (await request.json()) as { captions?: Caption[] };
    } catch {
      return errorResponse(400);
    }
    if (!Array.isArray(body.captions) || body.captions.length > 5000) return errorResponse(400);
    const captions = body.captions.map((caption, index) => ({
      id: String(caption.id || `caption-${index + 1}`),
      start: Math.max(0, Number(caption.start) || 0),
      end: Math.max(Number(caption.start) + 0.1, Number(caption.end) || 0),
      text: String(caption.text || '').slice(0, 1000),
    }));
    await ensureProjectsTable();
    if (!(await getProject(id))) return errorResponse(404);
    await saveProjectCaptions(id, captions);
    return Response.json({ saved: true, updatedAt: Date.now() });
  } catch {
    return errorResponse(500);
  }
}
