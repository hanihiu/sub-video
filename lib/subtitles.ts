export type Caption = {
  id: string;
  start: number;
  end: number;
  text: string;
};

export type ProjectRecord = {
  id: string;
  name: string;
  fileName: string;
  fileKey: string;
  fileType: string;
  language: string;
  durationMs: number;
  status: 'processing' | 'completed' | 'failed';
  captions: Caption[];
  errorMessage: string | null;
  createdAt: number;
  updatedAt: number;
};

type TranscriptionWord = { word?: string; start?: number; end?: number };
type TranscriptionSegment = { text?: string; start?: number; end?: number };

function cleanText(value: string) {
  return value
    .replace(/\s+/g, ' ')
    .replace(/\s+([,.;:!?…])/g, '$1')
    .trim();
}

export function buildCaptions(
  words: TranscriptionWord[] | undefined,
  segments: TranscriptionSegment[] | undefined,
): Caption[] {
  const validWords = (words ?? []).filter(
    (word) => word.word && Number.isFinite(word.start) && Number.isFinite(word.end),
  );

  if (!validWords.length) {
    return (segments ?? [])
      .filter((segment) => segment.text && Number.isFinite(segment.start) && Number.isFinite(segment.end))
      .map((segment, index) => ({
        id: `caption-${index + 1}`,
        start: Math.max(0, Number(segment.start)),
        end: Math.max(Number(segment.start) + 0.5, Number(segment.end)),
        text: cleanText(String(segment.text)),
      }));
  }

  const captions: Caption[] = [];
  let bucket: TranscriptionWord[] = [];
  const flush = () => {
    if (!bucket.length) return;
    const start = Number(bucket[0].start);
    const rawEnd = Number(bucket[bucket.length - 1].end);
    captions.push({
      id: `caption-${captions.length + 1}`,
      start: Math.max(0, start),
      end: Math.max(start + 0.6, rawEnd),
      text: cleanText(bucket.map((item) => item.word).join(' ')),
    });
    bucket = [];
  };

  for (const word of validWords) {
    bucket.push(word);
    const text = cleanText(bucket.map((item) => item.word).join(' '));
    const duration = Number(word.end) - Number(bucket[0].start);
    const naturalBreak = /[.!?…]$/.test(text);
    if ((naturalBreak && text.length >= 16) || text.length >= 48 || duration >= 5.5) flush();
  }

  flush();
  return captions;
}

function pad(value: number, length = 2) {
  return String(value).padStart(length, '0');
}

export function formatTimestamp(seconds: number, separator: ',' | '.') {
  const safe = Math.max(0, seconds);
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const secs = Math.floor(safe % 60);
  const milliseconds = Math.round((safe - Math.floor(safe)) * 1000);
  return `${pad(hours)}:${pad(minutes)}:${pad(secs)}${separator}${pad(milliseconds, 3)}`;
}

export function captionsToSrt(captions: Caption[]) {
  return captions
    .map(
      (caption, index) =>
        `${index + 1}\n${formatTimestamp(caption.start, ',')} --> ${formatTimestamp(caption.end, ',')}\n${caption.text.trim()}`,
    )
    .join('\n\n');
}

export function captionsToVtt(captions: Caption[]) {
  return `WEBVTT\n\n${captions
    .map(
      (caption) =>
        `${formatTimestamp(caption.start, '.')} --> ${formatTimestamp(caption.end, '.')}\n${caption.text.trim()}`,
    )
    .join('\n\n')}`;
}
