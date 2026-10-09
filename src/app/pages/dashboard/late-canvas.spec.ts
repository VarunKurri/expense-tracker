import { Component, ElementRef, ViewChild, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';

/**
 * Pins down the Angular behaviour the dashboard donut relies on: a @ViewChild
 * setter on an element inside an @if fires when that element appears *after*
 * the first render. That is the cold-load case (the canvas only appears once
 * transactions have finished decrypting), which is exactly when the old
 * polling version gave up and the donut never drew.
 */
@Component({
  standalone: true,
  template: `@if (hasData()) { <canvas #c></canvas> }`,
})
class LateCanvas {
  hasData = signal(false);
  seen: (HTMLCanvasElement | undefined)[] = [];
  @ViewChild('c') set canvas(ref: ElementRef<HTMLCanvasElement> | undefined) {
    this.seen.push(ref?.nativeElement);
  }
}

describe('dashboard donut: canvas that appears late', () => {
  it('is handed to the setter when it appears after first render, and again when it leaves', async () => {
    const fixture = TestBed.createComponent(LateCanvas);
    fixture.detectChanges();
    await fixture.whenStable();
    const c = fixture.componentInstance;

    // First render: no data yet, so no canvas.
    expect(c.seen.filter(Boolean).length).toBe(0);

    // Data arrives later.
    c.hasData.set(true);
    fixture.detectChanges();
    await fixture.whenStable();
    const appeared = c.seen.at(-1);
    expect(appeared).toBeInstanceOf(HTMLCanvasElement);
    expect(appeared!.isConnected).toBe(true);

    // And it is told when the canvas goes away, so the chart can be destroyed.
    c.hasData.set(false);
    fixture.detectChanges();
    await fixture.whenStable();
    expect(c.seen.at(-1)).toBeUndefined();
  });
});
