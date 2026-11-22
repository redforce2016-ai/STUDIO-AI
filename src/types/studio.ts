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
export type PipelineStage =
  | "input"
  | "research_script"
  | "storyboard"
  | "video_shots"
  | "voiceover"
  | "assembly"
  | "completed";
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

export interface StageQualityAuditCheck {
  nameFa: string;
  detailFa: string;
  passed: boolean;
  metric?: string;
}

export interface StageQualityAudit {
  stage: string;
  passed: boolean;
  score: number;
  selfHealed?: boolean;
  attemptsRun?: number;
  inspectorModel?: string;
  visionCritiqueFa?: string;
  fixesAppliedFa?: string[];
  checks: StageQualityAuditCheck[];
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
  qaAudit?: StageQualityAudit | null;
  psychologicalTriggersUsed?: string[];
  algorithmComplianceChecklist?: string[];
}

export type VoicePersona = "Kore" | "Puck" | "Charon" | "Fenrir" | "Zephyr";

export interface VoiceoverOutput {
  narrationText: string;
  vocalizedText?: string;
  voiceName: VoicePersona;
  voiceStyle: string;
  estimatedSeconds: number;
  wordCount: number;
  pacingNotes: string;
  audioUrl: string | null;
  audioFilename: string | null;
  audioError?: string | null;
  qaAudit?: StageQualityAudit | null;
  cloneEngineNote?: string;
  referenceSampleUrl?: string | null;
}

export type PreferredFreeEngine =
  | "hyperframes"
  | "remotion"
  | "blender"
  | "comfyui"
  | "ffmpeg_live";

export interface CinematicSevenLayerSpec {
  /** 1. Scene: صحنه‌ای که مخاطب می‌بیند (محیط، پس‌زمینه، اتمسفر) */
  scene: string;
  /** 2. Object: اشیای داخل صحنه (محصول، متریال واقع‌گرایانه، نوشته، لوگو) */
  objects: string;
  /** 3. Animation: حرکت اشیا، ذرات معلق و اجزای تایپوگرافی */
  animation: string;
  /** 4. Camera: زاویه دید، لنز و حرکت نرم و کنترل‌شده دوربین */
  camera: string;
  /** 5. Lighting: نورپردازی کلیدی/حاشیه‌ای، رنگ نور روی سطح و سایه‌ها */
  lighting: string;
  /** 6. Transition: انتقال دقیق از این صحنه به صحنه بعدی */
  transition: string;
  /** 7. Sound Design: موسیقی، افکت‌های صوتی محیطی و هماهنگی با ریتم */
  soundDesign: string;
  /** تایپوگرافی قدرتمند و مدرن پیشنهادی شات */
  typographyNoteFa?: string;
}

export interface ShotQaLayerScore {
  layer: "scene" | "objects" | "animation" | "camera" | "lighting" | "transition" | "soundDesign";
  labelFa: string;
  score: number;
  passed: boolean;
  noteFa: string;
}

export interface ShotQaSevenLayerAudit {
  shotNumber: number;
  stage: "keyframe_image" | "rendered_video";
  overallScore: number;
  passed: boolean;
  userComprehensionScore: number;
  visualAppealScore: number;
  layerScores: ShotQaLayerScore[];
  summaryFa: string;
  revisionPromptEn?: string | null;
  checkedAt: string;
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
  /** مشخصات دقیق ۷ لایه کارگردانی بدون حدس و توهم */
  sevenLayerSpec?: CinematicSevenLayerSpec;
  /** موتور رایگان پیشنهادی (بدون وابستگی به OmniFlash) */
  preferredFreeEngine?: PreferredFreeEngine;
}

export interface DirectorOutput {
  visualDirectionSummary: string;
  /** سند کلی هویت بصری، نور، متریال، حرکت دوربین، ذرات و تایپوگرافی پروژه */
  visualDirectionBlueprint?: {
    backgroundAndAtmosphere: string;
    materialAndProductStyle: string;
    lightingSignature: string;
    cameraLanguage: string;
    particlesAndEffects: string;
    typographySystem: string;
  };
  totalEstimatedSeconds: number;
  shots: DirectorShot[];
}

export type I2VTargetTool =
  | "auto_best"
  | "gemini_omni_veo"
  | "google_flow_veo2"
  | "leonardo_motion"
  | "comfyui_wan22"
  | "real_live_footage"
  | "remotion_hyperframe"
  | "threejs_live_3d";

export interface I2VShotPlan {
  shotNumber: number;
  targetTool: I2VTargetTool;
  recommendedTool: I2VTargetTool;
  /** Draft prompt generated by the Scenario-to-I2V Prompt Writer Agent */
  draftPromptEn: string;
  draftPromptFa: string;
  /** Final revised & locked prompt approved by the QA Supervisor Model */
  revisedPromptEn: string;
  revisedPromptFa: string;
  negativePrompt: string;
  cameraMotionSpec: string;
  liveActionPhysicsEn: string;
  psychologyNoteFa: string;
  setDesignNoteFa: string;
  liveVideoSearchQueries: string[];
  /** Multimodal QA Supervisor Evaluation */
  qaStatus: "pending" | "approved" | "revised_and_approved" | "needs_keyframe_fix";
  qaScore: number;
  visualReadabilityScore: number;
  liveActionRealismScore: number;
  scenarioAlignmentScore: number;
  toolReadinessScore: number;
  needsKeyframeReplacement: boolean;
  keyframeReplacementReasonFa: string | null;
  qaIssuesFa: string[];
  qaFixesAppliedFa: string[];
  qaModelUsed: string;
  updatedAt: string;
}

