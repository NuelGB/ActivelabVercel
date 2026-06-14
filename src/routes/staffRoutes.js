const express = require("express");
const router = express.Router();
const { getAllStaff, createStaff, updateStaff, deleteStaff } = require("../controllers/staffController");
const { verifyToken } = require("../middleware/authMiddleware");
const upload = require("../middleware/uploadMiddleware");

router.use(verifyToken);

// Semua route staff pakai upload.single("staff_image")
// field name di FormData frontend harus "staff_image"
const handleUpload = upload.single("staff_image");

// Error handler multer inline
const uploadMiddleware = (req, res, next) => {
  handleUpload(req, res, (err) => {
    if (err) {
      return res.status(400).json({
        success: false,
        message: err.message || "Upload gagal",
      });
    }
    next();
  });
};

router.get("/",          getAllStaff);
router.post("/",         uploadMiddleware, createStaff);
router.put("/:id",       uploadMiddleware, updateStaff);
router.delete("/:id",    deleteStaff);

module.exports = router;