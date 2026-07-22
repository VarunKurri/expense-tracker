import { Injectable, inject, signal } from '@angular/core';
import { SwUpdate } from '@angular/service-worker';

@Injectable({ providedIn: 'root' })
export class AppUpdateService {
  private swUpdate = inject(SwUpdate);
  updateReady = signal(false);

  constructor() {
    if (!this.swUpdate.isEnabled) return;

    this.swUpdate.versionUpdates.subscribe(event => {
      if (event.type === 'VERSION_READY') {
        this.updateReady.set(true);
      }
    });

    // Catch installs that happened while this tab was open in the background.
    setInterval(() => this.swUpdate.checkForUpdate(), 60 * 60 * 1000);
  }

  reload() {
    document.location.reload();
  }
}
