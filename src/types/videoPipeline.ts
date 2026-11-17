export type VideoAspectFormat = "9:16" | "16:9";
export type VideoQualityMode = "preview_480p" | "final_1080p";
export type ShotToolKind = "remotion" | "blender" | "comfyui" | "parallax" | "generative_api";
export type CameraMotionKind = "static" | "push-in" | "pan" | "orbit";
export type TransitionKind = "cut" | "crossfade" | "slide" | "zoom" | "wipe";
export type PalettePresetKind =
  | "slate_sky"
  | "studio_amber"
  | "emerald_tech"
  | "crimson_alert";

export type ShotLayoutKind =
  | "hero"
  | "split_screen"
  | "comparison"
  | "bar_chart"
  | "line_chart"
  | "feature_grid"
  | "timeline"
  | "device_mockup"
  | "logo_reveal"
  | "cta"
  | "generative_clip";

export interface ChartDatum {
  label: string;
  value: number;
  unit?: string;
  highlight?: boolean;
}

export interface ComparisonSide {
  title: string;
  subtitle?: string;
  points: string[];
  metricLabel?: string;
  isWinner?: boolean;
}

export interface FeatureGridItem {
  title: string;
  description: string;
  metric?: string;
}

export interface TimelineStepItem {
  stepLabel: string;
  title: string;
  detail: string;
}

export interface ShotSpec {
  shot_id: string;
  shot_number: number;
  duration_sec: number;
  fps: number;
  resolution: [number, number];
  intent: string;
  narration_text: string;
  tool: ShotToolKind;
  fallback_used?: boolean;
  fallback_reason?: string | null;
  visual: {
    layout: ShotLayoutKind;
    primary_subject: string;
    background: string;
    foreground_elements: string[];
    headline?: string;
    subtitle?: string;
    badge_text?: string;
    cta_label?: string;
    device_title?: string;
    chart_title?: string;
    chart_data?: ChartDatum[];
    comparison_left?: ComparisonSide;
    comparison_right?: ComparisonSide;
    feature_items?: FeatureGridItem[];
    timeline_steps?: TimelineStepItem[];
    kpi_counter?: {
      value: number;
      prefix?: string;
      suffix?: string;
      label: string;
    };
    camera_motion: CameraMotionKind;
    animation_notes: string;
    blender_prompt?: string;
    generative_prompt?: string;
    keyframe_path?: string;
  };
  style: {
    palette: [string, string, string];
    palette_preset: PalettePresetKind;
    typography: {
      font_family: "Vazirmatn";
      rtl: true;
    };
    mood: string;
  };
  audio: {
    voiceover: boolean;
    narration_path?: string | null;
    music?: string | null;
    sfx: string[];
  };
  transition_in: TransitionKind;
  qa_checks: string[];
  needs_clarification?: boolean;
  clarification_reason?: string | null;
}

export interface ShotComponentNode {
  component:
    | "Background"
    | "Headline"
    | "Subtitle"
    | "BarChart"
    | "LineChart"
    | "Counter"
    | "Card"
    | "FeatureGrid"
    | "Timeline"
    | "SplitScreen"
    | "Comparison"
    | "LogoReveal"
    | "DeviceMockup"
    | "CaptionTrack"
    | "CallToAction";
  props: Record<string, unknown>;
}

export interface ShotCompositionPlan {
  shot_id: string;
  duration_sec: number;
  fps: number;
  width: number;
  height: number;
  palette_preset: PalettePresetKind;
  palette: [string, string, string];
  transition_in: TransitionKind;
  camera_motion: CameraMotionKind;
  caption_text: string;
  nodes: ShotComponentNode[];
  generative_video_url?: string | null;
}

export interface DeterministicVideoCheck {
  passed: boolean;
  duration_sec: number;
  duration_delta_sec: number;
  width: number;
  height: number;
  fps: number;
  has_video_stream: boolean;
  has_audio_stream: boolean;
  black_frames_detected: boolean;
  frozen_frames_detected: boolean;
  mean_volume_db: number | null;
  failures: string[];
}

