import { useEffect, useMemo, useState } from "react";
import { AbsoluteFill, useDelayRender } from "remotion";

import type { ShortVideoProps } from "@/features/videos/domain/composition-props";

import { CaptionLayer } from "../layers/caption-layer";
import { StoryChrome } from "../layers/story-chrome";
import { VisualTrack } from "../layers/visual-track";
import { castFor } from "../stage/cast";
import { ensureFonts } from "../theme/fonts";
import { PAPER } from "../theme/tokens";

// Content-driven: every word on screen comes from props; nothing about a specific book is hard-coded here.
export function ShortVideo({ title, scenes, bookTitle, showCaptions, paceFactor = 1 }: ShortVideoProps) {
  const { delayRender, continueRender, cancelRender } = useDelayRender();
  const [handle] = useState(() => delayRender("Loading Be Vietnam Pro"));
  const [fontsReady, setFontsReady] = useState(false);
  const cast = useMemo(() => castFor(title), [title]);

  // Text is measured to fit, so nothing is drawn until the bundled font is in: measuring a fallback font would size every
  // line wrongly, and Vietnamese diacritics would come out in another face. Without the font the render fails instead.
  useEffect(() => {
    void ensureFonts().then(
      () => {
        setFontsReady(true);
        continueRender(handle);
      },
      (error: unknown) => cancelRender(error),
    );
  }, [handle, continueRender, cancelRender]);

  return (
    <AbsoluteFill style={{ backgroundColor: PAPER }}>
      {fontsReady ? (
        <>
          <VisualTrack scenes={scenes} paceFactor={paceFactor} cast={cast} />
          <StoryChrome scenes={scenes} bookTitle={bookTitle} />
          <CaptionLayer scenes={scenes} showCaptions={showCaptions} />
        </>
      ) : null}
    </AbsoluteFill>
  );
}
