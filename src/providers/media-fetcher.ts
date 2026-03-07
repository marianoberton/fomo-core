/**
 * Media fetcher — downloads remote media and converts it to provider-ready content parts.
 *
 * Responsibilities:
 *  - Detect MIME type from URL extension
 *  - Download bytes via fetch
 *  - Return base64-encoded ImageContent or AudioContent (for Gemini + others)
 *  - Upload to Gemini File API for video (returns VideoContent with fileUri)
 *
 * The Gemini File API is the only path for video — Gemini cannot accept video as inline base64.
 */
import type { ImageContent, AudioContent, VideoContent } from './types.js';

// ─── MIME detection ──────────────────────────────────────────────

const IMAGE_EXTS: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  heic: 'image/heic',
};

const AUDIO_EXTS: Record<string, string> = {
  mp3: 'audio/mp3',
  ogg: 'audio/ogg',
  opus: 'audio/ogg',
  m4a: 'audio/mp4',
  wav: 'audio/wav',
  aac: 'audio/aac',
  amr: 'audio/amr',
};

const VIDEO_EXTS: Record<string, string> = {
  mp4: 'video/mp4',
  mov: 'video/mov',
  webm: 'video/webm',
  avi: 'video/avi',
  '3gp': 'video/3gpp',
};

export type MediaKind = 'image' | 'audio' | 'video' | 'unknown';

/** Detect media kind + MIME type from a URL's file extension. */
export function detectMediaMime(url: string): { kind: MediaKind; mimeType: string } {
  const ext = ((url.split('?')[0] ?? '').split('.').pop() ?? '').toLowerCase();
  if (IMAGE_EXTS[ext]) return { kind: 'image', mimeType: IMAGE_EXTS[ext] as string };
  if (AUDIO_EXTS[ext]) return { kind: 'audio', mimeType: AUDIO_EXTS[ext] as string };
  if (VIDEO_EXTS[ext]) return { kind: 'video', mimeType: VIDEO_EXTS[ext] as string };
  return { kind: 'unknown', mimeType: 'application/octet-stream' };
}

// ─── Download ────────────────────────────────────────────────────

/** Download URL bytes and return as Buffer. */
async function downloadBytes(url: string): Promise<{ bytes: Buffer; contentType: string }> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Media fetch failed: ${res.status} ${url}`);
  const buf = await res.arrayBuffer();
  const contentType = res.headers.get('content-type') ?? 'application/octet-stream';
  return { bytes: Buffer.from(buf), contentType };
}

// ─── Image / Audio (inline base64) ───────────────────────────────

/** Download an image URL and return an ImageContent (base64 inline). */
export async function fetchImage(url: string): Promise<ImageContent> {
  const { kind, mimeType: extMime } = detectMediaMime(url);
  const { bytes, contentType } = await downloadBytes(url);
  // Prefer Content-Type header for MIME (WAHA may serve with correct header)
  const mimeType = contentType !== 'application/octet-stream' ? (contentType.split(';')[0] ?? contentType).trim() : extMime;
  if (kind !== 'image') throw new Error(`Expected image URL, got kind=${kind} for ${url}`);
  return { type: 'image', data: bytes.toString('base64'), mimeType };
}

/** Download an audio URL and return an AudioContent (base64 inline). */
export async function fetchAudio(url: string): Promise<AudioContent> {
  const { mimeType: extMime } = detectMediaMime(url);
  const { bytes, contentType } = await downloadBytes(url);
  const mimeType = contentType !== 'application/octet-stream' ? (contentType.split(';')[0] ?? contentType).trim() : extMime;
  return { type: 'audio', data: bytes.toString('base64'), mimeType };
}

// ─── Video (Gemini File API) ──────────────────────────────────────

/**
 * Upload a video URL to the Gemini File API and return a VideoContent.
 *
 * Gemini does NOT support inline video — it must be uploaded first via the File API.
 * The file is available for ~48 hours after upload.
 *
 * Requires GOOGLE_API_KEY env var.
 */
export async function uploadVideoToGemini(url: string, googleApiKey: string): Promise<VideoContent> {
  const { mimeType: extMime } = detectMediaMime(url);
  const { bytes, contentType } = await downloadBytes(url);
  const mimeType = contentType !== 'application/octet-stream' ? (contentType.split(';')[0] ?? contentType).trim() : extMime;

  // Gemini File API: POST with multipart/form-data
  const formData = new FormData();
  const blob = new Blob([bytes.buffer as ArrayBuffer], { type: mimeType });
  formData.append('file', blob, 'video');

  const uploadRes = await fetch(
    `https://generativelanguage.googleapis.com/upload/v1beta/files?key=${googleApiKey}`,
    {
      method: 'POST',
      body: formData,
    },
  );

  if (!uploadRes.ok) {
    const errText = await uploadRes.text();
    throw new Error(`Gemini File API upload failed (${uploadRes.status}): ${errText}`);
  }

  const uploadJson = await uploadRes.json() as { file?: { uri?: string; name?: string } };
  const fileUri = uploadJson.file?.uri;
  if (!fileUri) throw new Error('Gemini File API returned no file URI');

  return { type: 'video', fileUri, mimeType };
}

// ─── Unified fetcher ─────────────────────────────────────────────

export type FetchedMedia = ImageContent | AudioContent | VideoContent;

/**
 * Fetch a media URL and return the appropriate content part.
 * For video, requires googleApiKey to upload to Gemini File API.
 * Returns null for unknown/unsupported media types.
 */
export async function fetchMediaContent(
  url: string,
  opts: { googleApiKey?: string } = {},
): Promise<FetchedMedia | null> {
  const { kind } = detectMediaMime(url);
  if (kind === 'image') return fetchImage(url);
  if (kind === 'audio') return fetchAudio(url);
  if (kind === 'video') {
    if (!opts.googleApiKey) return null; // video requires Gemini File API
    return uploadVideoToGemini(url, opts.googleApiKey);
  }
  return null;
}
