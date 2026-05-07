import { Injectable, signal } from '@angular/core';

export interface Toast {
  id: string;
  message: string;
  type: 'success' | 'error' | 'info';
  duration: number;
}

@Injectable({ providedIn: 'root' })
export class ToastService {
  toasts = signal<Toast[]>([]);

  private show(message: string, type: Toast['type'], duration = 3500) {
    const id = Math.random().toString(36).slice(2);
    this.toasts.update(t => [...t, { id, message, type, duration }]);
    setTimeout(() => this.dismiss(id), duration);
  }

  success(message: string) { this.show(message, 'success'); }
  error(message: string)   { this.show(message, 'error', 5000); }
  info(message: string)    { this.show(message, 'info'); }

  dismiss(id: string) {
    this.toasts.update(t => t.filter(toast => toast.id !== id));
  }
}