const jwt = require("jsonwebtoken");

const verifyToken = (req, res, next) => {
  const authHeader = req.headers["authorization"];

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({
      success: false,
      message: "Token tidak ditemukan. Silakan login terlebih dahulu.",
    });
  }

  const token = authHeader.split(" ")[1];

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.admin = decoded;
    next();
  } catch (err) {
    if (err.name === "TokenExpiredError") {
      return res.status(401).json({
        success: false,
        message: "Sesi Anda telah berakhir. Silakan login kembali.",
      });
    }
    return res.status(401).json({
      success: false,
      message: "Token tidak valid.",
    });
  }
};

const requirePusat = (req, res, next) => {
  if (req.admin.role !== "pusat") {
    return res.status(403).json({
      success: false,
      message: "Akses ditolak. Fitur ini hanya untuk admin pusat.",
    });
  }
  next();
};

module.exports = { verifyToken, requirePusat };