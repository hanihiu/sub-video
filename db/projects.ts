import { env } from 'cloudflare:workers';
import type { Caption, ProjectRecord } from '../lib/subtitles';

const PROJECTS_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    file_name TEXT NOT NULL,
    file_key TEXT NOT NULL,
    file_type TEXT NOT NULL,
    language TEXT NOT NULL DEFAULT 'auto',
    duration_ms INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'processing',
    captions_json TEXT NOT NULL DEFAULT '[]',
    error_message TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )
`;

export async function ensureProjectsTable() {
  await env.DB.prepare(PROJECTS_TABLE_SQL).run();
}

export async function createProject(input: {
  id: string;
  name: string;
  fileName: string;
  fileKey: string;
  fileType: string;
  language: string;
}) {
  const now = Date.now();
  await env.DB.prepare(
    `INSERT INTO projects
      (id, name, file_name, file_key, file_type, language, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 'processing', ?, ?)`,
  )
    .bind(
      input.id,
      input.name,
      input.fileName,
      input.fileKey,
      input.fileType,
      input.language,
      now,
      now,
    )
    .run();
}

export async function completeProject(
  id: string,
  captions: Caption[],
  language: string,
  durationMs: number,
) {
  await env.DB.prepare(
    `UPDATE projects
     SET status = 'completed', captions_json = ?, language = ?, duration_ms = ?, error_message = NULL, updated_at = ?
     WHERE id = ?`,
  )
    .bind(JSON.stringify(captions), language, durationMs, Date.now(), id)
    .run();
}

export async function failProject(id: string, message: string) {
  await env.DB.prepare(
    `UPDATE projects SET status = 'failed', error_message = ?, updated_at = ? WHERE id = ?`,
  )
    .bind(message.slice(0, 500), Date.now(), id)
    .run();
}

export async function saveProjectCaptions(id: string, captions: Caption[]) {
  await env.DB.prepare(
    `UPDATE projects SET captions_json = ?, updated_at = ? WHERE id = ?`,
  )
    .bind(JSON.stringify(captions), Date.now(), id)
    .run();
}

export async function getProject(id: string): Promise<ProjectRecord | null> {
  const row = await env.DB.prepare(
    `SELECT id, name, file_name, file_key, file_type, language, duration_ms, status,
            captions_json, error_message, created_at, updated_at
     FROM projects WHERE id = ?`,
  )
    .bind(id)
    .first<Record<string, unknown>>();

  if (!row) return null;

  let captions: Caption[] = [];
  try {
    captions = JSON.parse(String(row.captions_json || '[]')) as Caption[];
  } catch {
    captions = [];
  }

  return {
    id: String(row.id),
    name: String(row.name),
    fileName: String(row.file_name),
    fileKey: String(row.file_key),
    fileType: String(row.file_type),
    language: String(row.language),
    durationMs: Number(row.duration_ms),
    status: String(row.status) as ProjectRecord['status'],
    captions,
    errorMessage: row.error_message ? String(row.error_message) : null,
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  };
}
