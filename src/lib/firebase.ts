import { initializeApp } from "firebase/app";
import {
  getAuth,
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithPopup,
  signOut,
  type User,
} from "firebase/auth";
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocFromServer,
  getFirestore,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  type Unsubscribe,
} from "firebase/firestore";
import firebaseConfig from "../../firebase-applet-config.json";
import type { PipelineStage, ProjectRecord } from "../types/studio";

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
export const auth = getAuth(app);

export const GOOGLE_DRIVE_SCOPES = [
  "https://www.googleapis.com/auth/drive",
  "https://www.googleapis.com/auth/drive.activity",
  "https://www.googleapis.com/auth/drive.activity.readonly",
  "https://www.googleapis.com/auth/drive.appdata",
  "https://www.googleapis.com/auth/drive.apps.readonly",
  "https://www.googleapis.com/auth/drive.file",
  "https://www.googleapis.com/auth/drive.install",
  "https://www.googleapis.com/auth/drive.meet.readonly",
  "https://www.googleapis.com/auth/drive.metadata",
  "https://www.googleapis.com/auth/drive.metadata.readonly",
  "https://www.googleapis.com/auth/drive.photos.readonly",
  "https://www.googleapis.com/auth/drive.readonly",
  "https://www.googleapis.com/auth/drive.scripts",
] as const;

export const googleProvider = new GoogleAuthProvider();
for (const scope of GOOGLE_DRIVE_SCOPES) {
  googleProvider.addScope(scope);
}
googleProvider.setCustomParameters({ prompt: "select_account" });

// Strict in-memory cache for Google Workspace OAuth access token (never stored in localStorage/sessionStorage)
let cachedGoogleAccessToken: string | null = null;
let isGoogleSigningIn = false;
const tokenListeners = new Set<(token: string | null) => void>();

function setCachedGoogleAccessToken(next: string | null) {
  cachedGoogleAccessToken = next;
  for (const listener of tokenListeners) {
    try {
      listener(next);
    } catch {
      // ignore listener errors
    }
  }
}

export function getGoogleDriveAccessToken(): string | null {
  return cachedGoogleAccessToken;
}

export function hasGoogleDriveAccess(): boolean {
  return Boolean(cachedGoogleAccessToken);
}

export function subscribeGoogleDriveToken(listener: (token: string | null) => void): () => void {
  tokenListeners.add(listener);
  listener(cachedGoogleAccessToken);
  return () => {
    tokenListeners.delete(listener);
  };
}

export enum OperationType {
  CREATE = "create",
  UPDATE = "update",
  DELETE = "delete",
  LIST = "list",
  GET = "get",
  WRITE = "write",
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null
): never {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo:
        auth.currentUser?.providerData?.map((provider) => ({
          providerId: provider.providerId,
          email: provider.email,
        })) || [],
    },
    operationType,
    path,
  };
  console.error("Firestore Error: ", JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

async function testConnection() {
  try {
    await getDocFromServer(doc(db, "test", "connection"));
  } catch (error) {
    if (error instanceof Error && error.message.includes("the client is offline")) {
      console.error("Please check your Firebase configuration.");
    }
  }
}
void testConnection();

const VALID_ID_REGEX = /^[a-zA-Z0-9_-]+$/;

function clampStr(val: string | undefined | null, maxLen: number): string {
  if (!val) return "";
  return val.length > maxLen ? val.slice(0, maxLen) : val;
}

function sanitizeId(id: string): string {
  const cleaned = id.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 128);
  return VALID_ID_REGEX.test(cleaned) && cleaned.length > 0 ? cleaned : `id_${Date.now()}`;
}

function mapStageForFirestoreRules(
  stage: PipelineStage
): "input" | "research_script" | "voiceover" | "director" | "visuals" | "completed" {
  switch (stage) {
    case "input":
      return "input";
    case "research_script":
      return "research_script";
    case "voiceover":
      return "voiceover";
    case "storyboard":
      return "director";
    case "video_shots":
    case "assembly":
      return "visuals";
    case "completed":
      return "completed";
    default:
      return "input";
  }
}

export function subscribeAuthState(callback: (user: User | null) => void): Unsubscribe {
  return onAuthStateChanged(auth, (user) => {
    if (!user && !isGoogleSigningIn) {
      setCachedGoogleAccessToken(null);
    }
    callback(user);
  });
}

export async function signInWithGoogle(): Promise<User> {
  isGoogleSigningIn = true;
  try {
    const cred = await signInWithPopup(auth, googleProvider);
    const oauthCred = GoogleAuthProvider.credentialFromResult(cred);
    if (oauthCred?.accessToken) {
      setCachedGoogleAccessToken(oauthCred.accessToken);
    }
    await ensureUserProfileDocs(cred.user);
    return cred.user;
  } finally {
    isGoogleSigningIn = false;
  }
}

export async function signInWithGoogleForColabDrive(): Promise<{
  user: User;
  accessToken: string | null;
}> {
  const user = await signInWithGoogle();
  return { user, accessToken: cachedGoogleAccessToken };
}

export async function signOutUser(): Promise<void> {
  setCachedGoogleAccessToken(null);
  await signOut(auth);
}

