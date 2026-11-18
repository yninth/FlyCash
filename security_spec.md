# Firestore Security Specification (Phase 0)

## 1. Data Invariants
1. **Strict Ownership Isolation**: Every `/users/{userId}` document and subcollection document (`/watchlist/{watchId}`, `/ledger/{entryId}`, `/alerts/{alertId}`) belongs exclusively to `{userId}` where `request.auth.uid == userId` and `request.auth.token.email_verified == true`.
2. **Master Gate Enforcement**: Subcollection reads/writes verify the parent `/users/{userId}` document exists and its `uid` matches `request.auth.uid`.
3. **Immutable Ownership & Creation Time**: `uid`, `ownerId`, and `createdAt` cannot be modified after creation.
4. **Server Timestamps**: All `createdAt` (on create) and `updatedAt` (on create/update) must equal `request.time`.
5. **Bounded Types & Strict Keys**: Every string enforces `.size()` limits, every numeric field enforces sane financial bounds, and ghost/shadow fields are rejected via `keys().hasAll(...) && keys().hasOnly(...)` + `affectedKeys().hasOnly(...)`.
6. **Zero PII Exposure**: No `email`, `phone`, or `address` fields are stored in Firestore documents; authentication relies strictly on Firebase Auth Google Sign-In.

## 2. The "Dirty Dozen" Adversarial Payloads
1. Unauthenticated read of `/users/userA`.
2. Verified User B attempting to `get` `/users/userA/ledger/entry1`.
3. Verified User B attempting to `list` `/users/userA/watchlist`.
4. User A creating `/users/userA` with `uid: "userB"` (identity spoofing).
5. User A creating `/users/userA` with an extra shadow field `isAdmin: true`.
6. User A creating `/users/userA` with `createdAt` set to a client-forged past timestamp instead of `request.time`.
7. Unverified email user (`email_verified: false`) attempting to write `/users/userA/ledger/entry1`.
8. User A creating `/users/userA/watchlist/bad$id!` with invalid path ID characters or >128 chars.
9. User A creating `/users/userA/ledger/entry1` with `quantity: -5` or `symbol` > 40 chars.
10. User A updating `/users/userA/ledger/entry1` while attempting to change `ownerId` or `createdAt`.
11. User A updating `/users/userA` with `totalCapitalCny: "not-a-number"` (value poisoning).
12. User A writing to an undeclared collection `/admin/backdoor`.
