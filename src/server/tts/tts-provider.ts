import type { CallOptions } from "@/server/integrations/call-options";

export interface TtsSynthesisRequest {
  text: string;
  voice: string;
  // Relative to the provider's normal speed: 0 is normal, +30 is 30% faster.
  speedPercent: number;
  // The provider writes audio here (its directory exists) in any format ffmpeg can read; the caller trims it and re-encodes it.
  outputFile: string;
}

// When a word is spoken, in milliseconds of the audio the provider wrote (before any trimming). The text is the word as
// the service saw it, without punctuation.
export interface TtsWordBoundary {
  text: string;
  startMs: number;
  endMs: number;
}

export interface TtsSynthesisResult {
  // In speaking order; null when the provider gives no word timings (or they could not be read): the audio still counts.
  boundaries: readonly TtsWordBoundary[] | null;
}

export interface TtsProvider {
  readonly id: string;
  // Part of the voice-over cache key: change it whenever the same request would sound different.
  readonly engineVersion: string;
  // Failures are IntegrationErrors with a TTS_* code (TRANSIENT may succeed later); a provider leaves no partial file.
  synthesize(request: TtsSynthesisRequest, options?: CallOptions): Promise<TtsSynthesisResult>;
}
