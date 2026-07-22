import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { AppUpdateService } from '../../services/app-update.service';

@Component({
  selector: 'app-update-banner',
  standalone: true,
  imports: [CommonModule],
  template: `
    @if (updateSvc.updateReady()) {
      <div class="update-banner">
        <span>A new version of Trackr is available.</span>
        <button class="btn" (click)="updateSvc.reload()">Reload</button>
      </div>
    }
  `,
  styleUrl: './update-banner.scss'
})
export class UpdateBanner {
  updateSvc = inject(AppUpdateService);
}
