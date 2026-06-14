const jwt = require("jsonwebtoken");


const verifyUserToken = (req, res, next) => {
  const authHeader = req.headers["authorization"];

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({
      success: false,
      message: "Token tidak ditemukan. Silakan login terlebih dahulu.",
    });
  }

  const token = authHeader.split(" ")[1];

  try {
    const decoded = jwt.verify(token, process.env.USER_JWT_SECRET);


    if (decoded.type !== "user") {
      return res.status(401).json({
        success: false,
        message: "Token tidak valid untuk akses user",
      });
    }

    req.user = decoded; // { id, email, type: 'user' }
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

module.exports = { verifyUserToken };