const express = require("express");
const router = express.Router();
const {
  getAllServices,
  createServiceType, updateServiceType, deleteServiceType,
  createServiceName, updateServiceName, deleteServiceName,
} = require("../controllers/serviceController");
const { verifyToken } = require("../middleware/authMiddleware");

router.use(verifyToken);

// Service Type
router.get("/",                    getAllServices);
router.post("/types",              createServiceType);
router.put("/types/:id",           updateServiceType);
router.delete("/types/:id",        deleteServiceType);

// Service Name
router.post("/types/:typeId/names", createServiceName);
router.put("/names/:id",            updateServiceName);
router.delete("/names/:id",         deleteServiceName);

module.exports = router;