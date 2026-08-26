import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import './globals.css';

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
});

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
});

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000'),
  title: 'Subly — Tạo phụ đề tự động cho video',
  description: 'Tải video lên, tạo phụ đề tiếng Việt bằng AI, chỉnh sửa và xuất SRT hoặc VTT.',
  openGraph: {
    title: 'Subly — Video vào. Phụ đề ra.',
    description: 'Tạo, chỉnh sửa và xuất phụ đề AI cho video tiếng Việt.',
    type: 'website',
    locale: 'vi_VN',
    images: [{ url: '/og.png', width: 1200, height: 630, alt: 'Subly — Video vào. Phụ đề ra.' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Subly — Video vào. Phụ đề ra.',
    description: 'Tạo, chỉnh sửa và xuất phụ đề AI cho video tiếng Việt.',
    images: ['/og.png'],
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="vi">
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased`}>{children}</body>
    </html>
  );
}
