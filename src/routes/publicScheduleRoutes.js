const express = require("express");
const router = express.Router();
const { getPublicSchedules } = require("../controllers/publicScheduleController");

router.get("/", getPublicSchedules);

module.exports = router;