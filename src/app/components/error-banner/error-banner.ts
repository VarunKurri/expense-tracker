import { Component, Input } from '@angular/core';

@Component({
  selector: 'app-error-banner',
  standalone: true,
  templateUrl: './error-banner.html',
  styleUrl: './error-banner.scss',
})
export class ErrorBanner {
  @Input() message: string | null = null;
}
