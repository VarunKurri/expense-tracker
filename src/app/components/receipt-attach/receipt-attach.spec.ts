import { ComponentFixture, TestBed } from '@angular/core/testing';
import { describe, it, expect, afterEach } from 'vitest';
import { ReceiptAttach } from './receipt-attach';

describe('ReceiptAttach — taking a photo vs uploading one', () => {
  const realMatchMedia = window.matchMedia;
  afterEach(() => { window.matchMedia = realMatchMedia; });

  function render(touch: boolean): ComponentFixture<ReceiptAttach> {
    window.matchMedia = ((q: string) => ({ matches: touch && q.includes('coarse'), media: q })) as any;
    const fixture = TestBed.createComponent(ReceiptAttach);
    fixture.detectChanges();
    return fixture;
  }
  const buttons = (f: ComponentFixture<ReceiptAttach>) =>
    [...f.nativeElement.querySelectorAll('.receipt-buttons button')].map((b: Element) => b.textContent!.trim());

  it('a phone or tablet can take a photo, or upload one', () => {
    expect(buttons(render(true))).toEqual(['Take photo', 'Upload']);
  });

  it('a desktop only uploads', () => {
    expect(buttons(render(false))).toEqual(['Upload']);
  });

  it('"Take photo" opens the back camera; "Upload" opens the picker', () => {
    const f = render(true);
    const inputs = [...f.nativeElement.querySelectorAll('input[type="file"]')] as HTMLInputElement[];
    expect(inputs.map(i => i.getAttribute('capture'))).toEqual(['environment', null]);
    expect(inputs.every(i => i.accept === 'image/*')).toBe(true);
  });

  it('once attached: the thumbnail, and Replace / Remove', () => {
    const f = render(false);
    f.componentRef.setInput('image', 'data:image/jpeg;base64,AAA');
    f.componentRef.setInput('actionLabel', 'Fill in from it');
    f.detectChanges();
    expect(f.nativeElement.querySelector('.receipt-thumb img').getAttribute('src')).toBe('data:image/jpeg;base64,AAA');
    expect([...f.nativeElement.querySelectorAll('.receipt-actions button')].map((b: Element) => b.textContent!.trim()))
      .toEqual(['Fill in from it', 'Replace', 'Remove']);
  });
});
