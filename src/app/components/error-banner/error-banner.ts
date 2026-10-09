import { Component, Input } from '@angular/core';

@Component({
  selector: 'app-error-banner',
  standalone: true,
  templateUrl: './error-banner.html',
  styleUrl: './error-banner.scss',
  // With no message it renders nothing, but the empty element still took a
  // row in its page's flex column, adding a gap (two banners on Budgets left
  // a blank band above the first card on a phone). Gone entirely instead.
  host: { '[style.display]': "message ? null : 'none'" },
})
export class ErrorBanner {
  @Input() message: string | null = null;
}
