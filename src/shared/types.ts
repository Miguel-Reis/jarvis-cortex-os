export type LanguageCode = 'pt-PT' | 'en-US';

export type PersonalityMode =
  | 'STARK_EXECUTIVE'
  | 'TACTICAL_ENGINEER'
  | 'WAR_ROOM_CONCISE'
  | 'GUARDIAN_DEFENSE';

export type AutonomyLevel = 'SAFE_SUPERVISED' | 'BALANCED_PROACTIVE' | 'FULL_EXECUTIVE';

export type ModelProviderType =
  | 'GEMINI_STUDIO'
  | 'OLLAMA_LOCAL'
  | 'OPENROUTER_COMPAT'
  | 'LOCAL_DETERMINISTIC';

export type GeminiVoiceName = 'Charon' | 'Zephyr' | 'Kore' | 'Puck' | 'Fenrir';

export interface VoicePersonaOption {
  id: GeminiVoiceName;
  label: string;
  badgePt: string;
  timbrePt: string;
  timbreEn: string;
}

export type VerificationRuleType = 'TEST_PASS' | 'FILE_EXISTS' | 'HTTP_CHECK' | 'EXEC_SIGN';

export type ProjectIdeaCategory =
  | 'WEBSITE'
  | 'APP'
  | 'AUTOMATION'
  | 'RESEARCH'
  | 'SYSTEM'
  | 'CUSTOM';

export interface GoalSubtask {
  id: string;
  title: string;
  done: boolean;
}

export interface GoalItem {
  id: string;
  title: string;
  category: string;
  progress: number; // 0..100
  targetMetric: string;
  deadline: string;
  status: 'ACTIVE' | 'COMPLETED' | 'AT_RISK';
  projectId?: string;
  chatId?: string;
  assignedAgentId?: string;
  subtasks?: GoalSubtask[];
  createdBy?: 'JARVIS_AUTO' | 'OPERATOR';
  updatedAt?: string;
}

export interface ChatThread {
  id: string;
  projectId: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  primaryAgentId?: string;
  participatingAgentIds?: string[];
  screenAutoSendEnabled?: boolean;
}

export type ProjectActivityLogKind =
  | 'THOUGHT'
  | 'GOAL_CREATED'
  | 'GOAL_UPDATED'
  | 'AGENT_SPAWNED'
  | 'AGENT_DELEGATED'
  | 'SKILL_ACTIVATED'
  | 'MCP_TOOL'
  | 'SCREEN_VISION'
  | 'VOICE_LIVE'
  | 'AUDIO_TRANSCRIBE'
  | 'ARTIFACT_GENERATED'
  | 'WEB_RESEARCH'
  | 'BLUEPRINT_EXPORTED'
  | 'SYSTEM_STEP';

export interface ProjectActivityLogEntry {
  id: string;
  projectId: string;
  chatId: string;
  timestamp: string;
  actor: string;
  kind: ProjectActivityLogKind;
  status: 'RUNNING' | 'SUCCESS' | 'WARNING' | 'ERROR';
  summary: string;
  detail?: string;
  durationMs?: number;
  relatedGoalId?: string;
  relatedAgentId?: string;
  relatedSkillSlug?: string;
}

export interface ScreenCaptureSnapshot {
  id: string;
  source: 'BROWSER_STREAM' | 'SIDECAR_NATIVE';
  capturedAt: string;
  width: number;
  height: number;
  mimeType: string;
  dataBase64: string;
  activeWindowTitle?: string;
  hostname?: string;
  visionSummary?: string;
}

export type ArtifactKind = 'HTML_PREVIEW' | 'SVG_DIAGRAM' | 'MARKDOWN_DOC' | 'CODE_MODULE';

export interface ArtifactVersion {
  version: number;
  content: string;
  summary: string;
  createdAt: string;
  author: string;
}

export interface ProjectArtifact {
  id: string;
  projectId: string;
  chatId?: string;
  title: string;
  kind: ArtifactKind;
  language?: string;
  currentVersion: number;
  versions: ArtifactVersion[];
  createdAt: string;
  updatedAt: string;
}

