// Types for cloudflare/audio-format.js (shared by the Pages API and the app).

export interface AudioFormatInfo {
  mime: string;
  extension: string;
  label: string;
}

export const AUDIO_FORMATS: Readonly<Record<string, AudioFormatInfo>>;
export const AUDIO_SAVE_TYPES: Readonly<Record<string, string>>;

export function detectAudioFormat(typeOrUrl: string): string | null;
export function sniffAudioFormat(bytes: Uint8Array | null | undefined): string | null;
export function isSafeExternalAudioUrl(urlString: string): boolean;
export function normalizeExternalUrl(rawUrl: string): string;
