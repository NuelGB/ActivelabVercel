const dns = require('dns');
dns.setDefaultResultOrder('ipv4first');

require("dotenv").config();
const express = require("express");

const cors = require("cors");
const helmet = require("helmet");
const path = require("path");
const http = require("http");
const { Server } = require("socket.io");
const pool = require("./config/db");

const branchRoutes = require("./routes/branchRoutes");
const authRoutes = require("./routes/authRoutes");
const profileRoutes = require("./routes/profileRoutes");
const serviceRoutes = require("./routes/serviceRoutes");
const roomRoutes = require("./routes/roomRoutes");
const staffRoutes = require("./routes/staffRoutes");
const membershipRoutes = require("./routes/membershipRoutes");
const scheduleRoutes = require("./routes/scheduleRoutes");
const userRoutes = require("./routes/userRoutes");
const publicBranchRoutes = require("./routes/publicBranchRoutes");
const paymentRoutes = require("./routes/paymentRoutes");
const userMembershipRoutes = require("./routes/userMembershipRoutes");
const publicScheduleRoutes = require("./routes/publicScheduleRoutes");
const bookingRoutes = require("./routes/bookingRoutes");
const adminScanRoutes = require("./routes/adminScanRoutes");
const publicStaffRoutes = require("./routes/publicStaffRoutes");
const chatRoutes = require("./routes/chatRoutes");
const walkinRoutes = require("./routes/walkinRoutes");
const cronRoutes = require("./routes/cronRoutes"); // <-- Tambahan rute cron
const { createNotification } = require("./controllers/notificationController");

const app = express();
const httpServer = http.createServer(app);

// 🌟 PERBAIKAN CORS: Buat daftar semua URL frontend yang diizinkan
const allowedOrigins = [
  "http://localhost:3000",
  "https://activelab-fitness-recovery-5iid.vercel.app",
  "https://activelab-fitness-recovery-5iid-51apqozrn.vercel.app",
  process.env.FRONTEND_URL
].filter(Boolean);

// 🌟 Terapkan daftar origin ke Socket.io
const io = new Server(httpServer, {
  cors: {
    origin: allowedOrigins,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    credentials: true,
  },
});

io.on("connection", (socket) => {
  socket.on("join_session", (sessionId) => {
    socket.join(`session:${sessionId}`);
  });
  socket.on("disconnect", () => {});
});

app.set("io", io);

app.use(
  helmet({
    crossOriginResourcePolicy: false,
  })
);

// 🌟 Terapkan daftar origin ke API Express HTTP
app.use(
  cors({
    origin: function (origin, callback) {
      if (!origin) return callback(null, true);
      
      if (allowedOrigins.indexOf(origin) !== -1) {
        callback(null, true);
      } else {
        callback(new Error("Akses diblokir oleh CORS Policy"));
      }
    },
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    credentials: true,
  })
);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use("/uploads", express.static(path.join(__dirname, "../uploads")));

// --- ROUTES ---
app.use("/api/auth", authRoutes);
app.use("/api/branches", branchRoutes);
app.use("/api/profile", profileRoutes);
app.use("/api/services", serviceRoutes);
app.use("/api/rooms", roomRoutes);
app.use("/api/staff", staffRoutes);
app.use("/api/memberships", membershipRoutes);
app.use("/api/schedules", scheduleRoutes);
app.use("/api/users", userRoutes);
app.use("/api/public/branches", publicBranchRoutes);
app.use("/api/payments", paymentRoutes);
app.use("/api/users/memberships", userMembershipRoutes);
app.use("/api/public/schedules", publicScheduleRoutes);
app.use("/api/bookings", bookingRoutes);
app.use("/api/admin/scan", adminScanRoutes);
app.use("/api/public/staff", publicStaffRoutes);
app.use("/api/chats", chatRoutes);
app.use("/api/admin/walkin", walkinRoutes);
app.use("/api/cron", cronRoutes); // <-- Mendaftarkan rute cron

app.get("/api/health", (req, res) => {
  res.json({
    success: true,
    message: "gymABCD API is running",
    timestamp: new Date().toISOString(),
    env: process.env.NODE_ENV,
  });
});

app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: `Route ${req.method} ${req.originalUrl} tidak ditemukan`,
  });
});

app.use((err, req, res, next) => {
  console.error("Unhandled error:", err);
  res.status(500).json({
    success: false,
    message: "Terjadi kesalahan internal server",
  });
});

const PORT = process.env.PORT || 5000;

// <-- Export app sebagai handler untuk Vercel -->
if (process.env.NODE_ENV !== "production") {
  httpServer.listen(PORT, () => {
    console.log(`🚀 Server berjalan di http://localhost:${PORT}`);
  });
}

module.exports = app;        // Vercel akan import `app` langsung
module.exports.app = app;
module.exports.httpServer = httpServer;