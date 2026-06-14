// src/utils/uploadToSupabase.js
const { createClient } = require("@supabase/supabase-js");

// Inisialisasi klien Supabase
const supabase = createClient(
  process.env.SUPABASE_URL, 
  process.env.SUPABASE_SERVICE_KEY
);

async function uploadToSupabase(file, folder) {
  // PENGAMAN UTAMA: Jika tidak ada file yang diunggah, langsung kembalikan null
  if (!file || !file.originalname) {
    return null;
  }

  try {
    // Hilangkan spasi pada nama file asli agar URL Supabase aman
    const cleanFileName = file.originalname.replace(/\s+/g, '_');
    const fileName = `${folder}/${Date.now()}_${cleanFileName}`;

    const { error } = await supabase.storage
      .from("activelab-uploads")
      .upload(fileName, file.buffer, { 
        contentType: file.mimetype,
        upsert: false
      });

    if (error) throw error;

    // Ambil URL Publik
    const { data } = supabase.storage
      .from("activelab-uploads")
      .getPublicUrl(fileName);

    return data.publicUrl;
  } catch (error) {
    console.error("Supabase Upload Error:", error.message);
    throw error;
  }
}

module.exports = uploadToSupabase;