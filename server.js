const express = require('express');
const path = require('path');
const fs = require('fs');
const {
    makeWASocket,
    useMultiFileAuthState,
    fetchLatestBaileysVersion,
    DisconnectReason
} = require('@whiskeysockets/baileys');
const axios = require('axios');
const mime = require('mime-types');
const qrcode = require('qrcode-terminal');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, 'public')));

app.listen(PORT, () => {
    console.log(`🌐 Web server running at http://localhost:${PORT}`);
});

// Load forbidden words from no.txt into a Set for fast lookup
const forbiddenWords = new Set(
    fs.readFileSync(path.join(__dirname, 'no.txt'), 'utf-8')
      .split(/\r?\n/)
      .map(w => w.trim().toLowerCase())
      .filter(Boolean)
);

async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_session');
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
        version,
        auth: state,
        printQRInTerminal: false
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
            console.log('📱 Scan this QR code to connect:');
            qrcode.generate(qr, { small: true });
        }

        if (connection === 'close') {
            const shouldReconnect =
                lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
            console.log('❌ Connection closed. Reconnecting:', shouldReconnect);
            if (shouldReconnect) startBot();
        } else if (connection === 'open') {
            console.log('✅ Bot connected and ready.');
        }
    });

    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return;

        const msg = messages[0];
        if (!msg.message) return;

        const text = msg.message.conversation || msg.message.extendedTextMessage?.text || '';
        const jid = msg.key.remoteJid;

        if (text === '/gen') {
            await sock.sendMessage(jid, {
                text: `יצירת תמונות דרך וואצאפ
💠 By Omer AI

פקודות:
/gen - מראה את ההודעה הזאת
/gen {טקסט} - יוצר תמונה לפי הטקסט
/gen random - יוצר תמונה רנדומלית`
            });
            return;
        }

        if (!text.startsWith('/gen ')) return;

        let prompt = text.slice(5).trim();
        if (!prompt) return;

        // Check for forbidden words in prompt (case-insensitive)
        const promptWords = prompt.toLowerCase().split(/\s+/);
        const containsForbidden = promptWords.some(word => forbiddenWords.has(word));

        if (containsForbidden) {
            await sock.sendMessage(jid, { text: 'השתמשת במילה אסורה' });
            return;
        }

        // Handle random prompt
        if (prompt.toLowerCase() === 'random') {
            const randomPrompts = [
                'sunset over mountains',
                'futuristic cityscape',
                'cute puppy playing',
                'mystical forest',
                'robot painting a portrait',
                'space nebula with stars',
                'vintage car on a road',
                'fantasy dragon flying'
            ];
            prompt = randomPrompts[Math.floor(Math.random() * randomPrompts.length)];
        }

        try {
            const imageUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?nologo=true`;
            const res = await axios.get(imageUrl, { responseType: 'arraybuffer' });
            const buffer = Buffer.from(res.data);
            const mediaType = mime.lookup(imageUrl) || 'image/png';

            await sock.sendMessage(jid, {
                image: buffer,
                mimetype: mediaType,
                caption: `🧠 Prompt: *${prompt}*`
            });
        } catch (err) {
            console.error('❌ Error:', err.message);
            await sock.sendMessage(jid, { text: '⚠️ Could not generate image.' });
        }
    });
}

startBot();