export interface VisualAssetShot {
  shotNumber: number;
  imageUrl: string | null;
  videoUrl?: string | null;
  svgMarkup?: string | null;
  motionCue: string;
  colorPaletteNote: string;
  renderEngineUsed?: string | null;
  sourceMediaUrl?: string | null;
  hasDiegeticAudio?: boolean;
  i2vPlan?: I2VShotPlan | null;
  qaSevenLayerAudit?: ShotQaSevenLayerAudit | null;
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
  envVarName?: string;
  linkedBrowserProfileId?: string | null;
  linkedProfileEmail?: string | null;
  hasApiKey: boolean;
  maskedKey: string;
  enabled: boolean;
  lastSyncedAt: string | null;
  lastTestStatus: "untested" | "ok" | "error";
  lastTestMessage?: string | null;
  requestsToday?: number;
  dailyRequestLimit?: number;
  tokensToday?: number;
  dailyTokenBudget?: number;
  cooldownUntil?: string | null;
  cooldownReasonFa?: string | null;
  models: RouterModelEntry[];
}

export interface AgentRouteTarget {
  providerId: string;
  modelId: string;
}

export type GovernanceTaskRole =
  | "health_probe"
  | "research_script"
  | "voiceover"
  | "director"
  | "visuals_qa"
  | "tts_audio"
  | "image_keyframe"
  | "video_omni"
  | "music_lyria"
  | "deep_reasoning";

export interface ModelGovernanceRule {
  taskRole: GovernanceTaskRole;
  titleFa: string;
  primaryModel: string;
  fallbackModel: string | null;
  thinkingLevel: "MINIMAL" | "LOW" | "MEDIUM" | "NONE" | "BLOCKED";
  allowedByDefault: boolean;
  allowedWhenFa: string;
  antiTokenBurnRuleFa: string;
  maxCallsPerProjectStage: number;
}

export interface RouterFailoverEvent {
  id: string;
  timestamp: string;
  taskRole: string;
  fromProviderId: string;
  toProviderId: string;
  modelId: string;
  reasonFa: string;
}

export interface RouterQuotaSummary {
  dateKey: string;
  activeRealGoogleKeyCount: number;
  totalConfiguredGoogleSlots: number;
  totalRequestsToday: number;
  totalTokensToday: number;
  failoverCountToday: number;
  strictNoMockEnforced: boolean;
  recentFailovers: RouterFailoverEvent[];
}

export interface RouterConfigPublic {
  providers: RouterProviderAccount[];
  agentRoutes: Record<StudioAgentId, AgentRouteTarget[]>;
  governancePolicy: ModelGovernanceRule[];
  quotaSummary: RouterQuotaSummary;
  updatedAt: string;
}

export type AgentBrowserCommandType =
  | "search"
  | "goto"
  | "click"
  | "fill"
  | "select"
  | "register"
  | "snapshot"
  | "scroll"
  | "extract"
  | "comprehend"
  | "mission"
  | "solve_obstacles"
  | "switch_profile"
  | "refine_prompt"
  | "studio_generate";

export type WebStudioSiteId =
  | "google_flow"
  | "molab"
  | "google_colab"
  | "leonardo_ai"
  | "kling_web"
  | "runway_web"
  | "general_web";

export type WebStudioGenerationMode =
  | "text_to_image"
  | "image_to_video"
  | "text_to_video";

export type WebStudioModelOption =
  | "veo_2"
  | "omni_flash"
  | "imagen_3"
  | "molab_wan22_gpu"
  | "molab_ltx23_gpu"
  | "colab_wan22_gguf"
  | "colab_ltx23_gpu"
  | "leonardo_phoenix"
  | "leonardo_kino_xl"
  | "leonardo_motion"
  | "kling_1_6"
  | "runway_gen3_turbo";

export type CloudGpuPlatform = "molab" | "google_colab";
export type CloudGpuNotebookMode = "comfyui_i2v_worker" | "full_studio_server";
export type CloudGpuModelPreset = "wan22_fp8_14b" | "wan22_5b_gguf" | "ltx_video_fp8";

export interface CloudGpuProfileSession {
  profileId: string;
  email: string;
  platform: CloudGpuPlatform;
  notebookUrl: string | null;
  tunnelUrl: string | null;
  status: "disconnected" | "connecting" | "connected" | "error";
  gpuModel: string | null;
  vramTotalGb: number;
  ramTotalGb: number;
  comfyuiVersion: string | null;
  lastCheckedAt: string | null;
  lastError: string | null;
  dailyGpuHoursLimit: number;
  usedGpuHoursToday: number;
}

