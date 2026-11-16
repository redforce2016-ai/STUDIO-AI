import React from "react";
import { AbsoluteFill, Video, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import type { ShotCompositionPlan } from "../../../src/types/videoPipeline.js";
import "./fonts.js";
import { Background, Transition } from "./components/Background.js";
import { CallToAction, DeviceMockup, LogoReveal } from "./components/BrandAndDevice.js";
import { CaptionTrack } from "./components/CaptionTrack.js";
import { Card, FeatureGrid, Timeline } from "./components/CardsAndGrids.js";
import { BarChart, LineChart } from "./components/Charts.js";
import { Comparison, SplitScreen } from "./components/Comparisons.js";
import { Counter } from "./components/Counter.js";
import { Headline, Subtitle } from "./components/Typography.js";
import { getLayoutMetrics } from "./tokens.js";

export interface UniversalShotProps {
  plan: ShotCompositionPlan;
}

export const UniversalShot: React.FC<UniversalShotProps> = ({ plan }) => {
  const frame = useCurrentFrame();
  const { durationInFrames, width, height } = useVideoConfig();
  const metrics = getLayoutMetrics(width, height);

  // Subtle camera motion rig (push-in / pan / orbit)
  const t = Math.min(1, frame / Math.max(1, durationInFrames - 1));
  let cameraTransform = "none";
  if (plan.camera_motion === "push-in") {
    const s = interpolate(t, [0, 1], [1, 1.045]);
    cameraTransform = `scale(${s.toFixed(4)})`;
  } else if (plan.camera_motion === "pan") {
    const x = interpolate(t, [0, 1], [-12, 12]);
    cameraTransform = `scale(1.03) translateX(${x.toFixed(1)}px)`;
  } else if (plan.camera_motion === "orbit") {
    const rot = interpolate(t, [0, 1], [-1.2, 1.2]);
    cameraTransform = `scale(1.035) perspective(1200px) rotateY(${rot.toFixed(2)}deg)`;
  }

  const bgNode = plan.nodes.find((n) => n.component === "Background");
  const captionNode = plan.nodes.find((n) => n.component === "CaptionTrack");
  const contentNodes = plan.nodes.filter(
    (n) => n.component !== "Background" && n.component !== "CaptionTrack"
  );

  return (
    <AbsoluteFill style={{ backgroundColor: "#0B0D11", overflow: "hidden" }}>
      <Transition kind={plan.transition_in}>
        {/* Optional generative base clip */}
        {plan.generative_video_url ? (
          <AbsoluteFill>
            <Video
              src={plan.generative_video_url}
              style={{ width: "100%", height: "100%", objectFit: "cover" }}
            />
            <AbsoluteFill
              style={{
                background:
                  "linear-gradient(180deg, rgba(11,13,17,0.45) 0%, rgba(11,13,17,0.2) 50%, rgba(11,13,17,0.75) 100%)",
              }}
            />
          </AbsoluteFill>
        ) : (
          <Background
            preset={plan.palette_preset}
            palette={plan.palette}
            showGrid={Boolean(bgNode?.props?.showGrid ?? true)}
            glowPosition={(bgNode?.props?.glowPosition as "top" | "center" | "bottom") || "center"}
          />
        )}

        {/* Safe-area content stage */}
        <AbsoluteFill
          style={{
            paddingTop: metrics.safeTop,
            paddingBottom: metrics.safeBottom + (plan.caption_text ? Math.round(70 * metrics.scale) : 0),
            paddingLeft: metrics.safeSide,
            paddingRight: metrics.safeSide,
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
            alignItems: "center",
            gap: metrics.gap,
            transform: cameraTransform,
          }}
        >
          {contentNodes.map((node, idx) => {
            const p = node.props || {};
            const accent = plan.palette?.[2];

            switch (node.component) {
              case "Headline":
                return (
                  <Headline
                    key={idx}
                    text={String(p.text || "")}
                    badge={p.badge ? String(p.badge) : undefined}
                    align={(p.align as "right" | "center") || "center"}
                    preset={plan.palette_preset}
                    accentColor={accent}
                  />
                );
              case "Subtitle":
                return (
                  <Subtitle
                    key={idx}
                    text={String(p.text || "")}
                    align={(p.align as "right" | "center") || "center"}
                    preset={plan.palette_preset}
                  />
                );
              case "BarChart":
                return (
                  <BarChart
                    key={idx}
                    title={p.title ? String(p.title) : undefined}
                    data={(p.data as never) || []}
                    preset={plan.palette_preset}
                    accentColor={accent}
                  />
                );
              case "LineChart":
                return (
                  <LineChart
                    key={idx}
                    title={p.title ? String(p.title) : undefined}
                    data={(p.data as never) || []}
                    preset={plan.palette_preset}
                    accentColor={accent}
                  />
                );
              case "Counter":
                return (
                  <Counter
                    key={idx}
                    value={Number(p.value) || 0}
                    label={String(p.label || "")}
                    prefix={p.prefix ? String(p.prefix) : ""}
                    suffix={p.suffix ? String(p.suffix) : ""}
                    preset={plan.palette_preset}
                    accentColor={accent}
                  />
                );
              case "Card":
                return (
                  <Card
                    key={idx}
                    title={String(p.title || "")}
                    body={String(p.body || "")}
                    tag={p.tag ? String(p.tag) : undefined}
                    preset={plan.palette_preset}
                    accentColor={accent}
                  />
                );
              case "FeatureGrid":
                return (
                  <FeatureGrid
                    key={idx}
                    items={(p.items as never) || []}
                    preset={plan.palette_preset}
                    accentColor={accent}
                  />
                );
              case "Timeline":
                return (
                  <Timeline
                    key={idx}
                    steps={(p.steps as never) || []}
                    preset={plan.palette_preset}
                    accentColor={accent}
                  />
                );
              case "SplitScreen":
                return (
                  <SplitScreen
                    key={idx}
                    primaryTitle={String(p.primaryTitle || "")}
                    primaryBody={String(p.primaryBody || "")}
                    secondaryTitle={String(p.secondaryTitle || "")}
                    secondaryBody={String(p.secondaryBody || "")}
                    preset={plan.palette_preset}
                    accentColor={accent}
                  />
                );
              case "Comparison":
                return (
                  <Comparison
                    key={idx}
                    left={(p.left as never) || { title: "گزینه اول", points: ["-"] }}
                    right={(p.right as never) || { title: "گزینه دوم", points: ["-"] }}
                    preset={plan.palette_preset}
                    accentColor={accent}
                  />
                );
              case "LogoReveal":
                return (
                  <LogoReveal
                    key={idx}
                    brandName={String(p.brandName || "استودیو")}
                    tagline={p.tagline ? String(p.tagline) : undefined}
                    preset={plan.palette_preset}
                    accentColor={accent}
                  />
                );
              case "DeviceMockup":
                return (
                  <DeviceMockup
                    key={idx}
                    title={String(p.title || "نمای سیستم")}
                    lines={(p.lines as string[]) || []}
                    preset={plan.palette_preset}
                    accentColor={accent}
                  />
                );
              case "CallToAction":
                return (
                  <CallToAction
                    key={idx}
                    headline={String(p.headline || "")}
                    actionLabel={String(p.actionLabel || "همین حالا ببینید")}
                    subnote={p.subnote ? String(p.subnote) : undefined}
                    preset={plan.palette_preset}
                    accentColor={accent}
                  />
                );
              default:
                return null;
            }
          })}
        </AbsoluteFill>

        {/* CaptionTrack inside bottom safe area */}
        {(captionNode?.props?.text || plan.caption_text) && (
          <CaptionTrack
            text={String(captionNode?.props?.text || plan.caption_text || "")}
            preset={plan.palette_preset}
            accentColor={plan.palette?.[2]}
          />
        )}
      </Transition>
    </AbsoluteFill>
  );
};
