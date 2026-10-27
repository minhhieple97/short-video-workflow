import { Composition, type CalculateMetadataFunction } from "remotion";

import {
  SHORT_VIDEO_COMPOSITION_ID,
  totalFrames,
  type ShortVideoProps,
} from "@/features/videos/domain/composition-props";

import { ShortVideo } from "./compositions/short-video";
import { SAMPLE_PROPS } from "./sample-props";
import { CANVAS } from "./theme/tokens";

const calculateMetadata: CalculateMetadataFunction<ShortVideoProps> = ({ props }) => ({
  durationInFrames: totalFrames(props),
});

export function RemotionRoot() {
  return (
    <Composition
      id={SHORT_VIDEO_COMPOSITION_ID}
      component={ShortVideo}
      durationInFrames={totalFrames(SAMPLE_PROPS)}
      fps={CANVAS.fps}
      width={CANVAS.width}
      height={CANVAS.height}
      defaultProps={SAMPLE_PROPS}
      calculateMetadata={calculateMetadata}
    />
  );
}
