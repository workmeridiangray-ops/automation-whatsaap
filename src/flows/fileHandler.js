const { getMediaUrl, downloadMedia } = require("../services/whatsapp");
const { uploadMedia } = require("../services/woocommerce");

// WordPress's media library rejects uploads whose filename extension doesn't
// match a known-safe type (its default upload_filetypes allowlist) — sending
// "whatsapp-order-<id>.bin" with "application/octet-stream" always got
// "Sorry, you are not allowed to upload this file type" (confirmed live,
// rest_upload_sideload_error, 500). Map WhatsApp's actual mime type to a
// real extension so WP accepts the exact same file it would via its own
// upload form.
const EXTENSION_BY_MIME = {
  "application/pdf": "pdf",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "application/postscript": "ai", // covers some AI/EPS exports some clients send
  "application/vnd.adobe.photoshop": "psd",
};

// Pulls the customer's uploaded file out of WhatsApp and into the WP media
// library, returning the WP attachment id to link to the eventual order.
async function handleIncomingFile(mediaId, mimeType) {
  const url = await getMediaUrl(mediaId);
  const buffer = await downloadMedia(url);

  const cleanMime = (mimeType || "").split(";")[0].trim(); // strip "; name=..." suffix WhatsApp sometimes adds
  const extension = EXTENSION_BY_MIME[cleanMime];
  if (!extension) {
    throw new Error(
      `Unsupported file type "${cleanMime || "unknown"}" — please send a PDF, JPG or PNG.`
    );
  }

  const filename = `whatsapp-order-${mediaId}.${extension}`;
  const media = await uploadMedia(buffer, filename, cleanMime);
  return media.id;
}

module.exports = { handleIncomingFile };
