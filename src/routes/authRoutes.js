const express = require("express");
const router = express.Router();
const { login, getMe } = require("../controllers/authController");
const {
  forgotPassword,
  validateResetToken,
  resetPassword,
} = require("../controllers/passwordController");
const { verifyToken } = require("../middleware/authMiddleware");

// ─── Auth ─────────────────────────────────────────────────────
router.post("/login", login);
router.get("/me", verifyToken, getMe);

router.post("/forgot-password", forgotPassword);
router.get("/validate-reset-token", validateResetToken);
router.post("/reset-password", resetPassword);

module.exports = router;