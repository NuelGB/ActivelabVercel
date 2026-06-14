const express = require("express");
const router = express.Router();
const {
  getSchedules, createSchedule, updateSchedule,
  deleteSchedule, copySchedules,
} = require("../controllers/scheduleController");
const { verifyToken } = require("../middleware/authMiddleware");

router.use(verifyToken);

router.post("/copy", copySchedules);

router.get("/",        getSchedules);
router.post("/",       createSchedule);
router.put("/:id",     updateSchedule);
router.delete("/:id",  deleteSchedule);

module.exports = router;