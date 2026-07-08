import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { EncryptionService } from '../../services/encryption.service';
import { BackupService } from '../../services/backup.service';
import { AuthService } from '../../services/auth.service';
import { ToastService } from '../../services/toast.service';
import { Modal } from '../../components/modal/modal';

@Component({
  selector: 'app-settings',
  standalone: true,
  imports: [CommonModule, FormsModule, Modal],
  templateUrl: './settings.html',
  styleUrl: './settings.scss'
})
export class Settings {
  private router = inject(Router);
  encryption = inject(EncryptionService);
  private backup = inject(BackupService);
  auth = inject(AuthService);
  private toast = inject(ToastService);
  busy = signal(false);

  // Change email (password-provider accounts only): reauthenticate with the
  // current password, then Firebase emails a confirmation link to the new
  // address — nothing changes until that link is clicked.
  changeEmailModalOpen = signal(false);
  changeEmailPassword = signal('');
  changeEmailNew = signal('');

  // Recovery code shown once after generation.
  recoveryModalOpen = signal(false);
  generatedCode = signal('');

  // Backup export / restore.
  exportModalOpen = signal(false);
  exportPassword = signal('');
  importModalOpen = signal(false);
  importPassword = signal('');
  importFileText = signal('');
  importFileName = signal('');

  navigate(path: string) { this.router.navigate([path]); }

  async exportBackup() {
    if (this.busy()) return;
    this.busy.set(true);
    try {
      const blob = await this.backup.exportVault(this.exportPassword());
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `trackr-backup-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      this.exportModalOpen.set(false);
      this.exportPassword.set('');
      this.toast.success('Encrypted backup downloaded.');
    } catch (err: any) {
      this.toast.error(err?.message || 'Could not export a backup.');
    } finally {
      this.busy.set(false);
    }
  }

  onImportFile(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    this.importFileName.set(file.name);
    const reader = new FileReader();
    reader.onload = () => this.importFileText.set(String(reader.result || ''));
    reader.readAsText(file);
  }

  async restoreBackup() {
    if (this.busy()) return;
    if (!this.importFileText()) {
      this.toast.error('Choose a backup file first.');
      return;
    }
    this.busy.set(true);
    try {
      const counts = await this.backup.importVault(this.importFileText(), this.importPassword());
      const total = Object.values(counts).reduce((a, b) => a + b, 0);
      this.toast.success(`Restored ${total} item(s) from backup.`);
      this.importModalOpen.set(false);
      this.importPassword.set('');
      this.importFileText.set('');
      this.importFileName.set('');
    } catch (err: any) {
      this.toast.error(err?.message || 'Could not restore the backup.');
    } finally {
      this.busy.set(false);
    }
  }

  async createRecoveryCode() {
    if (this.busy()) return;
    this.busy.set(true);
    try {
      const code = await this.encryption.createRecoveryCode();
      this.generatedCode.set(code);
      this.recoveryModalOpen.set(true);
    } catch (err: any) {
      this.toast.error(err?.message || 'Could not create a recovery code.');
    } finally {
      this.busy.set(false);
    }
  }

  async copyRecoveryCode() {
    try {
      await navigator.clipboard.writeText(this.generatedCode());
      this.toast.success('Recovery code copied.');
    } catch {
      this.toast.error('Could not copy. Select and copy it manually.');
    }
  }

  closeRecoveryModal() {
    this.recoveryModalOpen.set(false);
    this.generatedCode.set('');
  }

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

  openChangeEmail() {
    this.changeEmailPassword.set('');
    this.changeEmailNew.set('');
    this.changeEmailModalOpen.set(true);
  }

  closeChangeEmail() {
    this.changeEmailModalOpen.set(false);
    this.changeEmailPassword.set('');
    this.changeEmailNew.set('');
  }

  async submitChangeEmail() {
    if (this.busy()) return;
    const newEmail = this.changeEmailNew().trim();
    if (!newEmail || !this.changeEmailPassword()) {
      this.toast.error('Enter your current password and the new email.');
      return;
    }
    this.busy.set(true);
    try {
      await this.auth.changeEmail(this.changeEmailPassword(), newEmail);
      this.toast.success(`Confirmation link sent to ${newEmail}. Click it to finish the change.`);
      this.closeChangeEmail();
    } catch (err: any) {
      this.toast.error(err?.message || 'Could not change your email.');
    } finally {
      this.busy.set(false);
    }
  }
}