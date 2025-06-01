const {
    makeWASocket,
    useMultiFileAuthState,
    fetchLatestBaileysVersion,
    DisconnectReason
} = require('@whiskeysockets/baileys');

const axios = require('axios');
const mime = require('mime-types');
const fs = require('fs');
const qrcode = require('qrcode-terminal');

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
        const jid = msg.key.remoteJid;
        const isSelf = jid.endsWith('@s.whatsapp.net') && msg.key.fromMe; // Your own number

        if (!msg.message || (!isSelf && msg.key.fromMe)) return;

        const text = msg.message.conversation || msg.message.extendedTextMessage?.text || '';
        if (!text.startsWith('/gen')) return;

        const prompt = text.slice(5).trim();

        if (prompt.length === 0) {
            const helpText = `*יצירת תמונות דרך וואצאפ*\n💠 By Omer AI\n\n*פקודות:*\n/gen - מראה את ההודעה הזאת\n/gen {טקסט} - יוצר תמונה לפי הטקסט\n/gen רנדומלי - יוצר תמונה רנדומלית`;
            await sock.sendMessage(jid, { text: helpText });
            return;
        }

        const finalPrompt = (prompt === 'רנדומלי')
            ? ['cat in space', 'cyberpunk elephant', 'robot eating pizza', 'desert city at dusk', 'matrix waterfall'][Math.floor(Math.random() * 5)]
            : prompt;

        try {
            const imageUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent(finalPrompt)}?nologo=true`;
            const res = await axios.get(imageUrl, { responseType: 'arraybuffer' });
            const buffer = Buffer.from(res.data);
            const mediaType = mime.lookup(imageUrl) || 'image/png';

            await sock.sendMessage(jid, {
                image: buffer,
                mimetype: mediaType,
                caption: `הינה התמונה שלך \n *${finalPrompt}*`
            });
        } catch (err) {
            console.error('❌ Error:', err.message);
            await sock.sendMessage(jid, { text: '⚠️ Could not generate image.' });
        }
    });

}

startBot();