export interface GroundingSourceItem {
  title: string;
  uri: string;
}

export interface NormalizedScreenRegion {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface ProjectBlueprintBundle {
  projectName: string;
  generatedAt: string;
  prdMd: string;
  architectureMd: string;
  tasksMd: string;
  agentsMd: string;
  bundleMd: string;
}

export interface StudioInlineEvent {
  type: 'GOAL' | 'AGENT' | 'SKILL' | 'MCP' | 'SCREEN' | 'VOICE' | 'ARTIFACT' | 'WEB';
  id: string;
  title: string;
  subtitle?: string;
}

export type DataOriginSource = 'SEED' | 'REAL';
export type SeedMode = 'demo' | 'real';

export interface DoctorCheckItem {
  id: string;
  category: 'RUNTIME' | 'SECURITY' | 'STORAGE' | 'PROVIDERS' | 'SIDECAR';
  label: string;
  status: 'PASS' | 'WARN' | 'FAIL';
  detail: string;
}

export interface DoctorReport {
  checkedAt: string;
  healthy: boolean;
  nodeVersion: string;
  storageEngine: string;
  schemaVersion: number;
  seedMode: SeedMode;
  bindHost: string;
  authRequired: boolean;
  tokenConfigured: boolean;
  corsOrigin: string;
  checks: DoctorCheckItem[];
}

export interface TodayContractItem {
  id: string;
  title: string;
  verificationRule: VerificationRuleType;
  verificationTarget: string;
  status: 'PENDING' | 'VERIFIED' | 'FAILED';
  evidenceHash?: string;
  lastCheckedAt?: string;
  outputSummary?: string;
  source?: DataOriginSource;
}

export interface Q18Candidate {
  id: string;
  title: string;
  description: string;
  targetComponent: string;
  impact: number; // 1..10
  urgency: number; // 1..10
  effort: number; // 0.5..10
  risk: number; // 0..5
  authorityWeight: number; // 0.5..1.5
  dependencies: string[];
  actionPayload: {
    kind: 'RUN_WORKFLOW' | 'VERIFY_CONTRACT' | 'OPEN_ROOM' | 'RUN_DIAGNOSTIC';
    refId: string;
  };
  completed: boolean;
  q18Score?: number;
}

export interface DecisionOption {
  label: string;
  summary: string;
  impactScore: number;
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH';
}

export interface DecisionItem {
  id: string;
  title: string;
  context: string;
  optionA: DecisionOption;
  optionB: DecisionOption;
  status: 'PENDING' | 'RESOLVED_A' | 'RESOLVED_B';
  resolvedAt?: string;
}

export interface RoutineCue {
  id: string;
  title: string;
  patternDescription: string;
  confidence: number;
  suggestedCron: string;
  promptTemplate: string;
  convertedWorkflowId?: string;
}

export interface Room {
  id: string;
  name: string;
  callsign?: string;
  roleTitle: string;
  description: string;
  systemPrompt: string;
  accentColor: 'cyan' | 'amber' | 'emerald' | 'rose' | 'violet';
  allowedTools: string[];
  projectId?: string;
  createdByJarvis?: boolean;
  modelOverride?: string;
  isCustom?: boolean;
}

export interface AttachmentItem {
  id: string;
  name: string;
  mimeType: string;
  dataBase64: string; // base64 without data: prefix
  sizeBytes: number;
}

export interface ToolCallRecord {
  id: string;
  name: string;
  args: Record<string, unknown>;
  status: 'SUCCESS' | 'PENDING_APPROVAL' | 'ERROR';
  outputSummary: string;
  durationMs: number;
  mcpServerName?: string;
}

export type MemoryTier = 'WORKING' | 'EPISODIC' | 'SEMANTIC';

export interface LookaheadAlert {
  filePath: string;
  symbolName?: string;
  lineRange?: string;
  blastRadiusScore: number;
  coChangedWith: string[];
  reason: string;
}

export interface TokenDietMetrics {
  baselineTokens: number;
  injectedTokens: number;
  savedTokens: number;
  savingsPercent: number;
  stagesApplied: ('DELTA_CACHE' | 'TOON_COMPRESSION' | 'SCOUT_ROUTED_MAP' | 'MICRO_TICK' | 'TOOL_PRUNING')[];
  activeToolsCount: number;
  totalToolsCatalog: number;
}

export interface JevRouteDecision {
  tier: MemoryTier;
  intent:
    | 'MICRO_TICK'
    | 'CODE_IMPACT'
    | 'SWARM_ORCHESTRATION'
    | 'MEMORY_RECALL'
    | 'SYSTEM_DEVOPS'
    | 'EXECUTIVE_PLANNING';
  dotsTrajectory: string[];
  latencyMs: number;
  microTick: boolean;
  prunedTools: string[];
  lookaheadAlerts: LookaheadAlert[];
  tokenDiet: TokenDietMetrics;
}

export interface ChatMessage {
  id: string;
  roomId: string;
  chatId?: string;
  projectId?: string;
  agentName?: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  createdAt: string;
  engineUsed?: string;
  screenIncluded?: boolean;
  studioEvents?: StudioInlineEvent[];
  groundingSources?: GroundingSourceItem[];
  attachments?: AttachmentItem[];
  toolCalls?: ToolCallRecord[];
  jevRoute?: JevRouteDecision;
}

export type WorkflowNodeType = 'trigger' | 'shell' | 'ai' | 'condition' | 'approval';

export interface WorkflowNode {
  id: string;
  type: WorkflowNodeType;
  label: string;
  config: {
    triggerKind?: 'manual' | 'cron' | 'webhook';
    cronExpr?: string;
    command?: string;
    prompt?: string;
    conditionExpr?: string;
    approverNote?: string;
  };
  nextIds: string[];
}

export interface Workflow {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  cronExpr?: string;
  nodes: WorkflowNode[];
  createdAt: string;
  lastRunAt?: string;
  lastStatus?: 'SUCCESS' | 'WAITING_APPROVAL' | 'FAILED';
}

export interface WorkflowStepLog {
  nodeId: string;
  nodeLabel: string;
  nodeType: WorkflowNodeType;
  status: 'SUCCESS' | 'WAITING_APPROVAL' | 'FAILED' | 'SKIPPED';
  output: string;
  durationMs: number;
  startedAt: string;
}

export interface WorkflowRun {
  id: string;
  workflowId: string;
  workflowName: string;
  triggerSource: 'MANUAL' | 'CRON' | 'HEARTBEAT' | 'WEBHOOK' | 'AGENT';
  status: 'RUNNING' | 'SUCCESS' | 'WAITING_APPROVAL' | 'FAILED';
  startedAt: string;
  finishedAt?: string;
  totalDurationMs: number;
  steps: WorkflowStepLog[];
  pendingApprovalId?: string;
  autoHealSandboxId?: string;
  autoHealSummary?: string;
  source?: DataOriginSource;
}

export interface HeartbeatAlert {
  id: string;
  timestamp: string;
  severity: 'NOMINAL' | 'WARNING' | 'CRITICAL';
  title: string;
  detail: string;
}

export interface HeartbeatConfig {
  enabled: boolean;
  intervalSeconds: number;
  checkPorts: boolean;
  checkDiskAndRam: boolean;
  checkGoals: boolean;
  lastBeatAt?: string;
  totalBeats: number;
  recentAlerts: HeartbeatAlert[];
}

export type MemoryCategory = 'FACT' | 'ENTITY' | 'PREFERENCE' | 'DECISION' | 'COMMITMENT';

export interface MemoryItem {
  id: string;
  topic: string;
  content: string;
  category: MemoryCategory;
  provenance: 'CONFIRMED' | 'INFERRED';
  confidence: number;
  tags: string[];
  pinned: boolean;
  sourceUri: string;
  simHash: string;
  createdAt: string;
  updatedAt: string;
  // v3.0 Antigravity Brain v7.2 Bi-Temporal + Ebbinghaus + 128-Bit BQ extensions
  tier?: MemoryTier;
  bq128Hex?: string;
  accessCount?: number;
  lastAccessedAt?: string;
  importance?: number; // 1..5
  validFrom?: string;
  validUntil?: string | null;
  supersededBy?: string | null;
  source?: DataOriginSource;
}

export interface MemoryRankedHit {
  memory: MemoryItem;
  rrfScore: number;
  bm25Score: number;
  bqSimilarity: number;
  pprScore: number;
  retentionScore: number;
  halfLifeDays: number;
}

export interface GraphEdge {
  id: string;
  source: string; // memory id or entity label
  target: string; // memory id or entity label
  relation: string;
  weight: number;
}

export interface GraphNodeComputed {
  id: string;
  label: string;
  category: MemoryCategory;
  provenance: 'CONFIRMED' | 'INFERRED';
  pinned: boolean;
  pprScore: number;
  retentionScore?: number;
  superseded?: boolean;
}

export interface SkillItem {
  id: string;
  name: string;
  slug: string;
  category?: 'ENGINEERING' | 'SECURITY' | 'MEMORY' | 'DEVOPS' | 'PRODUCTIVITY' | 'CUSTOM';
  description: string;
  enabled: boolean;
  systemInstruction: string;
  allowedTools: string[];
  quickCommand: string;
  version: string;
  origin?: 'BUILTIN' | 'LIBRARY' | 'CUSTOM';
}

export interface SkillLibraryTemplate {
  id: string;
  name: string;
  slug: string;
  category: 'ENGINEERING' | 'SECURITY' | 'MEMORY' | 'DEVOPS' | 'PRODUCTIVITY';
  description: string;
  systemInstruction: string;
  allowedTools: string[];
  quickCommand: string;
  version: string;
  author: string;
}

export type PluginLifecycleHook =
  | 'PRE_PROMPT'
  | 'POST_TURN'
  | 'ON_HEARTBEAT'
  | 'ON_PROACTIVE_SCAN'
  | 'SIDECAR_BRIDGE'
  | 'SECURITY_GATE';

export interface PluginItem {
  id: string;
  name: string;
  slug: string;
  category: 'SIDECAR' | 'COGNITION' | 'SECURITY' | 'WORKFLOW' | 'TELEMETRY';
  description: string;
  version: string;
  author: string;
  hook: PluginLifecycleHook;
  enabled: boolean;
  installed: boolean;
  config: Record<string, string>;
  invocationsCount: number;
  lastTriggeredAt?: string;
}

export interface AgentTemplate {
  id: string;
  name: string;
  callsign: string;
  roleTitle: string;
  description: string;
  accentColor: Room['accentColor'];
  systemPrompt: string;
  allowedTools: string[];
}

export interface ProactiveInsight {
  id: string;
  projectId: string;
  createdAt: string;
  category: 'HEALTH' | 'GIT_HYGIENE' | 'TEST_GATE' | 'AST_DRIFT' | 'NEXT_STEP';
  severity: 'INFO' | 'OPPORTUNITY' | 'WARNING';
  title: string;
  detail: string;
  suggestedActionLabel: string;
  suggestedCommandOrPrompt: string;
  actionKind: 'EXEC_COMMAND' | 'OPEN_CHAT' | 'RUN_WORKFLOW' | 'VERIFY_CONTRACTS';
  status: 'OPEN' | 'EXECUTED' | 'DISMISSED';
}

export interface ProjectWorkspace {
  id: string;
  name: string;
  slug: string;
  rootPath: string;
  techStack: string;
  gitBranch: string;
  description: string;
  ideaCategory?: ProjectIdeaCategory;
  ideaBrief?: string;
  activeSkillIds?: string[];
  defaultChatId?: string;
  status: 'ACTIVE' | 'STANDBY' | 'AUDITING';
  proactiveEnabled: boolean;
  proactiveIntervalSec: number;
  healthScore: number;
  openTasksCount: number;
  symbolCount?: number;
  assignedAgentIds: string[];
  lastProactiveAt?: string;
  proactiveFrequencyHistory?: number[];
  proactiveInsights: ProactiveInsight[];
}

export interface SidecarWindowEntry {
  hwnd: number;
  title: string;
  process: string;
  status?: string;
}

export interface SidecarProcessEntry {
  pid: number;
  name: string;
  cpuPercent: number;
  memPercent: number;
  commandLine: string;
}

export interface SidecarHostCommandRecord {
  id: string;
  deviceId: string;
  deviceName: string;
  kind: 'HOTKEY' | 'HOST_EXEC' | 'DIAGNOSTIC' | 'WINDOW_SCAN';
  actionOrCommand: string;
  status: 'EXECUTED' | 'QUEUED_REMOTE' | 'PENDING_APPROVAL' | 'BLOCKED';
  output: string;
  durationMs: number;
  timestamp: string;
}

export interface SidecarHostSnapshot {
  deviceId: string;
  hostname: string;
  platform: string;
  arch: string;
  pythonSidecarAvailable: boolean;
  wakePhrases: string[];
  supportedHotkeys: { combo: string; action: string; description: string }[];
  activeWindows: SidecarWindowEntry[];
  topProcesses: SidecarProcessEntry[];
  recentCommands: SidecarHostCommandRecord[];
  sampledAt: string;
}

export type ChannelPlatform = 'TELEGRAM' | 'DISCORD' | 'WEBHOOK' | 'SLACK';

export interface ChannelConfig {
  id: string;
  platform: ChannelPlatform;
  name: string;
  enabled: boolean;
  endpointOrBotTag: string;
  ownerAllowList: string[]; // First ID is Owner with exec approval power; empty = blocked!
  lastEventAt?: string;
}

export interface PortRadarEntry {
  port: number;
  service: string;
  open: boolean;
  latencyMs: number;
}

export interface OSTelemetry {
  platform: string;
  osRelease: string;
  arch: string;
  hostname: string;
  uptimeSeconds: number;
  cpuModel: string;
  cpuCores: number;
  cpuUsagePercent: number;
  ramTotalGb: number;
  ramUsedGb: number;
  ramFreeGb: number;
  ramPercent: number;
  diskTotalGb: number;
  diskUsedGb: number;
  diskPercent: number;
  networkInterfaces: { name: string; address: string }[];
  ports: PortRadarEntry[];
  sampledAt: string;
}

export interface DeviceNode {
  id: string;
  name: string;
  osType: 'WINDOWS' | 'LINUX' | 'MACOS';
  hostname: string;
  ipAddress: string;
  status: 'ONLINE' | 'OFFLINE';
  isCurrentHost: boolean;
  lastSeenAt: string;
  capabilities: string[];
}

export interface EnrollmentToken {
  id: string;
  token: string;
  label: string;
  targetOs: 'WINDOWS' | 'LINUX';
  createdAt: string;
  expiresAt: string;
  usedByDeviceId?: string;
}

export interface ApprovalRequest {
  id: string;
  title: string;
  commandOrAction: string;
  source:
    | 'CHAT_AGENT'
    | 'WORKFLOW'
    | 'WORKSPACE_TERMINAL'
    | 'EXTERNAL_CHANNEL'
    | 'SWARM_SANDBOX'
    | 'MCP_GATEWAY'
    | 'SIDECAR_HOST';
  riskLevel: 'MEDIUM' | 'HIGH' | 'CRITICAL';
  requestedAt: string;
  status: 'PENDING' | 'APPROVED_ONCE' | 'APPROVED_ALWAYS' | 'BLOCKED';
  decidedAt?: string;
  workflowRunId?: string;
  mcpServerId?: string;
}

export interface AuditLogEntry {
  id: string;
  timestamp: string;
  actor: string;
  category:
    | 'SECURITY'
    | 'WORKFLOW'
    | 'MEMORY'
    | 'TERMINAL'
    | 'CHANNEL'
    | 'SYSTEM'
    | 'SWARM'
    | 'ORBIT'
    | 'MCP'
    | 'PROJECT'
    | 'SIDECAR';
  action: string;
  detail: string;
  status: 'ALLOWED' | 'BLOCKED' | 'VERIFIED';
}

// ============================================================================
// v3.0 Swarm 48x, Transactional CoW Sandboxes, AST Scout & Orbit Agent OS Types
// ============================================================================

export type SwarmLane = 'UI' | 'API' | 'TESTS' | 'DOCS';

export interface SwarmVerifyGateResult {
  passed: boolean;
  checkedAt: string;
  summary: string;
  evidenceHash: string;
}

export interface SwarmTask {
  id: string;
  lane: SwarmLane;
  agentCallsign: string;
  title: string;
  targetFile: string;
  status: 'QUEUED' | 'RUNNING' | 'VERIFIED' | 'ROLLED_BACK';
  pheromoneScore: number; // Ruflo EMA 0..1
  verify1?: SwarmVerifyGateResult; // AST & Blast Radius Gate
  verify2?: SwarmVerifyGateResult; // Unit Test & AI-Defence Secret Gate
  durationMs: number;
  source?: DataOriginSource;
}

export interface SwarmRun {
  id: string;
  objective: string;
  scale: 24 | 48;
  status: 'RUNNING' | 'VERIFIED' | 'PARTIAL_ROLLBACK';
  startedAt: string;
  finishedAt?: string;
  scoutSummary: string;
  rufloConvergence: number; // 0..1
  verifyGatesPassed: number;
  verifyGatesTotal: number;
  sandboxId?: string;
  tasks: SwarmTask[];
  source?: DataOriginSource;
}

export interface SandboxFileSnapshot {
  filePath: string;
  existedBefore: boolean;
  zlibBase64: string;
  sha256Before: string;
  sha256After?: string;
  bytesBefore: number;
}

export interface SandboxDiffLine {
  type: 'context' | 'added' | 'removed';
  beforeLine: number | null;
  afterLine: number | null;
  content: string;
}

export interface SandboxFileDiff {
  filePath: string;
  existedBefore: boolean;
  existsNow: boolean;
  sha256Before: string;
  sha256Current: string;
  bytesBefore: number;
  bytesCurrent: number;
  changed: boolean;
  addedCount: number;
  removedCount: number;
  lines: SandboxDiffLine[];
}

export interface SandboxDiffReport {
  sandboxId: string;
  label: string;
  status: SubagentSandbox['status'];
  inspectedAt: string;
  changedFilesCount: number;
  totalAddedLines: number;
  totalRemovedLines: number;
  files: SandboxFileDiff[];
}

export interface ArchitecturalDriftItem {
  id: string;
  severity: 'NOMINAL' | 'WARNING' | 'DRIFT_DETECTED';
  memoryId: string;
  memoryTopic: string;
  memoryCategory: MemoryCategory;
  targetFile: string;
  symbolCount: number;
  coupledFiles: string[];
  summary: string;
  recommendation: string;
}

export interface SubagentSandbox {
  id: string;
  label: string;
  agentCallsign: string;
  status: 'ACTIVE' | 'MERGED' | 'ROLLED_BACK';
  createdAt: string;
  updatedAt: string;
  targetFiles: string[];
  snapshots: SandboxFileSnapshot[];
  verify1Passed: boolean;
  verify2Passed: boolean;
  notes: string;
}

export interface ScoutSymbolEntry {
  id: string;
  name: string;
  kind: 'function' | 'class' | 'interface' | 'type' | 'const' | 'route';
  filePath: string;
  startLine: number;
  endLine: number;
  signature: string;
  imports: string[];
}

export interface CoChangeEdge {
  fileA: string;
  fileB: string;
  coCommits: number;
  couplingScore: number; // |C(A ∩ B)| / sqrt(|C(A)| * |C(B)|)
}

export interface DotsTask {
  id: string;
  slug: string; // e.g. .dots/jev-router-v3
  title: string;
  lane: SwarmLane;
  priority: 'P0' | 'P1' | 'P2';
  status: 'READY' | 'IN_PROGRESS' | 'COMPLETED' | 'BLOCKED';
  dependsOn: string[];
  assignedAgent: string;
  tokenEstimate: number;
  verifiedAt?: string;
}

export interface AgentHandoff {
  id: string;
  timestamp: string;
  fromAgent: string;
  toAgent: string;
  authorityLevel: 'HUMAN_WINS' | 'ORCHESTRATOR' | 'WORKER';
  taskRef: string;
  contextToon: string;
  status: 'DELIVERED' | 'ACCEPTED' | 'SUPERSEDED_BY_HUMAN';
}

export interface FleetBroadcast {
  id: string;
  timestamp: string;
  sender: string;
  priority: 'ROUTINE' | 'ELEVATED' | 'OVERRIDE_HUMAN_WINS';
  directive: string;
  acknowledgedBy: string[];
}

export interface PromptForgeTemplate {
  id: string;
  name: string;
  category: 'ULTRASCAN' | 'BUGFIX_LINEAGE' | 'SWARM_DISPATCH' | 'CUSTOM';
  rawPrompt: string;
  toonOptimizedPrompt: string;
  tokenSavingsPercent: number;
  usageCount: number;
}

export interface SelfLearnCandidate {
  id: string;
  createdAt: string;
  sourceTurnId: string;
  topic: string;
  extractedFact: string;
  suggestedTier: MemoryTier;
  suggestedCategory: MemoryCategory;
  redactedSecretsCount: number;
  supersedesMemoryId?: string | null;
  status: 'PENDING' | 'COMMITTED' | 'DISCARDED';
}

export interface QuotaTelemetry5h {
  windowHours: number;
  budgetTokens5h: number;
  consumedTokens5h: number;
  savedByDietTokens5h: number;
  promptsRouted5h: number;
  microTicks5h: number;
  verifyGatePassRate: number; // 0..100
  estimatedHoursSaved: number;
  stageSavings: {
    deltaCacheTokens: number;
    toonCompressionTokens: number;
    scoutMapTokens: number;
    microTickTokens: number;
    toolPruningTokens: number;
  };
  source?: DataOriginSource;
}

export interface BrainLiveStatus {
  endpointUrl: string;
  httpOnline: boolean;
  sqliteWalDetected: boolean;
  sqlitePath?: string;
  lastCheckedAt: string;
  remoteMemoryCount: number;
  remoteSwarmActive: boolean;
  latencyMs: number;
  mode: 'HYBRID_LIVE_8765' | 'NATIVE_STANDALONE';
}

export interface AppSettings {
  operatorName: string;
  organizationName: string;
  language: LanguageCode;
  personalityMode: PersonalityMode;
  autonomyLevel: AutonomyLevel;
  modelProvider: ModelProviderType;
  preferredGeminiModel: string;
  ollamaEndpoint: string;
  ollamaModel: string;
  openRouterEndpoint: string;
  openRouterModel: string;
  antigravityBrainUrl: string;
  antigravityBrainSqlitePath?: string;
  alwaysApprovedCommands: string[];
  onboardingCompleted: boolean;
  wakeWordEnabled: boolean;
  voiceDspEnabled: boolean;
  preferredVoiceName?: GeminiVoiceName;
  liveVoiceScreenSync?: boolean;
  focusModeEnabled: boolean;
  proactiveGlobalEnabled?: boolean;
  proactiveCadenceSec?: number;
  sidecarDirectControlEnabled?: boolean;
  trustThreshold?: number;
  seedMode?: SeedMode;
}

export type McpTransportType = 'HTTP_STREAMABLE' | 'SSE' | 'STDIO';

export type McpLibraryCategory = 'CORE_LOCAL' | 'WEB_SEARCH' | 'CLOUD_DEVOPS' | 'PRODUCTIVITY';

export interface McpRegistryToolItem {
  id: string;
  name: string;
  title: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations: {
    title: string;
    readOnlyHint: boolean;
    idempotentHint: boolean;
    destructiveHint: boolean;
    openWorldHint: boolean;
  };
  enabled: boolean;
  jevEligible: boolean;
  origin: 'BUILT_IN' | 'CUSTOM';
  healthStatus: 'HEALTHY' | 'DEGRADED' | 'DISABLED';
  lastLatencyMs: number;
  callCount: number;
  errorCount: number;
  lastCheckedAt: string;
  mockResponseJson?: string;
}

export interface McpRegistryResourceItem {
  id: string;
  uri: string;
  name: string;
  description: string;
  mimeType: string;
  isTemplate: boolean;
  enabled: boolean;
  origin: 'BUILT_IN' | 'CUSTOM';
  healthStatus: 'HEALTHY' | 'DEGRADED' | 'DISABLED';
  lastLatencyMs: number;
  readCount: number;
  lastCheckedAt: string;
  staticPayload?: string;
}

export interface McpAuthorityCheckItem {
  id: string;
  label: string;
  status: 'PASS' | 'WARN' | 'FAIL';
  detail: string;
}

export interface McpAuthorityGateResult {
  allowed: boolean;
  requiresHumanApproval: boolean;
  riskScore: number;
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  verdict: 'VERIFIED_SAFE' | 'REQUIRES_STDIO_APPROVAL' | 'BLOCKED_SECURITY_RISK';
  checks: McpAuthorityCheckItem[];
  redactedSecretsCount: number;
  checkedAt: string;
}

export interface McpLatencyStats {
  currentMs: number;
  minMs: number;
  maxMs: number;
  avgMs: number;
  p95Ms: number;
  jitterMs: number;
  uptimePercent: number;
  samples: number[];
}

export interface McpCustomServer {
  id: string;
  name: string;
  slug: string;
  category: McpLibraryCategory | 'CUSTOM';
  description: string;
  transport: McpTransportType;
  endpointUrl?: string;
  command?: string;
  args?: string[];
  envKeys: Record<string, string>;
  enabled: boolean;
  jevEligible: boolean;
  authStatus: 'AUTHORIZED' | 'PENDING_APPROVAL';
  healthStatus: 'ONLINE' | 'DEGRADED' | 'OFFLINE' | 'PENDING_AUTH';
  lastLatencyMs: number;
  latencyHistory?: number[];
  probeCount?: number;
  errorCount?: number;
  lastRpcMethod?: string;
  discoveredTools: string[];
  lastCheckedAt: string;
  lastError?: string;
  fromLibraryId?: string;
  authorityGate?: McpAuthorityGateResult;
}

export interface McpStandardLibraryItem {
  id: string;
  name: string;
  slug: string;
  category: McpLibraryCategory;
  description: string;
  transport: McpTransportType;
  defaultEndpointOrCommand: string;
  defaultArgs: string[];
  requiredEnvKeys: string[];
  sampleTools: string[];
  version: string;
  officialPackage: string;
}

export interface JarvisStoreData {
  schemaVersion?: number;
  seedMode?: SeedMode;
  settings: AppSettings;
  projects?: ProjectWorkspace[];
  activeProjectId?: string;
  chatThreads?: ChatThread[];
  activeChatId?: string;
  projectActivityLogs?: ProjectActivityLogEntry[];
  projectArtifacts?: ProjectArtifact[];
  latestScreenSnapshot?: ScreenCaptureSnapshot | null;
  goals: GoalItem[];
  contracts: TodayContractItem[];
  candidates: Q18Candidate[];
  decisions: DecisionItem[];
  routineCues: RoutineCue[];
  rooms: Room[];
  messages: ChatMessage[];
  workflows: Workflow[];
  workflowRuns: WorkflowRun[];
  heartbeat: HeartbeatConfig;
  memories: MemoryItem[];
  graphEdges: GraphEdge[];
  skills: SkillItem[];
  plugins?: PluginItem[];
  channels: ChannelConfig[];
  devices: DeviceNode[];
  enrollmentTokens: EnrollmentToken[];
  sidecarCommandQueue?: SidecarHostCommandRecord[];
  approvals: ApprovalRequest[];
  auditLogs: AuditLogEntry[];
  // v3.0 Swarm 48x + Orbit Agent OS Collections
  swarmRuns?: SwarmRun[];
  sandboxes?: SubagentSandbox[];
  dotsTasks?: DotsTask[];
  handoffs?: AgentHandoff[];
  fleetBroadcasts?: FleetBroadcast[];
  promptForge?: PromptForgeTemplate[];
  selfLearnQueue?: SelfLearnCandidate[];
  quota5h?: QuotaTelemetry5h;
  // MCP 2026 Native Gateway Registry & Custom Servers
  mcpRegistryTools?: McpRegistryToolItem[];
  mcpRegistryResources?: McpRegistryResourceItem[];
  mcpServers?: McpCustomServer[];
}
