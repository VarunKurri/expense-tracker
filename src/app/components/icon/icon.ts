import { Component, Input } from '@angular/core';

@Component({
  selector: 'app-icon',
  standalone: true,
  imports: [],
  template: `
    <svg
      [attr.width]="size"
      [attr.height]="size"
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      [attr.stroke-width]="stroke"
      stroke-linecap="round"
      stroke-linejoin="round"
      style="display:block;flex-shrink:0;">
      <path [attr.d]="paths[name]" />
    </svg>
  `
})
export class Icon {
  @Input() name!: string;
  @Input() size = 16;
  @Input() stroke = 1.75;

  paths: Record<string, string> = {
    home:      'M3 10L10 4l7 6v6a1 1 0 01-1 1h-3v-5H9v5H6a1 1 0 01-1-1v-6z',
    accounts:  'M2 8a2 2 0 012-2h12a2 2 0 012 2v6a2 2 0 01-2 2H4a2 2 0 01-2-2V8zm0 3h16M6 15h4',
    tx:        'M4 8l3-4 3 4M7 4v9M10 12l3 4 3-4M13 16V7',
    bills:     'M5 6h10M5 10h10M5 14h6',
    budgets:   'M10 2a8 8 0 100 16A8 8 0 0010 2zm0 5a3 3 0 100 6 3 3 0 000-6z',
    analysis:  'M2.5 15.5l5-6.5 4 4 5.5-8M15 5h3.5v3.5',
    profile:   'M10 10a3 3 0 100-6 3 3 0 000 6zM4 17c0-3 3-5 6-5s6 2 6 5',
    settings:  'M10 13a3 3 0 100-6 3 3 0 000 6zM16 10l2-1-1-2-2 1-1.5-1L13 5h-2l-.5 2L9 8l-2-1-1 2 2 1v2l-2 1 1 2 2-1 1.5 1L11 17h2l.5-2L15 14l2 1 1-2-2-1z',
    search:    'M8 14A6 6 0 108 2a6 6 0 000 12zM18 18l-4.35-4.35',
    bell:      'M4 8a6 6 0 1112 0v4l2 3H2l2-3V8zM8 18a2 2 0 004 0',
    plus:      'M10 4v12M4 10h12',
    sun:       'M10 3v1.5M10 15.5V17M3 10H1.5M18.5 10H17M4.93 4.93l1.06 1.06M14.01 14.01l1.06 1.06M4.93 15.07l1.06-1.06M14.01 5.99l1.06-1.06M10 13a3 3 0 100-6 3 3 0 000 6z',
    moon:      'M17 12.5A7 7 0 119.5 3a5 5 0 007.5 9.5z',
    close:     'M5 5l10 10M15 5L5 15',
    arrowUp:   'M10 17V3M4 9l6-6 6 6',
    arrowDown: 'M10 3v14M4 11l6 6 6-6',
    trash:     'M5 6h10M8 6V4h4v2m-6 0l1 11h6l1-11',
    edit:      'M12 4l4 4L7 17H3v-4zM11 5l4 4',
    filter:    'M3 5h14M5 10h10M8 15h4',
    calendar:  'M4 5h12a1 1 0 011 1v11a1 1 0 01-1 1H4a1 1 0 01-1-1V6a1 1 0 011-1zM3 9h14M7 3v4M13 3v4',
    receipt:   'M5 3h10v14l-2-1-1.5 1L10 16l-1.5 1L7 16l-2 1V3zm2 4h6m-6 3h6m-6 3h4',
    wallet:    'M3 6a2 2 0 012-2h10a2 2 0 012 2v1H3V6zm0 2h14v7a2 2 0 01-2 2H5a2 2 0 01-2-2V8zm10 3h2',
    card:      'M2 6a2 2 0 012-2h12a2 2 0 012 2v8a2 2 0 01-2 2H4a2 2 0 01-2-2V6zm0 3h16M5 13h4',
    cash:      'M2 6a1 1 0 011-1h14a1 1 0 011 1v8a1 1 0 01-1 1H3a1 1 0 01-1-1V6zm8 2a2 2 0 100 4 2 2 0 000-4z',
  };
}