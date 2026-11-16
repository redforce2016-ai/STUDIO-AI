export type PlatformOption = "instagram" | "youtube" | "tiktok" | "reels" | "shorts";
export type ContentFormatOption =
  | "reels"
  | "post"
  | "story"
  | "shorts"
  | "long_video"
  | "tiktok_video"
  | "carousel";

export type ToneOption = "educational" | "cinematic_story" | "news_analysis" | "fast_motivational";
export type PageMaturityOption = "new_page" | "growing_page";
export type PipelineStage = "input" | "research_script" | "voiceover" | "director" | "visuals" | "completed";
export type CheckpointStatus = "idle" | "running" | "waiting_approval" | "approved" | "error";

export interface ViralTopicProposal {
  id: string;
  title: string;
  angleArchetype?: string;
  targetAudienceSegment?: string;
  recommendedTone: ToneOption;
  recommendedToneLabelFa: string;
  recommendedDurationSeconds: number;
  recommendedDurationLabelFa: string;
  strategistAngle: string;
  psychologyTrigger: string;
  creatorExecutionTip: string;
  sampleHook: string;
  openingVisualHook?: string;
  keyFactsAndDataPoints?: string[];
  ctaStrategy?: string;
  viralPotentialNote: string;
}

export interface TopicAnalysisResponse {
  hasDetailedScriptInstructions: boolean;
  keywordDomainAnalysis?: string;
  exactTargetAudience?: string;
  corePainPoints?: string[];
  pageStrategyRecommendation?: string;
  strategistSummary: string;
  defaultRecommendedTone: ToneOption;
  defaultRecommendedToneLabelFa: string;
  defaultRecommendedDurationSeconds: number;
  defaultRecommendedDurationLabelFa: string;
  proposals: ViralTopicProposal[];
  sources: GroundedSource[];
}

export interface ProjectBrief {
  title: string;
  idea: string;
  platform: PlatformOption;
  contentFormat?: ContentFormatOption;
  pageMaturity?: PageMaturityOption;
  tone: ToneOption;
  toneLabelFa?: string;
  targetDurationSeconds: number;
  selectedTopicAngle?: ViralTopicProposal | null;
}

export interface GroundedSource {
  title: string;
  uri: string;
}

export interface ResearchAndScriptOutput {
  videoTitle: string;
  targetAudienceNote: string;
  researchSummary: string;
  keyInsights: string[];
  trendingAngles: string[];
  sources: GroundedSource[];
  hook: string;
  body: string;
  cta: string;
  keywords: string[];
}

export type VoicePersona = "Kore" | "Puck" | "Charon" | "Fenrir" | "Zephyr";

export interface VoiceoverOutput {
  narrationText: string;
  voiceName: VoicePersona;
  voiceStyle: string;
  estimatedSeconds: number;
  wordCount: number;
  pacingNotes: string;
  audioUrl: string | null;
  audioFilename: string | null;
  audioError?: string | null;
}

export interface DirectorShot {
  shotNumber: number;
  timecode: string;
  durationSeconds: number;
  cameraAngle: string;
  cameraMovement: string;
  sceneDescriptionFa: string;
  spokenSegment: string;
  onScreenText: string;
  lightingAndMood: string;
  visualPromptFa: string;
}

export interface DirectorOutput {
  visualDirectionSummary: string;
  totalEstimatedSeconds: number;
  shots: DirectorShot[];
}

export interface VisualAssetShot {
  shotNumber: number;
  imageUrl: string | null;
  svgMarkup?: string | null;
  motionCue: string;
  colorPaletteNote: string;
  status: "pending" | "generating" | "ready" | "error";
  error?: string | null;
}

export interface VisualAssetsOutput {
  shots: VisualAssetShot[];
  styleGuideSummary: string;
}

export interface GraphLogEntry {
  id: string;
  timestamp: string;
  node: string;
  event: "node_started" | "node_completed" | "checkpoint_paused" | "checkpoint_resumed" | "error";
  message: string;
}

import type { VideoPipelineRun } from "./videoPipeline.js";

export interface ProjectRecord {
  id: string;
  threadId: string;
  createdAt: string;
  updatedAt: string;
  brief: ProjectBrief;
  currentStage: PipelineStage;
  checkpointStatus: CheckpointStatus;
  waitingNode: string | null;
  errorMessage: string | null;
  researchScript: ResearchAndScriptOutput | null;
  voiceover: VoiceoverOutput | null;
  director: DirectorOutput | null;
  visuals: VisualAssetsOutput | null;
  videoProduction?: VideoPipelineRun | null;
  logs: GraphLogEntry[];
}

export interface WindowsBundleFilePreview {
  path: string;
  language: string;
  description: string;
  content: string;
}

export type StudioAssetKind = "image" | "video" | "transcript" | "scene3d";

export interface StudioMediaAsset {
  id: string;
  kind: StudioAssetKind;
  title: string;
  prompt: string;
  mediaUrl: string | null;
  aspectRatio: string;
  modelUsed: string;
  transcriptText?: string;
  notes?: string;
  createdAt: string;
}

export type ImageAspectRatio = "1:1" | "3:4" | "4:3" | "9:16" | "16:9";
export type ImageResolution = "1K" | "2K" | "4K";
export type VideoAspectRatio = "16:9" | "9:16";
export type VideoDurationOption = "5s" | "8s" | "10s" | "15s";
export type VideoResolutionOption = "720p" | "1080p";

export type RouterProviderKind =
  | "google"
  | "openrouter"
  | "groq"
  | "cerebras"
  | "mistral"
  | "together"
  | "huggingface"
  | "openai_compatible";

export type StudioAgentId =
  | "research_script"
  | "voiceover"
  | "director"
  | "visuals";

export interface RouterModelEntry {
  id: string;
  name: string;
  isFree: boolean;
  enabled: boolean;
  contextLength?: number;
  lastTestedOk?: boolean | null;
  lastLatencyMs?: number | null;
  lastError?: string | null;
}

export interface RouterProviderAccount {
  id: string;
  kind: RouterProviderKind;
  name: string;
  baseUrl: string;
  useServerEnv?: boolean;
  hasApiKey: boolean;
  maskedKey: string;
  enabled: boolean;
  lastSyncedAt: string | null;
  lastTestStatus: "untested" | "ok" | "error";
  lastTestMessage?: string | null;
  models: RouterModelEntry[];
}

export interface AgentRouteTarget {
  providerId: string;
  modelId: string;
}

export interface RouterConfigPublic {
  providers: RouterProviderAccount[];
  agentRoutes: Record<StudioAgentId, AgentRouteTarget[]>;
  updatedAt: string;
}

