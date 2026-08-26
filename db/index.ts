import { env } from 'cloudflare:workers';
import { drizzle } from 'drizzle-orm/d1';
import * as schema from './schema';

export function getDb() {
  if (!env.DB) {
    throw new Error(
      'Chưa kết nối được cơ sở dữ liệu. Hãy kiểm tra cấu hình D1 trước khi sử dụng dự án.',
    );
  }

  return drizzle(env.DB, { schema });
}
