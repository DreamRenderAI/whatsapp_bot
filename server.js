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
const Cerebras = require('@cerebras/cerebras_cloud_sdk');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, 'public')));

app.listen(PORT, () => {
    console.log(`🌐 Web server running at http://localhost:${PORT}`);
});

// Load forbidden words from no.txt (comma-separated line) into a Set for fast lookup
const forbiddenWords = new Set(
    fs.readFileSync(path.join(__dirname, 'no.txt'), 'utf-8')
      .split(',')
      .map(w => w.trim().toLowerCase())
      .filter(Boolean)
);

// Initialize Cerebras client
const cerebras = new Cerebras({
    apiKey: 'csk-cfcxp2xtr9f8fdhj6pd8t44pp3y84vrrm6jtnvm3hy88px8j'
});

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

        if (text === '/help') {
            await sock.sendMessage(jid, {
                text: `יצירת תמונות דרך וואצאפ
💠 By Omer AI

פקודות:
/help - מראה את ההודעה הזאת
/gen {טקסט} - יוצר תמונה לפי הטקסט
/gen random - יוצר תמונה רנדומלית
/bixx {טקסט} - משוחח עם Bixx, עוזר ה-AI של Omer AI`
            });
            return;
        }

        if (text === '/gen') {
            await sock.sendMessage(jid, { text: 'ספק טקסט אחרי הפקודה' });
            return;
        }

        if (text === '/bixx') {
            await sock.sendMessage(jid, { text: 'ספק טקסט אחרי הפקודה' });
            return;
        }

        if (text.startsWith('/bixx ')) {
            const prompt = text.slice(6).trim();
            if (!prompt) {
                await sock.sendMessage(jid, { text: 'ספק טקסט אחרי הפקודה' });
                return;
            }

            // Check for forbidden words in prompt (case-insensitive)
            const promptWords = prompt.toLowerCase().split(/\W+/);
            const containsForbidden = promptWords.some(word => forbiddenWords.has(word));

            if (containsForbidden) {
                await sock.sendMessage(jid, { text: 'השתמשת במילה אסורה' });
                return;
            }

            try {
                const stream = await cerebras.chat.completions.create({
                    messages: [
                        {
                            role: 'system',
                            content: 'You are Bixx, from the company Omer AI. Give short, friendly responses.'
                        },
                        {
                            role: 'user',
                            content: prompt
                        }
                    ],
                    model: 'llama-3.3-70b',
                    stream: true,
                    max_completion_tokens: 2048,
                    temperature: 0.2,
                    top_p: 1
                });

                let responseText = '';
                for await (const chunk of stream) {
                    responseText += chunk.choices[0]?.delta?.content || '';
                }

                await sock.sendMessage(jid, { text: responseText || '⚠️ No response from Bixx.' });
            } catch (err) {
                console.error('❌ Bixx Error:', err.message);
                await sock.sendMessage(jid, { text: '⚠️ Could not process Bixx request.' });
            }
            return;
        }

        if (text.startsWith('/gen ')) {
            let prompt = text.slice(5).trim();
            if (!prompt) {
                await sock.sendMessage(jid, { text: 'ספק טקסט אחרי הפקודה' });
                return;
            }

            // Check for forbidden words in prompt (case-insensitive)
            const promptWords = prompt.toLowerCase().split(/\W+/);
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

            await sock.sendMessage(jid, { text: `מתחיל ליצור תמונה: ${prompt}\nלוקח בדרך כלל 5-6 שניות.` });

            try {
                const seed = Math.floor(Math.random() * 1000000000) + 1;
                const startTime = Date.now();
                const imageUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?nologo=true&seed=${seed}`;
                const res = await axios.get(imageUrl, { responseType: 'arraybuffer' });
                const buffer = Buffer.from(res.data);
                const mediaType = mime.lookup(imageUrl) || 'image/png';
                const generationTime = ((Date.now() - startTime) / 1000).toFixed(2);

                await sock.sendMessage(jid, {
                    image: buffer,
                    mimetype: mediaType,
                    caption: `prompt: ${prompt}\nSeed: ${seed}\nGenerated in: ${generationTime} seconds`
                });
            } catch (err) {
                console.error('❌ Error:', err.message);
                await sock.sendMessage(jid, { text: '⚠️ Could not generate image.' });
            }
            return;
        }
    });
}

startBot();
