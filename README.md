# Subly

Web app tạo phụ đề tự động từ video, cho phép chỉnh sửa từng đoạn và xuất SRT/VTT.

## Chạy trên máy

1. Sao chép `.dev.vars.example` thành `.dev.vars`.
2. Điền `OPENAI_API_KEY` của bạn vào `.dev.vars`.
3. Chạy `npm install` rồi `npm run dev`.
4. Mở `http://localhost:3000`.

## Phạm vi MVP

- MP4, MOV, WebM và một số định dạng audio.
- File tối đa 25 MB.
- Tự nhận diện ngôn ngữ hoặc chọn tiếng Việt/tiếng Anh.
- Word timestamps bằng OpenAI `whisper-1`.
- Lưu video vào R2 và metadata/caption vào D1.
- Chỉnh nội dung, thời gian và tự động lưu.
- Xuất SRT và WebVTT.

## Cấu trúc chính

- `app/subtitle-studio.tsx`: giao diện upload, xử lý và chỉnh sửa.
- `app/api/transcribe/route.ts`: kiểm tra file, lưu trữ và gọi transcription.
- `app/api/projects/[id]`: tải/lưu lại dự án và phát video đã lưu.
- `lib/subtitles.ts`: chia caption, format timestamp và xuất file.
- `db/schema.ts`: schema dự án trên D1.

Không đưa `.dev.vars` hoặc API key lên Git.
