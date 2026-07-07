import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { EncryptionService } from '../../services/encryption.service';
import { ToastService } from '../../services/toast.service';

@Component({
  selector: 'app-settings',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './settings.html',
  styleUrl: './settings.scss'
})
export class Settings {
  private router = inject(Router);
  encryption = inject(EncryptionService);
  private toast = inject(ToastService);
  busy = signal(false);

  navigate(path: string) { this.router.navigate([path]); }

  async setupPasskey() {
    if (this.busy()) return;
    this.busy.set(true);
    try {
      await this.encryption.registerPasskey();
      this.toast.success('Passkey unlock is set up on this device.');
    } catch (err: any) {
      this.toast.error(err?.message || 'Could not set up a passkey.');
    } finally {
      this.busy.set(false);
    }
  }

  async removePasskey() {
    if (this.busy()) return;
    this.busy.set(true);
    try {
      await this.encryption.removePasskey();
      this.toast.success('Passkey removed. Passphrase unlock still works.');
    } catch (err: any) {
      this.toast.error(err?.message || 'Could not remove the passkey.');
    } finally {
      this.busy.set(false);
    }
  }
}