const express = require("express");
const router = express.Router();
const {
  getAllRooms, createRoomType, updateRoomType, deleteRoomType,
  createRoomName, updateRoomName, deleteRoomName,
  addEquipment, deleteEquipment, getEquipment,
} = require("../controllers/roomController");
const { verifyToken } = require("../middleware/authMiddleware");





router.use(verifyToken);

// Room Type
router.get("/",                   getAllRooms);
router.post("/types",             createRoomType);
router.put("/types/:id",          updateRoomType);
router.delete("/types/:id",       deleteRoomType);

// Room Name
router.post("/types/:typeId/rooms", createRoomName);
router.put("/rooms/:id",            updateRoomName);
router.delete("/rooms/:id",         deleteRoomName);

router.get("/rooms/:id/equipment",          getEquipment);
router.post("/rooms/:id/equipment",         addEquipment);
router.delete("/equipment/:equipmentId",    deleteEquipment);

module.exports = router;