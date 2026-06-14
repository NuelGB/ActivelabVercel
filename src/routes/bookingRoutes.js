const express = require("express");
const router = express.Router();
const {
  createBooking, getUserBookings, getBookingHistory,
  cancelBooking, getBookingById, hideBooking,
  getCheckinCode,   
  getCheckoutCode,  
} = require("../controllers/bookingController");
const { verifyUserToken } = require("../middleware/userAuthMiddleware");

router.use(verifyUserToken);

router.get("/",           getUserBookings);
router.get("/history",    getBookingHistory);
router.get("/:id",        getBookingById);
router.post("/",          createBooking);
router.post("/:id/cancel",     cancelBooking);
router.post("/:id/hide",       hideBooking);
router.get("/:id/checkin-code",  getCheckinCode);
router.get("/:id/checkout-code", getCheckoutCode);

module.exports = router;