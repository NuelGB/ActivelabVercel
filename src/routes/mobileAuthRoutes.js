const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../config/db'); 
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const router = express.Router();

// ─── SETUP FOLDER UPLOAD OTOMATIS ───
const uploadDir = 'uploads/';
if (!fs.existsSync(uploadDir)){
    fs.mkdirSync(uploadDir);
}

// ─── SETUP MULTER ───
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, 'uploads/');
  },
  filename: function (req, file, cb) {
    cb(null, Date.now() + '-' + file.originalname.replace(/\s+/g, '-')); 
  }
});
const upload = multer({ storage: storage });


// ─── 1. REGISTER USER BARU (TERMASUK FOTO) ───
router.post('/register', upload.single('image'), async (req, res) => {
  const { name, email, password, phone, gender } = req.body; 
  const imagePath = req.file ? `/uploads/${req.file.filename}` : null;

  try {
    const hashedPassword = await bcrypt.hash(password, 10);
    const result = await db.query(
      `INSERT INTO users (name, email, password, phone, gender, image) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, name, email`,
      [name, email.toLowerCase(), hashedPassword, phone, gender, imagePath]
    );
    res.status(201).json({ success: true, data: result.rows[0], message: "Registrasi sukses!" });
  } catch (err) {
    console.error(err);
    if (err.code === '23505') {
      return res.status(409).json({ success: false, message: 'DUPLICATE_DATA' });
    }
    res.status(500).json({ success: false, message: 'SERVER_ERROR' });
  }
});


// ─── 2. UPDATE FOTO PROFIL (UNTUK EDIT NANTI) ───
router.post('/update-photo', upload.single('image'), async (req, res) => {
  const { email } = req.body;
  const imagePath = req.file ? `/uploads/${req.file.filename}` : null;

  if (!imagePath) {
    return res.status(400).json({ success: false, message: "Tidak ada gambar yang diunggah" });
  }

  try {
    await db.query(`UPDATE users SET image = $1 WHERE email = $2`, [imagePath, email.toLowerCase()]);
    res.status(200).json({ success: true, image: imagePath, message: "Foto berhasil diupdate!" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'SERVER_ERROR' });
  }
});


// ─── 3. UPDATE INTERESTS (YANG TADI SEMPAT HILANG) ───
router.post('/update-interests', async (req, res) => {
  const { email, interests } = req.body;
  try {
    await db.query(
      `UPDATE users SET interests = $1 WHERE email = $2`,
      [interests, email.toLowerCase()]
    );
    res.status(200).json({ success: true, message: "Interests berhasil disimpan!" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Terjadi kesalahan server.' });
  }
});


// ─── 4. LOGIN USER ───
router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  try {
    const result = await db.query(`SELECT * FROM users WHERE email = $1`, [email.toLowerCase()]);
    
    if (result.rows.length === 0) {
      return res.status(401).json({ success: false, message: 'Email tidak ditemukan.' });
    }

    const user = result.rows[0];
    const isMatch = await bcrypt.compare(password, user.password);
    
    if (!isMatch) {
      return res.status(401).json({ success: false, message: 'Password salah!' });
    }

    const token = jwt.sign(
      { id: user.id, role: 'user' }, 
      process.env.JWT_SECRET || 'rahasiasuper123', 
      { expiresIn: '30d' }
    );

    res.status(200).json({ 
      success: true, 
      token, 
      user: { 
        id: user.id, 
        name: user.name, 
        email: user.email,
        phone: user.phone,
        gender: user.gender,
        image: user.image,
        interests: user.interests
      } 
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Terjadi kesalahan server.' });
  }
});

module.exports = router;