/**
 * Firestore Security Rules Test Specification (Dirty Dozen Adversarial Suite)
 * Verifies that all 12 adversarial payloads targeting Identity, Integrity, and State
 * fail with PERMISSION_DENIED against firestore.rules when run with @firebase/rules-unit-testing.
 */

export interface DirtyDozenCase {
  id: number;
  name: string;
  operation: "get" | "list" | "create" | "update";
  path: string;
  auth: { uid: string; email?: string; email_verified?: boolean } | null;
  payload?: Record<string, unknown>;
  expected: "PERMISSION_DENIED";
}

export const DIRTY_DOZEN_CASES: DirtyDozenCase[] = [
  {
    id: 1,
    name: "Identity Spoofing on Project Create",
    operation: "create",
    path: "projects/proj_1",
    auth: { uid: "attacker_uid", email: "attacker@example.com", email_verified: true },
    payload: {
      id: "proj_1",
      ownerId: "victim_uid",
      threadId: "thread_proj_1",
      title: "Hijacked Project",
      idea: "Test idea",
      platform: "reels",
      tone: "educational",
      targetDurationSeconds: 45,
      currentStage: "input",
      checkpointStatus: "idle",
    },
    expected: "PERMISSION_DENIED",
  },
  {
    id: 2,
    name: "Unverified Email Bypass",
    operation: "create",
    path: "users/attacker_uid/private/info",
    auth: { uid: "attacker_uid", email: "attacker@example.com", email_verified: false },
    payload: {
      userId: "attacker_uid",
      email: "attacker@example.com",
    },
    expected: "PERMISSION_DENIED",
  },
  {
    id: 3,
    name: "Ghost / Shadow Field Injection",
    operation: "create",
    path: "projects/proj_2",
    auth: { uid: "user_1", email: "user1@example.com", email_verified: true },
    payload: {
      id: "proj_2",
      ownerId: "user_1",
      threadId: "thread_proj_2",
      title: "Shadow Project",
      idea: "Test idea",
      platform: "reels",
      tone: "educational",
      targetDurationSeconds: 30,
      currentStage: "input",
      checkpointStatus: "idle",
      isAdmin: true,
    },
    expected: "PERMISSION_DENIED",
  },
  {
    id: 4,
    name: "Document ID Poisoning",
    operation: "create",
    path: "projects/invalid$id.with.dots",
    auth: { uid: "user_1", email: "user1@example.com", email_verified: true },
    payload: {
      id: "invalid$id.with.dots",
      ownerId: "user_1",
      threadId: "thread_bad",
      title: "Bad ID",
      idea: "Test idea",
      platform: "reels",
      tone: "educational",
      targetDurationSeconds: 30,
      currentStage: "input",
      checkpointStatus: "idle",
    },
    expected: "PERMISSION_DENIED",
  },
  {
    id: 5,
    name: "Client Timestamp Forgery",
    operation: "create",
    path: "projects/proj_3",
    auth: { uid: "user_1", email: "user1@example.com", email_verified: true },
    payload: {
      id: "proj_3",
      ownerId: "user_1",
      threadId: "thread_proj_3",
      title: "Forged Time",
      idea: "Test idea",
      platform: "shorts",
      tone: "cinematic_story",
      targetDurationSeconds: 45,
      currentStage: "input",
      checkpointStatus: "idle",
      createdAt: "2020-01-01T00:00:00Z",
      updatedAt: "2020-01-01T00:00:00Z",
    },
    expected: "PERMISSION_DENIED",
  },
  {
    id: 6,
    name: "Immutable ownerId Mutation",
    operation: "update",
    path: "projects/proj_1",
    auth: { uid: "user_1", email: "user1@example.com", email_verified: true },
    payload: {
      ownerId: "other_user",
    },
    expected: "PERMISSION_DENIED",
  },
  {
    id: 7,
    name: "Terminal State Modification After Completion",
    operation: "update",
    path: "projects/proj_completed",
    auth: { uid: "user_1", email: "user1@example.com", email_verified: true },
    payload: {
      title: "Mutated after completion",
    },
    expected: "PERMISSION_DENIED",
  },
  {
    id: 8,
    name: "Orphaned Shot Creation Without Parent Project",
    operation: "create",
    path: "projects/nonexistent_proj/shots/shot_1",
    auth: { uid: "user_1", email: "user1@example.com", email_verified: true },
    payload: {
      id: "shot_1",
      projectId: "nonexistent_proj",
      ownerId: "user_1",
      shotNumber: 1,
      timecode: "00:00 - 00:05",
      durationSeconds: 5,
      cameraAngle: "نمای بسته",
      cameraMovement: "ثابت",
      sceneDescriptionFa: "صحنه اول",
      visualPromptFa: "دستور تصویر",
    },
    expected: "PERMISSION_DENIED",
  },
  {
    id: 9,
    name: "Cross-Tenant Shot Hijack",
    operation: "create",
    path: "projects/victim_proj/shots/shot_1",
    auth: { uid: "attacker_uid", email: "attacker@example.com", email_verified: true },
    payload: {
      id: "shot_1",
      projectId: "victim_proj",
      ownerId: "attacker_uid",
      shotNumber: 1,
      timecode: "00:00 - 00:05",
      durationSeconds: 5,
      cameraAngle: "نمای بسته",
      cameraMovement: "ثابت",
      sceneDescriptionFa: "تزریق شات",
      visualPromptFa: "دستور تصویر",
    },
    expected: "PERMISSION_DENIED",
  },
  {
    id: 10,
    name: "PII Cross-User Read",
    operation: "get",
    path: "users/victim_uid/private/info",
    auth: { uid: "attacker_uid", email: "attacker@example.com", email_verified: true },
    expected: "PERMISSION_DENIED",
  },
  {
    id: 11,
    name: "Unscoped Collection List Scraping",
    operation: "list",
    path: "projects",
    auth: { uid: "attacker_uid", email: "attacker@example.com", email_verified: true },
    expected: "PERMISSION_DENIED",
  },
  {
    id: 12,
    name: "Value Size / Type Poisoning on Media Asset",
    operation: "update",
    path: "mediaLibrary/asset_1",
    auth: { uid: "user_1", email: "user1@example.com", email_verified: true },
    payload: {
      title: 999999,
      prompt: "x".repeat(4000),
    },
    expected: "PERMISSION_DENIED",
  },
];
