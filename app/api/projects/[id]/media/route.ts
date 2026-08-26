import { env } from 'cloudflare:workers';
import { ensureProjectsTable, getProject } from '../../../../../db/projects';

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    await ensureProjectsTable();
    const project = await getProject(id);
    if (!project) return new Response('Không tìm thấy video.', { status: 404 });
    const object = await env.FILES.get(project.fileKey);
    if (!object) return new Response('Video đã được xóa.', { status: 404 });
    return new Response(object.body, {
      headers: {
        'Content-Type': project.fileType,
        'Content-Length': String(object.size),
        'Cache-Control': 'private, max-age=3600',
        'Content-Disposition': `inline; filename="${project.fileName.replace(/["\r\n]/g, '_')}"`,
      },
    });
  } catch {
    return new Response('Không thể tải video lúc này.', { status: 500 });
  }
}
