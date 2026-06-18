# Trackr

Trackr is an Angular personal finance app for accounts, transactions, bills, budgets, imports, and spending analysis. It uses Firebase Authentication and Firestore, with client-side encryption for finance records.

## Features

- Google sign-in and email/password sign-in.
- Password reset email flow.
- Per-user Firestore data under `users/{uid}`.
- Client-side AES-GCM encryption for finance collections before data is written to Firestore.
- Accounts, transactions, bills, budgets, dashboard charts, analysis, and CSV import.
- PWA service worker configuration for production builds.

## Local Setup

```bash
npm install
npm start
```

Open `http://localhost:4200/`.

Build and test:

```bash
npm run build
npm test
```

## Firebase Setup

1. Create a Firebase project.
2. Enable Authentication providers:
   - Google
   - Email/Password
3. Create a Firestore database.
4. Copy `.firebaserc.example` to `.firebaserc` and set your project id.
5. Confirm `src/environments/environment.ts` and `src/environments/environment.prod.ts` point to your Firebase project.
6. Deploy Firestore rules:

```bash
firebase deploy --only firestore:rules
```

## Security Model

Firestore rules in `firestore.rules` ensure signed-in users can only read and write their own path:

```text
users/{uid}/...
```

Those rules prevent User A from reading User B data. They do not, by themselves, hide plaintext from the Firebase console or database exports.

Trackr also encrypts finance records client-side. After login, users unlock a local encryption key with a passphrase. Sensitive documents in `accounts`, `transactions`, `categories`, `bills`, and `budgets` are stored as encrypted payloads. Minimal metadata such as dates/timestamps may remain plaintext for sorting and app operation.

Important: password reset only restores Firebase account access. It cannot recover a forgotten encryption passphrase.

## Existing Plaintext Data

When an existing user unlocks encryption, Trackr migrates plaintext finance documents in their user collections into encrypted documents. Back up Firestore before rolling this out to real users.

## CSV Import

The import flow validates required headers, handles quoted CSV fields, blocks rows with warnings, skips duplicate transactions, and writes imported transactions in batches.

## PWA Notes

Production builds register the Angular service worker. Offline UI can load from cache, but finance writes are only considered synced after Firestore confirms them.
