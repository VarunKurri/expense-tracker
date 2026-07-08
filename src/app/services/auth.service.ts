import { Injectable, inject, signal } from '@angular/core';
import {
  Auth, GoogleAuthProvider,
  signInWithPopup, signInWithRedirect, getRedirectResult,
  signOut, user, createUserWithEmailAndPassword,
  signInWithEmailAndPassword, sendPasswordResetEmail,
  updateProfile
} from '@angular/fire/auth';
import { toSignal } from '@angular/core/rxjs-interop';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private auth = inject(Auth);
  user = toSignal(user(this.auth), { initialValue: null });
  // False until Firebase reports the initial auth state (so we can show a boot
  // splash instead of flashing the login page while the session is restoring).
  resolved = signal(false);

  constructor() {
    const sub = user(this.auth).subscribe(() => {
      this.resolved.set(true);
      sub.unsubscribe();
    });

    // Pick up the result when returning from a redirect sign-in
    getRedirectResult(this.auth).catch(() => {
      // Ignore errors here — they surface through the user signal
    });
  }

  async signInWithGoogle() {
    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account' });

    try {
      // Try popup first — better UX (no full page reload)
      return await signInWithPopup(this.auth, provider);
    } catch (err: any) {
      const code = err?.code || '';

      // User deliberately closed the popup — not an error, return silently
      if (code === 'auth/popup-closed-by-user' ||
          code === 'auth/cancelled-popup-request') {
        return null;
      }

      // Popup blocked by COOP/browser policy — fall back to redirect
      if (code === 'auth/popup-blocked' ||
          err?.message?.includes('Cross-Origin-Opener-Policy')) {
        return signInWithRedirect(this.auth, provider);
      }

      // Any other real error — rethrow so app.ts shows a toast
      throw err;
    }
  }

  async signUpWithEmail(email: string, password: string, displayName?: string) {
    try {
      const credential = await createUserWithEmailAndPassword(this.auth, email, password);
      if (displayName?.trim()) {
        await updateProfile(credential.user, { displayName: displayName.trim() });
      }
      return credential;
    } catch (err) {
      throw new Error(this.friendlyAuthError(err));
    }
  }

  async signInWithEmail(email: string, password: string) {
    try {
      return await signInWithEmailAndPassword(this.auth, email, password);
    } catch (err) {
      throw new Error(this.friendlyAuthError(err));
    }
  }

  async sendPasswordReset(email: string) {
    try {
      await sendPasswordResetEmail(this.auth, email);
    } catch (err) {
      throw new Error(this.friendlyAuthError(err));
    }
  }

  signOut() {
    return signOut(this.auth);
  }

  friendlyAuthError(err: any): string {
    const code = err?.code || '';
    const map: Record<string, string> = {
      'auth/email-already-in-use': 'That email is already registered.',
      'auth/invalid-email': 'Enter a valid email address.',
      'auth/invalid-credential': 'Email or password is incorrect.',
      'auth/user-not-found': 'No account exists for that email.',
      'auth/wrong-password': 'Email or password is incorrect.',
      'auth/weak-password': 'Use a password with at least 6 characters.',
      'auth/password-does-not-meet-requirements': 'That password does not meet the requirements. Try a stronger one.',
      'auth/operation-not-allowed': 'Email/password sign-up is not enabled for this app. Use Google sign-in, or enable it in Firebase.',
      'auth/too-many-requests': 'Too many attempts. Please wait and try again.',
      'auth/network-request-failed': 'Network error. Check your connection and try again.',
    };
    return map[code] || `Authentication failed${code ? ` (${code})` : ''}. Please try again.`;
  }
}
