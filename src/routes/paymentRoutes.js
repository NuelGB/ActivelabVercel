const express = require("express");
const router = express.Router();
const { createPayment, checkPaymentStatus, handleNotification } = require("../controllers/paymentController");
const { verifyUserToken } = require("../middleware/userAuthMiddleware");

// Webhook dari Midtrans — tidak butuh auth
router.post("/notification", handleNotification);

// Protected routes
router.post("/create", verifyUserToken, createPayment);
router.get("/status/:orderId", verifyUserToken, checkPaymentStatus);

module.exports = router;