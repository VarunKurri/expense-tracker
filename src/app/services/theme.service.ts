import { Injectable, signal, effect } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class ThemeService {
  // Dark is the default — Origin's look is built on a near-black canvas.
  // index.html applies the same choice inline before first paint so the page
  // doesn't flash the wrong theme while Angular boots.
  theme = signal<'light' | 'dark'>(
    localStorage.getItem('theme') === 'light' ? 'light' : 'dark'
  );

  constructor() {
    effect(() => {
      const t = this.theme();
      document.documentElement.setAttribute('data-theme', t);
      localStorage.setItem('theme', t);
      document.querySelector('meta[name="theme-color"]')
        ?.setAttribute('content', t === 'dark' ? '#0A0A0A' : '#FAFAFA');
    });
  }

  toggle() {
    this.theme.update(t => t === 'light' ? 'dark' : 'light');
  }
}