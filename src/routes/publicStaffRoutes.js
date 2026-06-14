const express = require("express");
const router = express.Router();
const { getPublicStaff } = require("../controllers/publicStaffController");

router.get("/", getPublicStaff);

module.exports = router;