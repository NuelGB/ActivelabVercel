const express = require("express");
const router = express.Router();
const { getWalkinList, createWalkin, deleteWalkin } = require("../controllers/walkinController");
const { verifyToken } = require("../middleware/authMiddleware");

router.use(verifyToken);
router.get("/",      getWalkinList);
router.post("/",     createWalkin);
router.delete("/:id", deleteWalkin);

module.exports = router;