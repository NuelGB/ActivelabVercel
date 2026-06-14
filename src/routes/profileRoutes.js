const express = require("express");
const router = express.Router();
const { getProfile, updateProfile } = require("../controllers/profileController");
const { verifyToken } = require("../middleware/authMiddleware");
const upload = require("../middleware/uploadMiddleware");

router.use(verifyToken);

router.get("/", getProfile);

router.put(
  "/",
  // Mengizinkan upload 2 field file sekaligus
  upload.fields([
    { name: "photo", maxCount: 1 },         // Key untuk foto admin
    { name: "branch_photo", maxCount: 1 },  // Key untuk foto branch
  ]),
  // Middleware penangkap error multer jika format/ukuran tidak sesuai
  (err, req, res, next) => {
    if (err) {
      console.error("Multer Upload Error:", err.message);
      return res.status(400).json({
        success: false,
        message: err.message || "Upload file gagal",
      });
    }
    next();
  },
  updateProfile
);

module.exports = router;