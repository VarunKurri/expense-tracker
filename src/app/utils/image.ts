/**
 * Shrinking a photo in the browser, before it goes anywhere.
 *
 * A receipt photo straight off a phone is 3–12 MB. Shrunk to 1600px on its
 * longest side as a JPEG it's 150–400 KB and every line is still readable —
 * small enough to store encrypted in one Firestore document (1 MiB, and
 * encryption makes it ~1.8× bigger), and cheap to send to the receipt reader.
 */

export interface FittedImage {
  /** A JPEG data URL. */
  dataUrl: string;
  width: number;
  height: number;
}

/**
 * The largest a stored photo's data URL may be. Encrypted, it's about 1.33×
 * this, plus a little JSON — comfortably under Firestore's 1 MiB per document.
 */
export const MAX_IMAGE_CHARS = 650_000;

/** Tried in order until one fits: sharpest first. */
export const ENCODINGS: { side: number; quality: number }[] = [
  { side: 1600, quality: 0.82 },
  { side: 1600, quality: 0.7 },
  { side: 1300, quality: 0.7 },
  { side: 1100, quality: 0.62 },
  { side: 900, quality: 0.55 },
];

/** The size of an image scaled so its longest side is at most `side`. */
export function scaledSize(width: number, height: number, side: number): { width: number; height: number } {
  const scale = Math.min(1, side / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

/** A photo, shrunk until it fits. Throws a readable message if it can't be opened. */
export async function fitImage(file: Blob): Promise<FittedImage> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file); // honours the photo's rotation
  } catch {
    throw new Error("Couldn't open that image. Try a JPEG or PNG photo.");
  }
  try {
    let last: FittedImage | null = null;
    for (const { side, quality } of ENCODINGS) {
      const { width, height } = scaledSize(bitmap.width, bitmap.height, side);
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error("Couldn't open that image.");
      ctx.fillStyle = '#fff'; // transparent PNGs would otherwise turn black
      ctx.fillRect(0, 0, width, height);
      ctx.drawImage(bitmap, 0, 0, width, height);
      last = { dataUrl: canvas.toDataURL('image/jpeg', quality), width, height };
      if (last.dataUrl.length <= MAX_IMAGE_CHARS) return last;
    }
    if (last) return last; // the smallest we make; a very long receipt may still be big
    throw new Error("Couldn't open that image.");
  } finally {
    bitmap.close();
  }
}
