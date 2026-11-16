import React from "react";
import { Composition } from "remotion";
import type { ShotCompositionPlan } from "../../../src/types/videoPipeline.js";
import { UniversalShot, type UniversalShotProps } from "./ShotComposer.js";

const DEFAULT_PLAN: ShotCompositionPlan = {
  shot_id: "shot_01",
  duration_sec: 4,
  fps: 30,
  width: 480,
  height: 854,
  palette_preset: "studio_amber",
  palette: ["#0B0D11", "#14171F", "#F59E0B"],
  transition_in: "crossfade",
  camera_motion: "push-in",
  caption_text: "استودیو هوشمند تولید محتوای ویدیویی",
  nodes: [
    { component: "Background", props: { showGrid: true, glowPosition: "center" } },
    {
      component: "Headline",
      props: { text: "تولید ویدیوی استاندارد", badge: "کیفیت صنعتی", align: "center" },
    },
    { component: "Subtitle", props: { text: "همراه با کنترل کیفیت بصری خودکار", align: "center" } },
  ],
};

export const RemotionRoot: React.FC = () => {
  return (
    <Composition
      id="UniversalShot"
      component={UniversalShot as unknown as React.FC<Record<string, unknown>>}
      durationInFrames={120}
      fps={30}
      width={480}
      height={854}
      defaultProps={{ plan: DEFAULT_PLAN } satisfies UniversalShotProps}
      calculateMetadata={({ props }) => {
        const plan = (props as unknown as UniversalShotProps)?.plan ?? DEFAULT_PLAN;
        const fps = Math.max(24, Math.min(60, Number(plan.fps) || 30));
        const durationInFrames = Math.max(15, Math.round((Number(plan.duration_sec) || 4) * fps));
        return {
          durationInFrames,
          fps,
          width: Number(plan.width) || 480,
          height: Number(plan.height) || 854,
        };
      }}
    />
  );
};
