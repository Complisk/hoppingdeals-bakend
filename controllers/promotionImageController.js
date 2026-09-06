const sharp = require("sharp");
const { uploadImageToCloudinary } = require("../utils/cloudinaryUtils");

const CLOUDINARY_CLOUD_NAME = process.env.CLOUDINARY_CLOUD_NAME || "dgdfenqsv";
const MAX_FILE_SIZE = 10 * 1024 * 1024;
const MIN_SHORTEST_EDGE = 900;
const MAX_LONGEST_EDGE = 6000;
const ALLOWED_FORMATS = new Set(["jpeg", "png", "webp"]);

const mimeTypeForFormat = (format) =>
  ({ jpeg: "image/jpeg", png: "image/png", webp: "image/webp" })[format];

const isTrustedPromotionImageUrl = (value) => {
  try {
    const url = new URL(String(value || ""));
    return (
      url.protocol === "https:" &&
      url.hostname === `res.cloudinary.com` &&
      url.pathname.startsWith(`/${CLOUDINARY_CLOUD_NAME}/image/upload/`)
    );
  } catch {
    return false;
  }
};

// POST /api/business/promotion-image
// Validates decoded image data, normalizes EXIF orientation, then uploads it.
const uploadPromotionImage = async (req, res) => {
  try {
    if (!req.file?.buffer) {
      return res.status(400).json({ message: "An image file is required" });
    }

    if (req.file.size > MAX_FILE_SIZE) {
      return res.status(400).json({ message: "Image must be 10 MB or smaller" });
    }

    const metadata = await sharp(req.file.buffer, {
      limitInputPixels: 40_000_000,
      failOn: "error",
    }).metadata();
    const format = metadata.format;
    const width = Number(metadata.width || 0);
    const height = Number(metadata.height || 0);

    if (!ALLOWED_FORMATS.has(format)) {
      return res.status(400).json({
        message: "Only JPEG, PNG, and WebP images are supported",
      });
    }
    if (!width || !height || Math.min(width, height) < MIN_SHORTEST_EDGE) {
      return res.status(400).json({
        message: "Image must be at least 900 px on its shortest side",
      });
    }
    if (Math.max(width, height) > MAX_LONGEST_EDGE) {
      return res.status(400).json({
        message: "Image must not exceed 6000 px on its longest side",
      });
    }

    // rotate() applies EXIF orientation and output encoding removes metadata.
    let pipeline = sharp(req.file.buffer, {
      limitInputPixels: 40_000_000,
      failOn: "error",
    }).rotate();
    if (format === "jpeg") pipeline = pipeline.jpeg({ quality: 90, mozjpeg: true });
    if (format === "png") pipeline = pipeline.png({ compressionLevel: 9 });
    if (format === "webp") pipeline = pipeline.webp({ quality: 90 });

    const normalizedBuffer = await pipeline.toBuffer();
    const normalizedMetadata = await sharp(normalizedBuffer).metadata();
    const result = await uploadImageToCloudinary(
      normalizedBuffer,
      `promotions/${req.business.id}`,
      {
        filename: `promotion-${Date.now()}.${format === "jpeg" ? "jpg" : format}`,
        mimeType: mimeTypeForFormat(format),
      },
    );

    if (!result.success) {
      return res.status(502).json({ message: result.error || "Image upload failed" });
    }

    const image = {
      url: result.data.url,
      publicId: result.data.publicId,
      width: Number(normalizedMetadata.width || width),
      height: Number(normalizedMetadata.height || height),
      format,
      bytes: Number(result.data.size || normalizedBuffer.length),
      aspectRatio: Number((Number(normalizedMetadata.width || width) / Number(normalizedMetadata.height || height)).toFixed(4)),
    };

    return res.status(201).json({ imageUrl: image.url, image });
  } catch (error) {
    console.error("Promotion image upload failed:", error.message || error);
    return res.status(400).json({
      message: "We could not read that image. Please upload a valid JPEG, PNG, or WebP file.",
    });
  }
};

module.exports = { uploadPromotionImage, isTrustedPromotionImageUrl };
