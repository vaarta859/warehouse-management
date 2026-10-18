import multer from "multer";

const allowedMimeTypes = [
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
];

const storage =
  multer.memoryStorage();

const fileFilter = (
  req,
  file,
  callback
) => {
  if (
    !allowedMimeTypes.includes(
      file.mimetype
    )
  ) {
    return callback(
      new Error(
        "Only PDF, JPG, PNG and WEBP files are allowed."
      ),
      false
    );
  }

  callback(null, true);
};

export const upload =
  multer({
    storage,

    limits: {
      fileSize:
        10 * 1024 * 1024,
    },

    fileFilter,
  });