import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const projects = sqliteTable('projects', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  fileName: text('file_name').notNull(),
  fileKey: text('file_key').notNull(),
  fileType: text('file_type').notNull(),
  language: text('language').notNull().default('auto'),
  durationMs: integer('duration_ms').notNull().default(0),
  status: text('status').notNull().default('processing'),
  captionsJson: text('captions_json').notNull().default('[]'),
  errorMessage: text('error_message'),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
});
