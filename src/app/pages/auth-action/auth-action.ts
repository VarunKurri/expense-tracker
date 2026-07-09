import { Component, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Auth } from '@angular/fire/auth';
import {
  verifyPasswordResetCode, confirmPasswordReset,
  checkActionCode, applyActionCode,
} from 'firebase/auth';

type Status = 'loading' | 'resetForm' | 'success' | 'error';
type ActionMode = 'resetPassword' | 'verifyEmail' | 'verifyAndChangeEmail' | 'recoverEmail' | null;

/**
 * Branded landing page for Firebase Auth email action links (password reset,
 * email verification, email change confirmation). Reached ONLY via an external
 * link from an email — never via in-app navigation — so it deliberately lives
 * outside the normal auth/encryption-gated shell (see app.ts: isAuthActionRoute).
 * We read mode/oobCode straight from the URL rather than ActivatedRoute so it
 * behaves the same whether or not the router's own state has settled yet.
 */
@Component({
  selector: 'app-auth-action',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './auth-action.html',
  styleUrl: './auth-action.scss',
})
export class AuthAction {
  private auth = inject(Auth);

  status = signal<Status>('loading');
  mode: ActionMode = null;
  private oobCode = '';

  // resetPassword flow
  resetEmail = signal('');
  newPassword = signal('');
  confirmPassword = signal('');
  busy = signal(false);
  errorMessage = signal('');
  successMessage = signal('');

  pwChecks = computed(() => {
    const pw = this.newPassword();
    return {
      length: pw.length >= 8,
      uppercase: /[A-Z]/.test(pw),
      symbol: /[^A-Za-z0-9]/.test(pw),
    };
  });
  passwordValid = computed(() => {
    const c = this.pwChecks();
    return c.length && c.uppercase && c.symbol;
  });
  formValid = computed(() =>
    this.passwordValid() && this.newPassword() === this.confirmPassword()
  );

  constructor() {
    const params = new URLSearchParams(window.location.search);
    this.mode = params.get('mode') as ActionMode;
    this.oobCode = params.get('oobCode') || '';
    this.run();
  }

  private async run() {
    if (!this.oobCode || !this.mode) {
      this.status.set('error');
      this.errorMessage.set('This link is missing required information. Request a new one.');
      return;
    }

    try {
      if (this.mode === 'resetPassword') {
        const email = await verifyPasswordResetCode(this.auth, this.oobCode);
        this.resetEmail.set(email);
        this.status.set('resetForm');
        return;
      }

      // verifyEmail, verifyAndChangeEmail, recoverEmail all just "apply" —
      // no further user input needed.
      const info = await checkActionCode(this.auth, this.oobCode);
      await applyActionCode(this.auth, this.oobCode);
      this.status.set('success');
      this.successMessage.set(this.messageFor(this.mode, info.data.email ?? undefined));
    } catch (err: any) {
      this.status.set('error');
      this.errorMessage.set(this.friendlyError(err));
    }
  }

  private messageFor(mode: ActionMode, email?: string): string {
    switch (mode) {
      case 'verifyEmail': return 'Your email address has been verified.';
      case 'verifyAndChangeEmail': return `Your email has been changed${email ? ` to ${email}` : ''}.`;
      case 'recoverEmail': return 'Your email change has been reverted.';
      default: return 'Done.';
    }
  }

  async submitNewPassword() {
    if (this.busy() || !this.formValid()) return;
    this.busy.set(true);
    this.errorMessage.set('');
    try {
      await confirmPasswordReset(this.auth, this.oobCode, this.newPassword());
      this.status.set('success');
      this.successMessage.set('Your password has been changed. You can now sign in.');
    } catch (err: any) {
      this.errorMessage.set(this.friendlyError(err));
    } finally {
      this.busy.set(false);
    }
  }

  goToApp() {
    // Full reload, not a router navigation — cleanly re-enters the normal
    // auth-gated app instead of staying in this standalone action view.
    window.location.href = '/';
  }

  private friendlyError(err: any): string {
    const code = err?.code || '';
    const map: Record<string, string> = {
      'auth/expired-action-code': 'This link has expired. Request a new one.',
      'auth/invalid-action-code': 'This link has already been used or is invalid. Request a new one.',
      'auth/user-disabled': 'This account has been disabled.',
      'auth/user-not-found': 'We could not find an account for this link.',
      'auth/weak-password': 'Choose a stronger password.',
    };
    return map[code] || 'Something went wrong with this link. Please request a new one.';
  }
}
