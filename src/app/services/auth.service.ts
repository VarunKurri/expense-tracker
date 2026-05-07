import { Injectable, inject } from '@angular/core';
import {
  Auth, GoogleAuthProvider,
  signInWithPopup, signInWithRedirect, getRedirectResult,
  signOut, user
} from '@angular/fire/auth';
import { toSignal } from '@angular/core/rxjs-interop';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private auth = inject(Auth);
  user = toSignal(user(this.auth), { initialValue: null });

  constructor() {
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

  signOut() {
    return signOut(this.auth);
  }
}