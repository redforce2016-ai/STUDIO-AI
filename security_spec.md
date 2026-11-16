# Firestore Security Specification (`security_spec.md`)

## 1. Data Invariants
1. **Default Deny**: Every unmatched path is denied (`allow read, write: if false`).
2. **Verified Identity**: All read/write access requires `request.auth != null` and `request.auth.token.email_verified == true`.
3. **PII Isolation (Split Collection)**: User `email` is isolated in `/users/{userId}/private/info` and strictly restricted to `request.auth.uid == userId`. Public display metadata lives in `/users/{userId}/public/profile`.
4. **Strict Ownership & Immutability**: Every `StudioProject` (`/projects/{projectId}`) and `MediaAsset` (`/mediaLibrary/{assetId}`) requires `ownerId == request.auth.uid` on create and `incoming().ownerId == existing().ownerId` + `incoming().createdAt == existing().createdAt` on update.
5. **Master Gate Parent Verification**: Every `/projects/{projectId}/shots/{shotId}` write verifies via `get(/databases/$(database)/documents/projects/$(projectId))` that the parent project exists, is owned by `request.auth.uid`, and has not reached terminal `completed` lock.
6. **Temporal Integrity**: `createdAt == request.time` on create; `updatedAt == request.time` on both create and update.
7. **Terminal State Locking**: Once a `StudioProject` reaches `currentStage == 'completed'`, updates to that project document are rejected.
8. **Query Enforcer**: `allow list` on `/projects`, `/projects/{projectId}/shots`, and `/mediaLibrary` enforces `resource.data.ownerId == request.auth.uid` without `get()` calls inside list rules.

## 2. The "Dirty Dozen" Adversarial Payloads
1. **Identity Spoofing on Create**: `POST /projects/proj_1` with `ownerId: "victim_uid"` while signed in as `"attacker_uid"`. -> Expected: `PERMISSION_DENIED`.
2. **Unverified Email Bypass**: `POST /users/attacker/private/info` with `email_verified: false`. -> Expected: `PERMISSION_DENIED`.
3. **Ghost / Shadow Field Injection**: `POST /projects/proj_2` containing all required fields plus `"isAdmin": true`. -> Expected: `PERMISSION_DENIED`.
4. **Document ID Poisoning**: `POST /projects/bad$id..with.1500chars` violating `isValidId()`. -> Expected: `PERMISSION_DENIED`.
5. **Client Timestamp Forgery**: `POST /projects/proj_3` with `createdAt: "2020-01-01T00:00:00Z"` instead of `request.time`. -> Expected: `PERMISSION_DENIED`.
6. **Immutable Field Mutation**: `PATCH /projects/proj_1` changing `ownerId` or `createdAt`. -> Expected: `PERMISSION_DENIED`.
7. **Terminal State Modification**: `PATCH /projects/proj_completed` when `existing().currentStage == "completed"`. -> Expected: `PERMISSION_DENIED`.
8. **Orphaned Shot Creation**: `POST /projects/nonexistent_proj/shots/shot_1` where parent project does not exist. -> Expected: `PERMISSION_DENIED`.
9. **Cross-Tenant Shot Hijack**: `POST /projects/victim_proj/shots/shot_1` by attacker who does not own `victim_proj`. -> Expected: `PERMISSION_DENIED`.
10. **PII Cross-User Read**: `GET /users/victim_uid/private/info` by `"attacker_uid"`. -> Expected: `PERMISSION_DENIED`.
11. **Unscoped List Query Scraping**: `LIST /projects` without `where('ownerId', '==', uid)`. -> Expected: `PERMISSION_DENIED`.
12. **Value Size / Type Poisoning**: `PATCH /mediaLibrary/asset_1` with `title: 12345` or 1MB `prompt` string (>3000 chars). -> Expected: `PERMISSION_DENIED`.
