import { Jimp } from 'jimp';
import jsQR from 'jsqr';

/**
 * Check if the image at the given URL contains a QR code.
 * @param url Image URL
 * @returns true if QR code is detected
 */
export async function detectQrCode(url: string): Promise<boolean> {
  if (!url) return false;
  try {
    // Jimp.read supports URL, buffer, etc.
    const image = await Jimp.read(url);
    const { width, height, data } = image.bitmap;
    
    // jsQR expects Uint8ClampedArray
    const clamped = new Uint8ClampedArray(data);
    const code = jsQR(clamped, width, height);
    
    return !!code;
  } catch (e) {
    // If download fails or decode fails, just return false
    // console.error('QR Check Error:', e);
    return false;
  }
}
