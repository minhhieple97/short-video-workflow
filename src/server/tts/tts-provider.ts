import type { CallOptions } from "@/server/integrations/call-options";

export interface TtsSynthesisRequest {
  text: string;
  voice: string;
  // Relative to the provider's normal speed: 0 is normal, +30 is 30% faster.
  speedPercent: number;
  // The provider writes audio here (its directory exists) in any format ffmpeg can read; the caller trims it and re-encodes it.
  outputFile: string;
}

export interface TtsProvider {
  readonly id: string;
  // Part of the voice-over cache key: change it whenever the same request would sound different.
  readonly engineVersion: string;
  // Failures are IntegrationErrors with a TTS_* code (TRANSIENT may succeed later); a provider leaves no partial file.
  synthesize(request: TtsSynthesisRequest, options?: CallOptions): Promise<void>;
}
