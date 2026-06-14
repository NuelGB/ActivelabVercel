const express = require("express");
const router = express.Router();
const {
  getUserMemberships,
  freezeMembership,
  unfreezeMembership,
  getUpgradeOptions,
  getDowngradeOptions,
  downgradeMembership,
  cancelMembership,
} = require("../controllers/userMembershipController");
const { verifyUserToken } = require("../middleware/userAuthMiddleware");

router.use(verifyUserToken);

router.get("/", getUserMemberships);
router.post("/:id/freeze", freezeMembership);
router.post("/:id/unfreeze", unfreezeMembership);
router.get("/:id/upgrade-options", getUpgradeOptions);
router.get("/:id/downgrade-options", getDowngradeOptions);
router.post("/:id/downgrade", downgradeMembership);
router.post("/:id/cancel", cancelMembership);

module.exports = router;