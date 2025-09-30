const express = require("express");
const bodyParser = require("body-parser");
const cors = require("cors");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const Joi = require("joi");
const sanitizeHtml = require("sanitize-html");
const { MongoClient } = require('mongodb');
require("dotenv").config(); 

const app = express();
app.set('trust proxy', 1); 

console.log("🚀 BACKEND COM DRIVER MONGODB NATIVO");

// Configurações de Segurança
app.use(
  helmet({
    contentSecurityPolicy: false, 
    crossOriginEmbedderPolicy: false,
  })
);

// Configuração CORS - Atualizada
app.use(cors({
  origin: [
    'https://isothermica.com.br',
    'https://www.isothermica.com.br',
    'https://landing-page-six-delta-69.vercel.app',
    'https://isothermica-backend.vercel.app'
  ],
  credentials: true,
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

app.options('*', cors());

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: "Muitas requisições deste IP, tente novamente mais tarde.",
});
app.use(limiter);

// CONEXÃO MONGODB - COM LOG FORÇADO
console.log("=== INICIANDO CONEXÃO MONGODB NATIVA ===");
console.log("MONGODB_URI:", process.env.MONGODB_URI ? "EXISTE" : "NÃO EXISTE");

let db = null;
let client = null;
let isDbConnected = false;

async function connectMongo() {
  try {
    console.log("🔌 Tentando conectar com MongoDB...");
    client = new MongoClient(process.env.MONGODB_URI);
    
    console.log("⏳ Aguardando conexão...");
    await client.connect();
    
    console.log("📊 Obtendo database...");
    db = client.db();
    isDbConnected = true;
    
    console.log("✅ MONGODB CONECTADO VIA DRIVER NATIVO!");
    
    console.log("🎯 Testando conexão...");
    await db.admin().ping();
    console.log("🎯 CONEXÃO TESTADA E FUNCIONANDO!");
    
    return true;
  } catch (err) {
    console.log("❌ ERRO DRIVER NATIVO:", err.message);
    console.log("🔍 Stack:", err.stack);
    isDbConnected = false;
    return false;
  }
}

// Conecta e loga o resultado
connectMongo().then(success => {
  console.log(success ? "🎉 CONEXÃO INICIADA COM SUCESSO!" : "💥 FALHA NA CONEXÃO!");
});

// Middleware
app.use(bodyParser.urlencoded({ extended: false, limit: "10kb" }));
app.use(bodyParser.json({ limit: "10kb" }));

// Função de sanitização
const sanitizeInput = (data) => {
  if (typeof data === "string") {
    return sanitizeHtml(data, {
      allowedTags: [],
      allowedAttributes: {},
    });
  }
  return data;
};

app.use((req, res, next) => {
  if (req.body) {
    Object.keys(req.body).forEach((key) => {
      req.body[key] = sanitizeInput(req.body[key]);
    });
  }
  next();
});

// Rota para enviar novo contato - VERSÃO NATIVA
app.post("/contact", async (req, res) => {
  const schema = Joi.object({
    name: Joi.string().min(3).max(50).required(),
    email: Joi.string().email().required(),
    phone: Joi.string().allow("").optional(),
    service: Joi.string()
      .valid("isolamento", "isolamento-metalico", "ar-condicionado", "dutos", "outros")
      .required(),
    message: Joi.string().min(10).required(),
  });

  // CORREÇÃO APLICADA: Parêntese correto
  const { error } = schema.validate(req.body, { abortEarly: false });

  if (error) {
    return res.status(400).json({
      error: "Dados inválidos",
      details: error.details.map((detail) => detail.message),
    });
  }

  try {
    if (!db) {
      return res.status(503).json({
        error: "Serviço temporariamente indisponível. Tente novamente.",
        success: false,
      });
    }

    const contatosCollection = db.collection('contatos');
    
    const novoContato = {
      ...req.body,
      ipAddress: req.ip,
      createdAt: new Date(),
      updatedAt: new Date()
    };

    await contatosCollection.insertOne(novoContato);
    console.log(`✅ Novo contato recebido de: ${req.body.email}`);

    res.status(200).json({
      message: "Mensagem enviada com sucesso! Retornaremos em breve.",
      success: true,
    });
  } catch (err) {
    console.error("❌ Erro ao salvar contato:", err);
    res.status(500).json({
      error: "Erro ao processar sua mensagem. Tente novamente mais tarde.",
      success: false,
    });
  }
});

// Rota de health check - VERSÃO NATIVA
app.get("/health", async (req, res) => {
  try {
    let dbStatus = "disconnected";
    
    if (db) {
      try {
        await db.admin().ping();
        dbStatus = "connected";
      } catch (pingError) {
        dbStatus = "ping_failed";
      }
    }
    
    res.status(200).json({ 
      status: "OK", 
      database: dbStatus,
      timestamp: new Date().toISOString(),
      environment: process.env.NODE_ENV || 'development'
    });
  } catch (error) {
    res.status(500).json({ 
      status: "ERROR", 
      database: "error",
      timestamp: new Date().toISOString(),
      error: error.message 
    });
  }
});

// Rota de teste do MongoDB
app.get("/test-mongodb", async (req, res) => {
  try {
    if (!db) {
      return res.status(503).json({ 
        error: "Database não conectado",
        success: false 
      });
    }

    const databases = await db.admin().listDatabases();
    const databaseNames = databases.databases.map(db => db.name);
    
    console.log("📊 Databases disponíveis:", databaseNames);
    
    res.status(200).json({
      success: true,
      databases: databaseNames,
      message: "Conexão MongoDB testada com sucesso"
    });
  } catch (error) {
    console.error("❌ Erro no teste MongoDB:", error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Middleware para rotas não encontradas
app.use("*", (req, res) => {
  res.status(404).json({ error: "Endpoint não encontrado" });
});

// Error handling middleware
app.use((error, req, res, next) => {
  console.error("❌ Erro não tratado:", error);
  res.status(500).json({
    error: "Erro interno do servidor",
    ...(process.env.NODE_ENV === "development" && { details: error.message }),
  });
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('🛑 Recebido SIGTERM, encerrando conexões...');
  if (client) {
    await client.close();
  }
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('🛑 Recebido SIGINT, encerrando conexões...');
  if (client) {
    await client.close();
  }
  process.exit(0);
});

module.exports = app;