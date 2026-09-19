import { Client, GatewayIntentBits, Partials, ActivityType } from 'discord.js';
import { GoogleGenerativeAI } from '@google/generative-ai';
import express from 'express';
import cron from 'node-cron';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';

dotenv.config();

// ==========================================
// VALIDACIÓN DE SEGURIDAD DE CREDENCIALES
// ==========================================
if (!process.env.DISCORD_TOKEN) {
  console.error("[Error Crítico] ¡Falta la variable de entorno DISCORD_TOKEN! Configúrala en Render.");
  process.exit(1);
}

if (!process.env.GEMINI_API_KEY) {
  console.error("[Error Crítico] ¡Falta la variable de entorno GEMINI_API_KEY! Configúrala en Render.");
  process.exit(1);
}

// ==========================================
// CONFIGURACIÓN DEL MODELO "Kbot RevOlution"
// ==========================================
const BOT_CONFIG = {
  modelName: "Kbot Bot model 1.0: RevOlution",
  version: "1.0.0",
  triggers: ["dar", "dare", "darek", "rek"],
  maxHistoryPerUser: 15,
  aiModelsFallback: [
    "gemini-3.8-flash",
    "gemini-3.7-flash",
    "gemini-3.5-flash",
    "gemini-3.5-flash-lite",
    "gemini-3.1-flash-lite",
    "gemini-3-flash-preview",
    "gemini-2.5-pro",
    "gemini-2.5-flash",
    "gemini-2.5-flash-lite"
  ]
};

// Cargar la personalidad desde el archivo personality.txt
let personalityPrompt = "Eres Darek, un bot amigable pero psicópata en el fondo.";
try {
  const txtPath = path.join(process.cwd(), 'personality.txt');
  if (fs.existsSync(txtPath)) {
    personalityPrompt = fs.readFileSync(txtPath, 'utf8');
    console.log("[Sistema] Personalidad cargada exitosamente desde 'personality.txt'.");
  } else {
    console.warn("[Advertencia] No se encontró 'personality.txt', usando personalidad por defecto.");
  }
} catch (error) {
  console.error("[Error] Al leer 'personality.txt':", error.message);
}

// Inicialización de Google Gemini AI
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// Servidor Express para Keep-Alive en Render
const app = express();
const PORT = process.env.PORT || 3000;

app.get('/', (req, res) => {
  res.send(`${BOT_CONFIG.modelName} está activo y ejecutándose.`);
});

app.listen(PORT, () => {
  console.log(`[HTTP] Servidor Web iniciado en el puerto ${PORT}`);
});

// Auto-Ping para Render 24/7 (Plan Gratis)
cron.schedule('*/10 * * * *', async () => {
  if (process.env.RENDER_EXTERNAL_URL) {
    try {
      await fetch(process.env.RENDER_EXTERNAL_URL);
      console.log('[Auto-Ping] Ping enviado a Render para mantener activo el bot.');
    } catch (error) {
      console.error('[Auto-Ping] Error:', error.message);
    }
  }
});

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

// Memoria en vivo
const userHistories = new Map();
const userImportantMemory = new Map();

client.once('ready', () => {
  console.log(`[Discord] Bot conectado como: ${client.user.tag}`);
  console.log(`[Modelo] Modelo cargado: ${BOT_CONFIG.modelName}`);
});

// Función con Fallback automático entre la lista de modelos
async function generateWithFallback(historyForChat, promptContext) {
  let lastError = null;

  for (const modelName of BOT_CONFIG.aiModelsFallback) {
    try {
      const aiModel = genAI.getGenerativeModel({ 
        model: modelName,
        systemInstruction: personalityPrompt
      });

      const chatSession = aiModel.startChat({
        history: historyForChat
      });

      const result = await chatSession.sendMessage(promptContext);
      return result.response.text();
    } catch (error) {
      console.warn(`[Fallback] Modelo ${modelName} no disponible o falló: ${error.message}. Probando siguiente...`);
      lastError = error;
    }
  }

  throw new Error(`Todos los modelos de IA fallaron. Último error: ${lastError?.message}`);
}

