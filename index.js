import { Client, GatewayIntentBits, Partials, ActivityType } from 'discord.js';
import { GoogleGenerativeAI } from '@google/generative-ai';
import express from 'express';
import cron from 'node-cron';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';

dotenv.config();

// Servidor Express prioritario para Render
const app = express();
const PORT = process.env.PORT || 3000;

app.get('/', (req, res) => {
  res.send("Darek Bot está activo y en línea.");
});

app.listen(PORT, () => {
  console.log(`[HTTP] Servidor Web iniciado en el puerto ${PORT}`);
});

// Auto-Ping para Render
cron.schedule('*/10 * * * *', async () => {
  if (process.env.RENDER_EXTERNAL_URL) {
    try {
      await fetch(process.env.RENDER_EXTERNAL_URL);
      console.log('[Auto-Ping] Ping enviado a Render.');
    } catch (error) {
      console.error('[Auto-Ping] Error:', error.message);
    }
  }
});

// Cargar Personalidad
let personalityPrompt = "Eres Darek, un bot amigable pero psicópata en el fondo.";
try {
  const txtPath = path.join(process.cwd(), 'personality.txt');
  if (fs.existsSync(txtPath)) {
    personalityPrompt = fs.readFileSync(txtPath, 'utf8');
    console.log("[Sistema] Personalidad cargada exitosamente.");
  }
} catch (error) {
  console.error("[Error] Al leer 'personality.txt':", error.message);
}

// Inicializar IA
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// Cliente de Discord
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildPresences,
    GatewayIntentBits.GuildMembers
  ],
  partials: [Partials.Channel, Partials.Message]
});

const userHistories = new Map();
const userImportantMemory = new Map();

client.once('ready', () => {
  console.log(`[Discord] ¡Bot conectado exitosamente como ${client.user.tag}!`);
});

client.on('messageCreate', async (message) => {
  if (message.author.bot) return;

  const isDM = !message.guild;
  const contentLower = message.content.toLowerCase();
  const isMentioned = message.mentions.has(client.user.id);
  const triggers = ["dar", "dare", "darek", "rek"];
  const hasTrigger = triggers.some(t => new RegExp(`\\b${t}\\b`, 'i').test(contentLower));

  if (!isDM && !isMentioned && !hasTrigger) return;

  try {
    await message.channel.sendTyping();
    const userId = message.author.id;
    
    if (!userHistories.has(userId)) userHistories.set(userId, []);
    const history = userHistories.get(userId);
    const longTermMemory = userImportantMemory.get(userId) || "Ninguna";

    const promptContext = `
INFORMACIÓN DEL USUARIO: ${message.author.username}
MEMORIA: ${longTermMemory}
MENSAJE: ${message.content}
`;

    const aiModel = genAI.getGenerativeModel({ 
      model: "gemini-2.5-flash",
      systemInstruction: personalityPrompt
    });

    const chatSession = aiModel.startChat({
      history: history.map(h => ({ role: h.role, parts: [{ text: h.text }] }))
    });

    const result = await chatSession.sendMessage(promptContext);
    let fullResponse = result.response.text();
    let replyMessage = fullResponse;

    const stateMatch = fullResponse.match(/<<<BOT_STATE\s*([\s\S]*?)\s*BOT_STATE>>>/);
    if (stateMatch) {
      replyMessage = fullResponse.replace(/<<<BOT_STATE[\s\S]*?BOT_STATE>>>/, '').trim();
      try {
        const botState = JSON.parse(stateMatch[1]);
        if (botState.status) {
          client.user.setPresence({ status: botState.status, activities: [{ name: botState.activityText || 'observando', type: ActivityType.Playing }] });
        }
        if (botState.importantMemoryUpdate) {
          userImportantMemory.set(userId, `${longTermMemory} | ${botState.importantMemoryUpdate}`);
        }
      } catch (e) {}
    }

    if (replyMessage) {
      await message.reply(replyMessage);
    }

    history.push({ role: 'user', text: message.content });
    history.push({ role: 'model', text: replyMessage });
    if (history.length > 20) history.splice(0, 2);

  } catch (error) {
    console.error('[Error en mensaje]:', error);
    await message.reply('*(sonríe levemente)* Mis circuitos fallaron un segundo...');
  }
});

// Conexión obligatoria
if (!process.env.DISCORD_TOKEN) {
  console.error("[Fatal] Falta el DISCORD_TOKEN en las variables de entorno.");
  process.exit(1);
}

console.log("[Discord] Iniciando sesión...");
client.login(process.env.DISCORD_TOKEN).catch(err => {
  console.error("[Discord Error Crítico]:", err);
});
