/**
 * Whether this device is one you'd photograph a receipt with: a phone or a
 * tablet, whose main input is a finger. A laptop's webcam doesn't count — you
 * don't hold a receipt up to a laptop — so desktops get "Upload" only.
 */
export function canTakePhoto(): boolean {
  return typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia('(pointer: coarse)').matches;
}
