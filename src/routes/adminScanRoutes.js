const express = require("express");
const router = express.Router();
// Ubah processCode menjadi processScan di sini
const { processScan } = require("../controllers/adminScanController"); 
const { verifyToken } = require("../middleware/authMiddleware");

router.use(verifyToken);

// Gunakan processScan di sini
router.post("/process", processScan); 

module.exports = router;