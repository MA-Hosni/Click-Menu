import { getCurrentUser } from "../../../auth";
import { createAdminImageUploadHandler } from "../../../../lib/admin-image-upload";
import { saveImage } from "../../../../lib/image-store";

export const POST = createAdminImageUploadHandler({
  getCurrentUser,
  saveImage,
});