client.on('messageCreate', async (message) => {
  if (message.author.bot) return;

  const isDM = !message.guild;
  const contentLower = message.content.toLowerCase();
  
  const isMentioned = message.mentions.has(client.user.id);
  const hasTrigger = BOT_CONFIG.triggers.some(trigger => {
    const regex = new RegExp(`\\b${trigger}\\b`, 'i');
    return regex.test(contentLower);
  });

  if (!isDM && !isMentioned && !hasTrigger) return;

  try {
    await message.channel.sendTyping();

    const userId = message.author.id;
    const author = message.author;
    const member = message.member;

    // Obtener Perfil Completo del Usuario
    const userProfile = {
      id: userId,
      username: author.username,
      globalName: author.globalName || author.username,
      nickname: member ? member.nickname || author.username : author.username,
      avatarURL: author.displayAvatarURL(),
      status: member?.presence?.status || 'desconocido',
      customStatus: member?.presence?.activities.find(a => a.type === 4)?.state || 'Ninguno',
      activities: member?.presence?.activities.map(a => `${a.name} (${a.type})`).join(', ') || 'Ninguna'
    };

    // Recuperar historial previo y memoria
    if (!userHistories.has(userId)) {
      userHistories.set(userId, []);
    }
    const history = userHistories.get(userId);
    const longTermMemory = userImportantMemory.get(userId) || "Ninguna guardada aún.";

    // Construir el Contexto del Mensaje
    const promptContext = `
INFORMACIÓN DEL USUARIO QUE TE HABLA:
- Nombre / Nick: ${userProfile.nickname} (@${userProfile.username})
- Nombre Global: ${userProfile.globalName}
- Estado de Discord: ${userProfile.status}
- Estado Personalizado: ${userProfile.customStatus}
- Actividades en curso: ${userProfile.activities}
- Avatar URL: ${userProfile.avatarURL}

MEMORIA IMPORTANTE A LARGO PLAZO DE ESTE USUARIO:
${longTermMemory}

HISTORIAL DE MENSAJES RECIENTES:
${history.map(h => `${h.role}:${h.text}`).join('\n')}

MENSAJE ACTUAL DEL USUARIO:
${message.content}
`;

    const formattedHistory = history.map(h => ({
      role: h.role === 'model' ? 'model' : 'user',
      parts: [{ text: h.text }]
    }));

    // Ejecutar con Sistema Fallback en cadena
    let fullResponse = await generateWithFallback(formattedHistory, promptContext);
    let replyMessage = fullResponse;

    // Extraer datos de control de estado y memoria
    const stateMatch = fullResponse.match(/<<<BOT_STATE\s*([\s\S]*?)\s*BOT_STATE>>>/);
    if (stateMatch) {
      replyMessage = fullResponse.replace(/<<<BOT_STATE[\s\S]*?BOT_STATE>>>/, '').trim();
      try {
        const botState = JSON.parse(stateMatch[1]);

        // Actualizar Presencia en Discord
        if (botState.status || botState.activityType) {
          const actType = ActivityType[botState.activityType] || ActivityType.Playing;
          client.user.setPresence({
            status: botState.status || 'online',
            activities: [{ name: botState.activityText || 'con tus pensamientos', type: actType }]
          });
        }

        // Actualizar Memoria Importante
        if (botState.importantMemoryUpdate) {
          const currentMem = userImportantMemory.get(userId) || "";
          userImportantMemory.set(userId, `${currentMem} | ${botState.importantMemoryUpdate}`.trim());
        }
      } catch (e) {
        console.error("[State Parser Error]", e.message);
      }
    }

    // Responder en el canal de Discord
    if (replyMessage.length > 0) {
      await message.reply(replyMessage);
    }

    // Actualizar historial local por usuario
    history.push({ role: 'user', text: message.content });
    history.push({ role: 'model', text: replyMessage });

    if (history.length > BOT_CONFIG.maxHistoryPerUser * 2) {
      history.splice(0, 2);
    }

  } catch (error) {
    console.error('[Error Crítico en Darek]:', error);
    await message.reply('*(sonríe amigablemente mientras sus ojos parpadean en rojo)* Ups, mis circuitos colapsaron por un segundo... intenta hablarme de nuevo.');
  }
});

// Inicio de sesión con validación absoluta
console.log("[Sistema] Intentando conectar con Discord...");
client.login(process.env.DISCORD_TOKEN).catch(error => {
  console.error("[Error Crítico de Discord] Falló la autenticación:", error.message);
});
