const express = require("express");
const router = express.Router();
const {
  getAllBranches,
  createBranch,
  updateBranch,
  deleteBranch,
} = require("../controllers/branchController");
const { verifyToken, requirePusat } = require("../middleware/authMiddleware");
const upload = require("../middleware/uploadMiddleware");

// Semua rute di bawah ini butuh login dan hak akses admin pusat
router.use(verifyToken);
router.use(requirePusat);

router.get("/", getAllBranches);
router.post("/", upload.single("branch_photo"), createBranch);
router.put("/:id", upload.single("branch_photo"), updateBranch);
router.delete("/:id", deleteBranch);

module.exports = router;