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

    // An installed home-screen PWA is almost never "reloaded" the normal browser
    // way — it gets backgrounded and reopened. Relying only on a timer meant a
    // freshly-deployed fix could sit undetected for up to an hour of real use.
    // Check shortly after boot, and every time the app comes back to the
    // foreground, so a reopen after backgrounding reliably picks up new deploys.
    setTimeout(() => this.swUpdate.checkForUpdate(), 5_000);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') this.swUpdate.checkForUpdate();
    });
    setInterval(() => this.swUpdate.checkForUpdate(), 30 * 60 * 1000);
  }

  async reload() {
    // VERSION_READY means the new version finished downloading, but the old
    // service worker is still the one actively serving content until it's
    // explicitly promoted — a plain reload without this could still hand back
    // the stale cached version.
    await this.swUpdate.activateUpdate();
    document.location.reload();
  }
}
