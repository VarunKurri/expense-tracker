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

  const attached = (f: ComponentFixture<ReceiptAttach>) => {
    f.componentRef.setInput('image', 'data:image/jpeg;base64,AAA');
    f.componentRef.setInput('actionLabel', 'Fill in from it');
    f.detectChanges();
    return f.nativeElement as HTMLElement;
  };

  it('in the form: the thumbnail with a ✕ to remove it, and one action', () => {
    const el = attached(render(false));
    expect(el.querySelector('.receipt-thumb img')!.getAttribute('src')).toBe('data:image/jpeg;base64,AAA');
    expect(el.querySelector('[aria-label="Remove the receipt"]')).toBeTruthy();
    expect([...el.querySelectorAll('.receipt-actions button')].map(b => b.textContent!.trim())).toEqual(['Fill in from it']);
  });

  it('on the details sheet: only the thumbnail — no ✕, no action', () => {
    const f = render(false);
    f.componentRef.setInput('editable', false);
    const el = attached(f);
    expect(el.querySelector('.receipt-thumb')).toBeTruthy();
    expect(el.querySelector('[aria-label="Remove the receipt"]')).toBeNull();
    expect(el.querySelector('.receipt-actions')).toBeNull();
  });

  it('tapping the thumbnail opens it full size', () => {
    const f = render(false);
    const el = attached(f);
    (el.querySelector('.receipt-thumb') as HTMLElement).click();
    f.detectChanges();
    expect(document.querySelector('.receipt-full')!.getAttribute('src')).toBe('data:image/jpeg;base64,AAA');
  });
});
