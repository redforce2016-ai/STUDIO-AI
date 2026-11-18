import type { VideoPipelineRun } from "./videoPipeline.js";

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

/**
 * 6-Step Studio Pipeline orchestrated by 2 Super-Agents:
 * Agent 1 (scriptwriter_agent): research_script -> narration -> director (3-8s shots + 2 storyboard frames/shot)
 * Agent 2 (director_agent): shot_videos (per-shot approval) -> voiceover (voice clone + diacritics) -> davinci (DaVinci Resolve automation + final MP4)
 */
export type PipelineStage =
  | "input"
  | "research_script"
  | "narration"
  | "director"
  | "shot_videos"
  | "voiceover"
  | "davinci"
  | "visuals"
  | "completed";

export type CheckpointStatus = "idle" | "running" | "waiting_approval" | "approved" | "error";

export type LocalVideoEngineId =
  | "hyperframes_html"
  | "comfyui_light"
  | "remotion_kinetic"
  | "blender_headless"
  | "ffmpeg_cinema";

export interface LocalEngineStatus {
  id: LocalVideoEngineId;
  labelFa: string;
  descriptionFa: string;
  available: boolean;
  hardwareNoteFa: string;
  isDefault: boolean;
  requiresGpu: boolean;
}

export interface QualityCheckItem {
  nameFa: string;
  passed: boolean;
  detailFa: string;
  metric?: string;
}

export interface StageQualityAudit {
  stage: string;
  inspectedAt: string;
  inspectorModel: string;
  passed: boolean;
  score: number;
  attemptsRun: number;
  selfHealed: boolean;
  checks: QualityCheckItem[];
  visionCritiqueFa?: string;
  fixesAppliedFa: string[];
}

export interface DirectingCrewNotes {
  showrunnerNoteFa: string;
  dopCinematographyNoteFa: string;
  artDirectionNoteFa: string;
  editorRhythmNoteFa: string;
  soundDesignNoteFa: string;
}

export type VoicePersona = "Kore" | "Puck" | "Charon" | "Fenrir" | "Zephyr";

export interface PageVoiceReference {
  speakerName: string;
  voicePersona: VoicePersona;
  prosodyStyle: string;
  sampleAudioUrl: string | null;
  sampleTranscript?: string;
  cloneEnginePreference: "gemini_persona" | "local_xtts_v2" | "local_f5_tts";
}

export interface PageProfile {
  id: string;
  name: string;
  handle: string;
  platform: "instagram" | "youtube" | "tiktok";
  defaultFormat: ContentFormatOption;
  pageMaturity: PageMaturityOption;
  niche: string;
  contentStyle: string;
  targetAudiencePersona: string;
  audiencePainPoints: string[];
  brandTone: ToneOption;
  brandToneNoteFa: string;
  visualAestheticFa: string;
  tabooRedLines: string[];
  algorithmGuardrails: string[];
  competitorHandles: string[];
  voiceProfile: PageVoiceReference;
  createdAt: string;
  updatedAt: string;
}

export interface GroundedSource {
  title: string;
  uri: string;
}

export interface ViralTopicProposal {
  id: string;
  title: string;
  angleArchetype?: string;
  targetAudienceSegment?: string;
  recommendedTone: ToneOption;
  recommendedToneLabelFa: string;
  recommendedDurationSeconds: number;
  recommendedDurationLabelFa: string;
  contentValueScoreNote?: string;
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
  pageProfileId?: string | null;
  platform: PlatformOption;
  contentFormat?: ContentFormatOption;
  pageMaturity?: PageMaturityOption;
  tone: ToneOption;
  toneLabelFa?: string;
  targetDurationSeconds: number;
  selectedTopicAngle?: ViralTopicProposal | null;
  preferredVideoEngine?: LocalVideoEngineId;
  autonomousMode?: boolean;
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
  psychologicalTriggersUsed?: string[];
  algorithmComplianceChecklist?: string[];
  keywords: string[];
  qaAudit?: StageQualityAudit | null;
}

export interface PronunciationGuideEntry {
  word: string;
  vocalized: string;
  emotionOrStressNote: string;
}

export interface NarrationScriptOutput {
  plainNarrationText: string;
  vocalizedNarrationText: string;
  pronunciationGuide: PronunciationGuideEntry[];
  rhythmAndPauseNotes: string;
  emotionArcSummary: string;
  estimatedSeconds: number;
  wordCount: number;
  qaAudit?: StageQualityAudit | null;
}

export interface VoiceoverOutput {
  narrationText: string;
  vocalizedText?: string;
  voiceName: VoicePersona;
  voiceStyle: string;
  referenceSampleUrl?: string | null;
  cloneEngineNote?: string;
  estimatedSeconds: number;
  wordCount: number;
  pacingNotes: string;
  audioUrl: string | null;
  audioFilename: string | null;
  audioError?: string | null;
  qaAudit?: StageQualityAudit | null;
}

export interface DirectorShot {
  shotNumber: number;
  timecode: string;
  durationSeconds: number; // Strictly 3 to 8 seconds
  cameraAngle: string;
  cameraMovement: string;
  sceneDescriptionFa: string;
  startFrameDescriptionFa?: string;
  endFrameDescriptionFa?: string;
  spokenSegment: string;
  onScreenText: string;
  sfxCueFa?: string;
  transitionToNext?: "cut" | "cross_dissolve" | "whip_pan" | "zoom_in";
  lightingAndMood: string;
  visualPromptFa: string;
  dramaticBeatFa?: string;
  microScenarioFa?: string;
  subjectAndActionFa?: string;
  environmentAndPropsFa?: string;
  lensAndFramingFa?: string;
  lightingRigFa?: string;
  continuityLockFa?: string;
  photorealPromptStartEn?: string;
  photorealPromptEndEn?: string;
  negativePromptEn?: string;
  recommendedEngine?: LocalVideoEngineId;
}

