import { Component, input } from '@angular/core';

/**
 * The Trackr mark: a rounded tile with an ascending sparkline.
 *
 * Chosen over a lettermark because the wordmark already carries the name in
 * Newsreader — the tile only has to read as "tracking", and it does so at
 * 16px where a serif "T" turns to mush.
 *
 * `tone`:
 *   'mono'  — tile in --fg, mark knocked out in --bg. The in-app default,
 *             which keeps the sidebar monochrome the way Origin's is.
 *   'brand' — blue→teal gradient tile. For the marketing surfaces (landing,
 *             login) where colour is welcome.
 */
@Component({
  selector: 'app-logo',
  standalone: true,
  template: `
    <svg [attr.width]="size()" [attr.height]="size()" viewBox="0 0 32 32"
         fill="none" role="img" aria-label="Trackr">
      @if (tone() === 'brand') {
        <defs>
          <linearGradient [attr.id]="gradId" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stop-color="var(--blue)" />
            <stop offset="100%" stop-color="var(--teal)" />
          </linearGradient>
        </defs>
        <rect width="32" height="32" [attr.rx]="radius()" [attr.fill]="'url(#' + gradId + ')'" />
      } @else {
        <rect width="32" height="32" [attr.rx]="radius()" fill="var(--fg)" />
      }
      <path d="M8.5 20.5 L14.5 14.5 L19 18 L23.5 10"
            [attr.stroke]="tone() === 'brand' ? '#fff' : 'var(--bg)'"
            stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" />
    </svg>
  `,
  styles: [':host { display: inline-flex; line-height: 0; }'],
})
export class Logo {
  size = input(28);
  tone = input<'mono' | 'brand'>('mono');

  /** Corner radius scales with the tile so it stays optically even. */
  radius = () => 9;

  /** Unique per instance so several logos on one page don't share a gradient. */
  readonly gradId = `trackr-g-${Math.random().toString(36).slice(2, 9)}`;
}
