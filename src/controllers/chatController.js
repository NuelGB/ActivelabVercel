const pool = require('../config/db');

const getChatThreads = async (req, res) => {
    try {
        const queryText = `
            SELECT 
                u.id, 
                u.name, 
                COALESCE((SELECT message FROM messages WHERE sender_id = u.id OR receiver_id = u.id ORDER BY created_at DESC LIMIT 1), 'Belum ada pesan') as "lastMessage",
                COALESCE((SELECT TO_CHAR(created_at, 'HH24.MI') FROM messages WHERE sender_id = u.id OR receiver_id = u.id ORDER BY created_at DESC LIMIT 1), '00.00') as "updatedAt",
                0 as "unreadCount"
            FROM app_user u 
            WHERE EXISTS (SELECT 1 FROM messages WHERE sender_id = u.id OR receiver_id = u.id)
            ORDER BY "updatedAt" DESC;
        `;
        const result = await pool.query(queryText);
        res.json({ success: true, data: result.rows });
    } catch (err) {
        console.error("Error getChatThreads:", err);
        res.status(500).json({ success: false, message: "Gagal mengambil data thread" });
    }
};

const getMessages = async (req, res) => {
    const { clientId } = req.params;
    const staffId = req.query.staff_id;

    try {
        let queryText;
        let queryParams;

        if (staffId) {
            queryText = `
                SELECT 
                    id,
                    message as text,
                    is_admin as "isAdmin",
                    TO_CHAR(created_at, 'HH24.MI') as timestamp
                FROM messages
                WHERE (sender_id = $1 AND receiver_id = $2) 
                   OR (sender_id = $2 AND receiver_id = $1)
                ORDER BY created_at ASC;
            `;
            queryParams = [clientId, staffId];
        } else {
            queryText = `
                SELECT 
                    id,
                    message as text,
                    is_admin as "isAdmin",
                    TO_CHAR(created_at, 'HH24.MI') as timestamp
                FROM messages
                WHERE sender_id = $1 OR receiver_id = $1
                ORDER BY created_at ASC;
            `;
            queryParams = [clientId];
        }
        const result = await pool.query(queryText, queryParams);
        res.json({ success: true, data: result.rows });
    } catch (err) {
        res.status(500).json({ success: false, message: "Gagal memuat detail pesan" });
    }
};

const sendMessage = async (req, res) => {
    try {
        const clientId = req.body.clientId || req.body.sender_id;
        const isAdmin = req.body.isAdmin !== undefined ? req.body.isAdmin : (req.body.is_admin || false);
        const message = req.body.message;
        const receiverFromFlutter = req.body.receiver_id;

        let finalSenderId = clientId;
        let finalReceiverId = receiverFromFlutter || 0;

        if (isAdmin) {
            finalReceiverId = clientId;
            
            const lastChat = await pool.query(
                `SELECT receiver_id FROM messages WHERE sender_id = $1 AND is_admin = false ORDER BY created_at DESC LIMIT 1`, 
                [clientId]
            );
            
            if (lastChat.rows.length > 0) {
                finalSenderId = lastChat.rows[0].receiver_id; 
            } else {
                finalSenderId = req.body.staffId || 0;
            }
        }

        const queryText = `
            INSERT INTO messages (sender_id, receiver_id, message, is_admin, created_at)
            VALUES ($1, $2, $3, $4, NOW())
            RETURNING id, message as text, is_admin as "isAdmin", TO_CHAR(created_at, 'HH24.MI') as timestamp;
        `;
        
        const result = await pool.query(queryText, [finalSenderId, finalReceiverId, message, isAdmin]);
        res.json({ success: true, data: result.rows[0] });
    } catch (err) {
        res.status(500).json({ success: false, message: "Gagal menyimpan pesan baru" });
    }
};

module.exports = {
    getChatThreads,
    getMessages,
    sendMessage
};