export interface VisualCriticScores {
  intent_match: number;
  readability: number;
  composition: number;
  motion_quality: number;
  polish: number;
}

export interface VisualCriticIssue {
  frame: string;
  problem: string;
  fix: string;
}

export interface VisualCriticReport {
  shot_id: string;
  attempt: number;
  scores: VisualCriticScores;
  qa_checks_results: Array<{
    check: string;
    passed: boolean;
    note: string;
  }>;
  passed: boolean;
  verdict_reason: string;
  issues: VisualCriticIssue[];
}

export type ShotExecutionStatus =
  | "pending"
  | "planning"
  | "building"
  | "rendering"
  | "extracting"
  | "critiquing"
  | "passed"
  | "retrying"
  | "needs_human_review"
  | "needs_clarification"
  | "error";

export interface ShotExecutionRecord {
  shot_id: string;
  shot_number: number;
  spec: ShotSpec;
  compositionPlan?: ShotCompositionPlan | null;
  status: ShotExecutionStatus;
  attempts: number;
  maxAttempts: number;
  toolUsed: ShotToolKind;
  fallbackUsed: boolean;
  fallbackReason?: string | null;
  cacheHit: boolean;
  renderPath?: string | null;
  renderUrl?: string | null;
  depthMapUrl?: string | null;
  renderDurationMs?: number;
  vramUsedMb?: number;
  ramUsedMb?: number;
  subClipsCount?: number;
  frameUrls: string[];
  deterministicCheck?: DeterministicVideoCheck | null;
  criticReport?: VisualCriticReport | null;
  attemptHistory: Array<{
    attempt: number;
    renderUrl?: string | null;
    deterministicPassed: boolean;
    criticPassed: boolean;
    scores?: VisualCriticScores;
    verdictReason: string;
    issues: VisualCriticIssue[];
  }>;
}

export interface FinalQaReport {
  passed: boolean;
  duration_sec: number;
  width: number;
  height: number;
  fps: number;
  mean_volume_db: number | null;
  black_frames_detected: boolean;
  frozen_frames_detected: boolean;
  continuity_score: number;
  summary: string;
  issues: string[];
}

export interface VideoPipelineLog {
  timestamp: string;
  node: string;
  shot_id?: string;
  attempt?: number;
  level: "info" | "warn" | "error";
  message: string;
  data?: Record<string, unknown>;
}

export interface VideoPipelineRun {
  runId: string;
  projectId?: string;
  createdAt: string;
  updatedAt: string;
  aspectRatio: VideoAspectFormat;
  qualityMode: VideoQualityMode;
  status:
    | "idle"
    | "running"
    | "needs_clarification"
    | "needs_human_review"
    | "assembling"
    | "completed"
    | "error";
  currentNode: string;
  shots: ShotExecutionRecord[];
  finalVideoPath?: string | null;
  finalVideoUrl?: string | null;
  srtPath?: string | null;
  srtUrl?: string | null;
  reportUrl?: string | null;
  finalQa?: FinalQaReport | null;
  errorMessage?: string | null;
  logs: VideoPipelineLog[];
}

export interface VideoPreflightStatus {
  ready: boolean;
  nodeVersion: string;
  ffmpegAvailable: boolean;
  ffmpegVersion: string | null;
  ffprobeAvailable: boolean;
  remotionAvailable: boolean;
  chromiumAvailable: boolean;
  blenderAvailable: boolean;
  localFontsAvailable: boolean;
  geminiKeyConfigured: boolean;
  gpuModel?: string;
  vramTotalGb?: number;
  ramTotalGb?: number;
  hardwareProfile?: string;
  defaultKeyframeProvider?: "comfyui" | "parallax";
  comfyuiAvailable?: boolean;
  parallaxAvailable?: boolean;
  missingCritical: string[];
  warnings: string[];
}
