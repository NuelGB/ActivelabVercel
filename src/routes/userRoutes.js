const express = require("express");
const router = express.Router();
const {
  register, login, getProfile, updateProfile, deleteAccount, getPaymentHistory, hidePayment
} = require("../controllers/userController");
const { verifyUserToken } = require("../middleware/userAuthMiddleware");
const upload = require("../middleware/uploadMiddleware");
const { forgotPassword, validateResetToken, resetPassword } = require("../controllers/userPasswordController");
const { getNotifications, markAllRead, deleteNotification } = require("../controllers/notificationController");

router.post("/register", register);
router.post("/login", login);

router.get("/payments",            verifyUserToken, getPaymentHistory);
router.post("/payments/:id/hide",  verifyUserToken, hidePayment);

router.get("/profile", verifyUserToken, getProfile);

router.put(
  "/profile",
  verifyUserToken,
  upload.single("user_photo"),
  (err, req, res, next) => {
    if (err) return res.status(400).json({ success: false, message: err.message });
    next();
  },
  updateProfile
);

// Password reset (public)
router.post("/forgot-password",        forgotPassword);
router.get("/validate-reset-token",    validateResetToken);
router.post("/reset-password",         resetPassword);

router.delete("/me", verifyUserToken, deleteAccount);
router.get("/notifications",           verifyUserToken, getNotifications);
router.post("/notifications/read-all", verifyUserToken, markAllRead);
router.delete("/notifications/:id",    verifyUserToken, deleteNotification);

module.exports = router;