export interface DirectorOutput {
  visualDirectionSummary: string;
  totalEstimatedSeconds: number;
  directingCrewNotes?: DirectingCrewNotes | null;
  qaAudit?: StageQualityAudit | null;
  shots: DirectorShot[];
}

export interface VisualAssetShot {
  shotNumber: number;
  imageUrl: string | null; // Frame 1 (Opening / Start Frame)
  secondaryImageUrl?: string | null; // Frame 2 (Action / Payoff Frame)
  svgMarkup?: string | null;
  secondarySvgMarkup?: string | null;
  motionCue: string;
  colorPaletteNote: string;
  generatorEngine?: LocalVideoEngineId;
  qaAudit?: StageQualityAudit | null;
  status: "pending" | "generating" | "ready" | "error";
  error?: string | null;
}

export interface VisualAssetsOutput {
  shots: VisualAssetShot[];
  styleGuideSummary: string;
}

export type ShotVideoApprovalStatus = "not_rendered" | "rendering" | "waiting_approval" | "approved" | "needs_revision" | "error";

export interface ShotVideoClipRecord {
  shotNumber: number;
  shotId: string;
  durationSeconds: number;
  videoUrl: string | null;
  videoPath?: string | null;
  approvalStatus: ShotVideoApprovalStatus;
  revisionNote?: string;
  sfxLabel?: string;
  engineUsed?: LocalVideoEngineId;
  qaAudit?: StageQualityAudit | null;
  renderedAt?: string | null;
  error?: string | null;
}

export interface DaVinciPackageSummary {
  generatedAt: string;
  projectName: string;
  fps: number;
  width: number;
  height: number;
  totalDurationSeconds: number;
  targetLoudnessLufs: number;
  colorGradePreset: string;
  noiseReductionEnabled: boolean;
  sfxCuesCount: number;
  subtitleLinesCount: number;
  fcpxmlPreview: string;
  pythonScriptPreview: string;
  srtPreview: string;
  masterVideoUrl?: string | null;
  engineUsed?: LocalVideoEngineId;
  comfyuiWorkflowAvailable?: boolean;
  qaAudit?: StageQualityAudit | null;
}

export interface GraphLogEntry {
  id: string;
  timestamp: string;
  node: string;
  agent?: "scriptwriter_agent" | "director_agent" | "system";
  event: "node_started" | "node_completed" | "checkpoint_paused" | "checkpoint_resumed" | "memory_learned" | "error";
  message: string;
}

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
  narration?: NarrationScriptOutput | null;
  voiceover: VoiceoverOutput | null;
  director: DirectorOutput | null;
  visuals: VisualAssetsOutput | null;
  shotClips?: ShotVideoClipRecord[];
  davinciPackage?: DaVinciPackageSummary | null;
  videoProduction?: VideoPipelineRun | null;
  logs: GraphLogEntry[];
}

export interface CompetitorBreakdown {
  nameOrHandle: string;
  platform: string;
  coreStrength: string;
  winningHookFormula: string;
  weaknessOrGapForUs: string;
}

export interface ViralPatternItem {
  rank: number;
  patternTitle: string;
  hookStructureFa: string;
  retentionMechanismFa: string;
  visualRhythmNote: string;
  whyItWentViral: string;
}

export interface CompetitorViralReport {
  id: string;
  pageProfileId: string | null;
  nicheQuery: string;
  platform: PlatformOption;
  analyzedAt: string;
  executiveSummary: string;
  safeResearchMethodNote: string;
  competitors: CompetitorBreakdown[];
  weeklyTopViralPatterns: ViralPatternItem[];
  algorithmRulesAndRedLines: string[];
  sources: GroundedSource[];
}

export type AgentSuperRole = "scriptwriter_agent" | "director_agent";
export type MemoryScope = "global" | "page" | "project";
export type MemoryCategory = "learned_rule" | "mistake_repaired" | "viral_pattern" | "voice_and_edit_rule";

export interface AgentMemoryEntry {
  id: string;
  agentId: AgentSuperRole;
  scope: MemoryScope;
  pageProfileId?: string | null;
  projectId?: string | null;
  category: MemoryCategory;
  ruleText: string;
  sourceEvent: string;
  strength: number; // 1 to 10
  appliedCount: number;
  createdAt: string;
  updatedAt: string;
}

export type VaultFolderId = "01_Pages" | "02_Viral_Lab" | "03_Agent_Memory" | "04_Projects";

export interface VaultNote {
  id: string;
  slug: string;
  folder: VaultFolderId;
  title: string;
  tags: string[];
  wikilinks: string[]; // target note titles/slugs parsed from [[...]]
  backlinks: string[];
  contentMd: string;
  updatedAt: string;
}

export interface VaultGraphNode {
  id: string;
  label: string;
  folder: VaultFolderId;
  degree: number;
}

export interface VaultGraphEdge {
  source: string;
  target: string;
}

export interface VaultSnapshot {
  notes: VaultNote[];
  nodes: VaultGraphNode[];
  edges: VaultGraphEdge[];
  lastSyncedAt: string;
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
  envVarName?: string;
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
