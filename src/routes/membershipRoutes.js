const express = require("express");
const router = express.Router();
const {
  getAllMemberships,
  createMembership,
  updateMembership,
  deleteMembership,
} = require("../controllers/membershipController");
const { verifyToken } = require("../middleware/authMiddleware");

router.use(verifyToken);

router.get("/",      getAllMemberships);
router.post("/",     createMembership);
router.put("/:id",   updateMembership);
router.delete("/:id", deleteMembership);

module.exports = router;