export interface CloudGpuState {
  activePlatform: CloudGpuPlatform;
  activeProfileId: string | null;
  activeTunnelUrl: string | null;
  activeGpuModel: string | null;
  activeVramTotalGb: number;
  activeComfyuiVersion: string | null;
  connected: boolean;
  lastConnectedAt: string | null;
  sessions: CloudGpuProfileSession[];
}

export interface BrowserProfileAccount {
  id: string;
  name: string;
  email: string;
  password: string;
  avatarColor: string;
  userDataDir: string;
  status: "active" | "standby" | "quota_exhausted" | "cooldown";
  dailyLimit: number;
  usedToday: number;
  connectedSites: WebStudioSiteId[];
  lastUsedAt: string | null;
  notesFa: string;
}

export interface WebStudioSiteConfig {
  siteId: WebStudioSiteId;
  siteLabelFa: string;
  targetUrl: string;
  mode: WebStudioGenerationMode;
  modelId: WebStudioModelOption;
  modelLabelFa: string;
  aspectRatio: "9:16" | "16:9" | "1:1";
  resolution: "720p" | "1080p";
  durationSeconds: 5 | 8 | 10;
  cfgScaleOrCreativity: number;
  autoSolveCloudflareAndCaptcha: boolean;
  autoRotateProfileOnQuota: boolean;
}

export interface ObstacleBypassRecord {
  id: string;
  timestamp: string;
  kind:
    | "cloudflare_turnstile"
    | "recaptcha_im_not_robot"
    | "cookie_consent"
    | "google_auth_session"
    | "quota_limit_rotate";
  url: string;
  resolved: boolean;
  strategyUsedFa: string;
  durationMs: number;
}

export interface WebStudioShotJob {
  id: string;
  createdAt: string;
  projectId: string | null;
  shotNumber: number | null;
  siteId: WebStudioSiteId;
  siteLabelFa: string;
  mode: WebStudioGenerationMode;
  modelId: WebStudioModelOption;
  modelLabelFa: string;
  aspectRatio: "9:16" | "16:9" | "1:1";
  resolution: "720p" | "1080p";
  rawPrompt: string;
  finalizedPrompt: string;
  promptRefinementNotesFa: string[];
  profileUsedId: string;
  profileUsedEmail: string;
  profileSwitchedFromEmail: string | null;
  obstaclesResolved: string[];
  langGraphNodesExecuted: string[];
  outputMediaUrl: string | null;
  outputKind: "image" | "video";
  status: "running" | "completed" | "error";
  error?: string | null;
}

export interface AgentBrowserLinkItem {
  index: number;
  text: string;
  href: string;
  role?: string;
}

export interface AgentBrowserInteractiveRef {
  ref: string;
  role: string;
  name: string;
}

export interface AgentBrowserSearchResult {
  index: number;
  title: string;
  url: string;
  snippet: string;
  sourceEngine: string;
}

export interface AgentBrowserExtractedPage {
  url: string;
  title: string;
  domain: string;
  statusCode: number;
  contentType: string;
  summaryText: string;
  headings: string[];
  keyParagraphs: string[];
  keyDataPoints: string[];
  links: AgentBrowserLinkItem[];
  interactiveRefs?: AgentBrowserInteractiveRef[];
  snapshotText?: string;
  wordCount: number;
  scrollY: number;
  maxScrollY: number;
  extractedAt: string;
}

export interface AgentBrowserActionLog {
  id: string;
  timestamp: string;
  agentName: string;
  command: AgentBrowserCommandType;
  target: string;
  status: "running" | "success" | "error";
  detailFa: string;
  durationMs: number;
}

export interface AgentBrowserState {
  engineName: string;
  playwrightConnected: boolean;
  status: "idle" | "browsing" | "extracting" | "generating_media" | "solving_obstacle" | "error";
  activeAgent: string | null;
  currentCommand: string | null;
  currentUrl: string;
  pageTitle: string;
  viewportSvgUrl: string | null;
  viewportScreenshotUrl: string | null;
  scrollY: number;
  maxScrollY: number;
  searchQuery: string;
  searchResults: AgentBrowserSearchResult[];
  extractedPage: AgentBrowserExtractedPage | null;
  comprehensionSummaryFa: string;
  comprehensionFactsFa: string[];
  profiles: BrowserProfileAccount[];
  activeProfileId: string;
  siteConfig: WebStudioSiteConfig;
  lastRefinedPrompt: {
    rawPrompt: string;
    finalizedPrompt: string;
    enhancementsFa: string[];
    targetSiteId: WebStudioSiteId;
    targetModelId: WebStudioModelOption;
    mode: WebStudioGenerationMode;
  } | null;
  obstacleHistory: ObstacleBypassRecord[];
  shotJobs: WebStudioShotJob[];
  history: string[];
  actionLog: AgentBrowserActionLog[];
  updatedAt: string;
}



