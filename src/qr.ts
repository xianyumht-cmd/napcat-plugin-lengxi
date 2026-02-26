import { Jimp } from 'jimp';
import jsQR from 'jsqr';

/**
 * Helper to scan bitmap data with jsQR
 */
function scanImage(image: any): boolean {
  try {
    const { width, height, data } = image.bitmap;
    const clamped = new Uint8ClampedArray(data);
    // jsQR options: inversionAttempts defaults to 'attemptBoth'
    const code = jsQR(clamped, width, height, { inversionAttempts: 'attemptBoth' });
    return !!code;
  } catch {
    return false;
  }
}

/**
 * Check if the image at the given URL contains a QR code.
 * Implements a multi-pass strategy to enhance detection rate:
 * 1. Raw scan
 * 2. Pre-processing (Grayscale + Contrast + Normalize)
 * 3. Scaling (Downscale large images / Upscale small images)
 * @param url Image URL
 * @returns true if QR code is detected
 */
export async function detectQrCode(url: string): Promise<boolean> {
  if (!url) return false;
  try {
    // Jimp.read supports URL, buffer, etc.
    const image = await Jimp.read(url);
    
    // Pass 1: Raw Scan (Fastest)
    if (scanImage(image)) return true;

    // Pass 2: Pre-processing (Grayscale + High Contrast)
    // Enhance features for standard QR codes
    const processed = image.clone();
    processed.greyscale().contrast(0.5).normalize();
    if (scanImage(processed)) return true;

    // Pass 3: Scaling Strategy
    // jsQR can struggle with very large images (noise) or very small images
    const { width, height } = image.bitmap;
    let scaled: any = null;

    if (width > 1200 || height > 1200) {
        // Downscale large images to reduce noise and improve speed
        scaled = image.clone().resize({ w: width / 2 });
    } else if (width < 200 || height < 200) {
        // Upscale small images
        scaled = image.clone().scale(2);
    }

    if (scaled) {
        // Try raw scaled
        if (scanImage(scaled)) return true;
        // Try processed scaled
        scaled.greyscale().contrast(0.4).normalize();
        if (scanImage(scaled)) return true;
    }

    return false;
  } catch (e) {
    // If download fails or decode fails, just return false
    // console.error('QR Check Error:', e);
    return false;
  }
}
