import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ToastService, Toast as ToastModel } from '../../services/toast.service';

@Component({
  selector: 'app-toast',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="toast-container">
      @for (toast of toastService.toasts(); track toast.id) {
        <div class="toast" [class]="toast.type" (click)="toastService.dismiss(toast.id)">
          <div class="toast-icon">
            @if (toast.type === 'success') {
              <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
                <path d="M4 10l5 5 7-8"/>
              </svg>
            } @else if (toast.type === 'error') {
              <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
                <path d="M10 6v5M10 14h.01"/>
              </svg>
            } @else {
              <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
                <circle cx="10" cy="10" r="8"/>
                <path d="M10 9v5M10 6h.01"/>
              </svg>
            }
          </div>
          <span class="toast-msg">{{ toast.message }}</span>
          <button class="toast-close" (click)="$event.stopPropagation(); toastService.dismiss(toast.id)">✕</button>
        </div>
      }
    </div>
  `,
  styleUrl: './toast.scss'
})
export class Toast {
  toastService = inject(ToastService);
}