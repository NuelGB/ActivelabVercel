const multer = require("multer");

// Gunakan memoryStorage agar file disimpan sementara dalam bentuk Buffer
const storage = multer.memoryStorage();

const fileFilter = (req, file, cb) => {
  // Hanya izinkan format gambar tertentu
  if (
    file.mimetype === 'image/jpeg' || 
    file.mimetype === 'image/jpg' || 
    file.mimetype === 'image/png'
  ) {
    cb(null, true);
  } else {
    cb(
      new Error(`Unsupported file type: ${file.mimetype}. Only images (jpg, jpeg, png) are allowed!`), 
      false
    );
  }
};

const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: 2 * 1024 * 1024, // Batas ukuran file maksimal 2 MB
  },
});

module.exports = upload;