/**
 * Security test suite specification for CrossMarket Desk Firestore rules.
 * Covers the Dirty Dozen adversarial payloads against /users/{userId},
 * /users/{userId}/watchlist/{watchId}, /users/{userId}/ledger/{entryId}, and /users/{userId}/alerts/{alertId}.
 */
export const dirtyDozenSecurityCases = [
  { id: 1, description: 'Unauthenticated read on /users/userA', expected: 'PERMISSION_DENIED' },
  { id: 2, description: 'Cross-user get on /users/userA/ledger/entry1 by userB', expected: 'PERMISSION_DENIED' },
  { id: 3, description: 'Cross-user list on /users/userA/watchlist by userB', expected: 'PERMISSION_DENIED' },
  { id: 4, description: 'Identity spoofing: userA creates /users/userA with uid=userB', expected: 'PERMISSION_DENIED' },
  { id: 5, description: 'Shadow field injection: isAdmin=true on UserSettings create', expected: 'PERMISSION_DENIED' },
  { id: 6, description: 'Forged client timestamp on createdAt != request.time', expected: 'PERMISSION_DENIED' },
  { id: 7, description: 'Unverified email user write to /users/userA/ledger/entry1', expected: 'PERMISSION_DENIED' },
  { id: 8, description: 'Invalid document ID characters (bad$id!) in watchlist', expected: 'PERMISSION_DENIED' },
  { id: 9, description: 'Negative quantity (-5) in ledger entry creation', expected: 'PERMISSION_DENIED' },
  { id: 10, description: 'Mutating immutable ownerId or createdAt on ledger update', expected: 'PERMISSION_DENIED' },
  { id: 11, description: 'Value poisoning: totalCapitalCny as string instead of number', expected: 'PERMISSION_DENIED' },
  { id: 12, description: 'Write to undeclared /admin/backdoor collection', expected: 'PERMISSION_DENIED' },
] as const;
