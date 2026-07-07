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

  async rememberDevice() {
    if (this.busy()) return;
    this.busy.set(true);
    try {
      await this.encryption.rememberDevice();
      this.toast.success('This device will now skip the passphrase.');
    } catch (err: any) {
      this.toast.error(err?.message || 'Could not remember this device.');
    } finally {
      this.busy.set(false);
    }
  }

  async forgetDevice() {
    if (this.busy()) return;
    this.busy.set(true);
    try {
      await this.encryption.forgetDevice();
      this.toast.success('This device will ask for the passphrase again.');
    } catch (err: any) {
      this.toast.error(err?.message || 'Could not forget this device.');
    } finally {
      this.busy.set(false);
    }
  }
}