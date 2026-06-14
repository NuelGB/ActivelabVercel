const express = require("express");
const router = express.Router();
const { getBranches, getBranchDetail } = require("../controllers/publicBranchController");

router.get("/", getBranches);
router.get("/:id", getBranchDetail);

module.exports = router;