export async function ensureUserProfileDocs(user: User): Promise<void> {
  const uid = sanitizeId(user.uid);
  const publicPath = `users/${uid}/public/profile`;
  const privatePath = `users/${uid}/private/info`;

  try {
    const publicRef = doc(db, "users", uid, "public", "profile");
    const pubSnap = await getDoc(publicRef);
    const displayName = clampStr(user.displayName || "کاربر استودیو", 120) || "کاربر استودیو";
    const photoUrl = clampStr(user.photoURL || "", 500);

    if (!pubSnap.exists()) {
      await setDoc(publicRef, {
        userId: uid,
        displayName,
        photoUrl,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } else {
      await updateDoc(publicRef, {
        displayName,
        photoUrl,
        updatedAt: serverTimestamp(),
      });
    }
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, publicPath);
  }

  if (user.email) {
    try {
      const privateRef = doc(db, "users", uid, "private", "info");
      const privSnap = await getDoc(privateRef);
      const email = clampStr(user.email, 254);

      if (!privSnap.exists()) {
        await setDoc(privateRef, {
          userId: uid,
          email,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      } else {
        await updateDoc(privateRef, {
          email,
          updatedAt: serverTimestamp(),
        });
      }
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, privatePath);
    }
  }
}

export async function syncProjectToFirestore(uid: string, project: ProjectRecord): Promise<void> {
  const projectId = sanitizeId(project.id);
  const ownerId = sanitizeId(uid);
  const docPath = `projects/${projectId}`;
  const docRef = doc(db, "projects", projectId);

  try {
    const existingSnap = await getDoc(docRef);
    const stageFields = {
      currentStage: mapStageForFirestoreRules(project.currentStage),
      checkpointStatus: project.checkpointStatus,
      videoTitle: clampStr(project.researchScript?.videoTitle, 250),
      researchSummary: clampStr(project.researchScript?.researchSummary, 10000),
      scriptHook: clampStr(project.researchScript?.hook, 2000),
      scriptBody: clampStr(project.researchScript?.body, 15000),
      scriptCta: clampStr(project.researchScript?.cta, 2000),
      narrationText: clampStr(project.voiceover?.narrationText, 15000),
      shotsCount: Math.min(30, Math.max(0, project.director?.shots.length ?? 0)),
      updatedAt: serverTimestamp(),
    };

    if (!existingSnap.exists()) {
      await setDoc(docRef, {
        id: projectId,
        ownerId,
        threadId: clampStr(project.threadId, 160),
        title: clampStr(project.brief.title, 200) || "پروژه بدون عنوان",
        idea: clampStr(project.brief.idea, 5000) || "-",
        platform: project.brief.platform,
        tone: project.brief.tone,
        targetDurationSeconds: Math.min(
          1800,
          Math.max(10, Math.round(project.brief.targetDurationSeconds || 35))
        ),
        ...stageFields,
        createdAt: serverTimestamp(),
      });
    } else {
      const existingData = existingSnap.data();
      if (existingData?.currentStage === "completed") {
        return;
      }
      await updateDoc(docRef, stageFields);
    }

    if (project.director?.shots?.length) {
      for (const shot of project.director.shots.slice(0, 30)) {
        const shotId = sanitizeId(`shot_${shot.shotNumber}`);
        const shotPath = `projects/${projectId}/shots/${shotId}`;
        const shotRef = doc(db, "projects", projectId, "shots", shotId);
        const visualMatch = project.visuals?.shots.find((v) => v.shotNumber === shot.shotNumber);

        try {
          const shotSnap = await getDoc(shotRef);
          const shotUpdatePayload = {
            shotNumber: shot.shotNumber,
            timecode: clampStr(shot.timecode, 32) || "00:00 - 00:05",
            durationSeconds: Math.min(120, Math.max(1, shot.durationSeconds || 5)),
            cameraAngle: clampStr(shot.cameraAngle, 200) || "نمای متوسط",
            cameraMovement: clampStr(shot.cameraMovement, 200) || "ثابت",
            sceneDescriptionFa: clampStr(shot.sceneDescriptionFa, 2000) || "-",
            spokenSegment: clampStr(shot.spokenSegment, 2000),
            onScreenText: clampStr(shot.onScreenText, 200),
            lightingAndMood: clampStr(shot.lightingAndMood, 500),
            visualPromptFa: clampStr(shot.visualPromptFa, 2000) || "-",
            imageUrl: clampStr(visualMatch?.imageUrl, 500),
            updatedAt: serverTimestamp(),
          };
          if (!shotSnap.exists()) {
            await setDoc(shotRef, {
              id: shotId,
              projectId,
              ownerId,
              ...shotUpdatePayload,
              createdAt: serverTimestamp(),
            });
          } else {
            await updateDoc(shotRef, shotUpdatePayload);
          }
        } catch (shotErr) {
          handleFirestoreError(shotErr, OperationType.WRITE, shotPath);
        }
      }
    }
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, docPath);
  }
}

export async function deleteProjectFromFirestore(projectIdRaw: string): Promise<void> {
  const projectId = sanitizeId(projectIdRaw);
  const path = `projects/${projectId}`;
  try {
    await deleteDoc(doc(db, "projects", projectId));
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, path);
  }
}

export interface CloudProjectSummary {
  id: string;
  title: string;
  platform: string;
  currentStage: string;
  shotsCount?: number;
}

export function subscribeUserCloudProjects(
  uid: string,
  onData: (items: CloudProjectSummary[]) => void,
  onError?: (err: Error) => void
): Unsubscribe {
  const path = "projects";
  const q = query(collection(db, path), where("ownerId", "==", sanitizeId(uid)));
  return onSnapshot(
    q,
    (snapshot) => {
      const items: CloudProjectSummary[] = snapshot.docs.map((d) => {
        const data = d.data();
        return {
          id: String(data.id || d.id),
          title: String(data.title || ""),
          platform: String(data.platform || "reels"),
          currentStage: String(data.currentStage || "input"),
          shotsCount: typeof data.shotsCount === "number" ? data.shotsCount : 0,
        };
      });
      onData(items);
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.LIST, path);
      } catch (wrapped) {
        if (onError && wrapped instanceof Error) onError(wrapped);
      }
    }
  );
}
