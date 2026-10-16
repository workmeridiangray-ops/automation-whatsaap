const { getMediaUrl, downloadMedia } = require("../services/whatsapp");
const { uploadMedia } = require("../services/woocommerce");

// Pulls the customer's uploaded file out of WhatsApp and into the WP media
// library, returning the WP attachment id to link to the eventual order.
async function handleIncomingFile(mediaId) {
  const url = await getMediaUrl(mediaId);
  const buffer = await downloadMedia(url);

  // WhatsApp doesn't give a filename for media messages; mime type comes
  // from the webhook payload if you want to branch on pdf vs image — kept
  // generic here.
  const filename = `whatsapp-order-${mediaId}.bin`;
  const media = await uploadMedia(buffer, filename, "application/octet-stream");
  return media.id;
}

module.exports = { handleIncomingFile };
