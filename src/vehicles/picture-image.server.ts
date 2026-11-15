import sharp from 'sharp';

import { pictureMaxBytes, pictureMaxPixels, pictureDimension } from './picture-policy';

export class InvalidPictureError extends Error {}

export async function processPicture(file: Buffer): Promise<Buffer> {
    if (!file.length || file.length > pictureMaxBytes) throw new InvalidPictureError('Invalid image size.');

    // Only pass supported raster containers to the image decoder.
    const jpeg = file[0] === 0xff && file[1] === 0xd8 && file[2] === 0xff;
    const png = file.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    const webp = file.toString('ascii', 0, 4) === 'RIFF' && file.toString('ascii', 8, 12) === 'WEBP';
    const heif = file.toString('ascii', 4, 8) === 'ftyp';

    if (!jpeg && !png && !webp && !heif) throw new InvalidPictureError('Unsupported image format.');

    try {
        const image = sharp(file, { failOn: 'none', limitInputPixels: pictureMaxPixels });
        const metadata = await image.metadata();

        if (!['jpeg', 'png', 'webp', 'heif'].includes(metadata.format ?? '') || metadata.compression === 'av1') {
            throw new InvalidPictureError('Unsupported image format.');
        }

        return await image
            .rotate()
            .resize(pictureDimension, pictureDimension, { fit: 'inside', withoutEnlargement: true })
            .flatten({ background: '#ffffff' })
            .jpeg({ quality: 90, progressive: true, force: true })
            .toBuffer();
    } catch {
        throw new InvalidPictureError('Image could not be decoded.');
    }
}
