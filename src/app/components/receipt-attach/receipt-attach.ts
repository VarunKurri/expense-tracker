import { Component, ElementRef, input, output, signal, viewChild } from '@angular/core';
import { Modal } from '../modal/modal';
import { Icon } from '../icon/icon';
import { canTakePhoto } from '../../utils/device';

/**
 * A transaction's receipt photo: attach one, see it, replace or remove it.
 * Used by the transaction form and the transaction view, so the two can't drift.
 *
 * - No photo: "Take photo" (phones and tablets — opens the camera) and "Upload".
 *   On a phone, "Upload" also offers the camera or the photo library.
 * - A photo: its thumbnail — tap for full size. Where it can be changed (the
 *   form), a ✕ on the thumbnail removes it and the host may add one action
 *   ("Fill in from it"). To replace a photo, remove it and add the new one.
 *   Where it can't (the details sheet), it's only shown.
 *
 * It only reports what was picked; the host decides when to store it.
 */
@Component({
  selector: 'app-receipt-attach',
  standalone: true,
  imports: [Modal, Icon],
  templateUrl: './receipt-attach.html',
  styleUrl: './receipt-attach.scss',
})
export class ReceiptAttach {
  /** The photo to show, as a data URL. */
  image = input<string | null>(null);
  /** An attached photo is still being fetched. */
  loading = input(false);
  /** Something is in progress (saving, reading) — buttons wait. */
  busy = input(false);
  /** Under "Receipt" when there's no photo yet. */
  hint = input('Attach a photo of the receipt.');
  /** Under "Receipt attached". */
  note = input('');
  /** One action beside the photo, e.g. "Fill in from it". Hidden when empty. */
  actionLabel = input('');
  /** Whether an attached photo can be removed here. The details sheet only shows it. */
  editable = input(true);

  picked = output<File>();
  removed = output<void>();
  action = output<void>();

  readonly camera = canTakePhoto();
  viewing = signal(false);

  private cameraInput = viewChild.required<ElementRef<HTMLInputElement>>('cameraInput');
  private fileInput = viewChild.required<ElementRef<HTMLInputElement>>('fileInput');

  takePhoto() { this.cameraInput().nativeElement.click(); }
  upload() { this.fileInput().nativeElement.click(); }

  onFile(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = ''; // so picking the same photo again still fires
    if (file) this.picked.emit(file);
  }
}
