import { Injectable, signal, effect } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class ThemeService {
  theme = signal<'light' | 'dark'>(
    (localStorage.getItem('theme') as 'light' | 'dark') || 'light'
  );

  constructor() {
    effect(() => {
      const t = this.theme();
      document.documentElement.setAttribute('data-theme', t);
      localStorage.setItem('theme', t);
      document.querySelector('meta[name="theme-color"]')
        ?.setAttribute('content', t === 'dark' ? '#0B0B0D' : '#F5F5F7');
    });
  }

  toggle() {
    this.theme.update(t => t === 'light' ? 'dark' : 'light');
  }
}