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

// CONEXÃO MONGODB - DRIVER NATIVO
console.log("=== INICIANDO CONEXÃO MONGODB NATIVA ===");

let client = null;
let db = null;

async function connectMongo() {
  try {
    client = new MongoClient(process.env.MONGODB_URI);
    await client.connect();
    db = client.db(); // Usa o database default
    console.log("✅ MONGODB CONECTADO VIA DRIVER NATIVO!");
    return true;
  } catch (err) {
    console.log("❌ ERRO DRIVER NATIVO:", err.message);
    return false;
  }
}

// Conecta imediatamente
connectMongo();

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

  const { error } = schema.validate(req.body, { abortEarly: false }); // ← CORRIGIDO

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
    console.log(`Novo contato recebido de: ${req.body.email}`);

    res.status(200).json({
      message: "Mensagem enviada com sucesso! Retornaremos em breve.",
      success: true,
    });
  } catch (err) {
    console.error("Erro ao salvar contato:", err);
    res.status(500).json({
      error: "Erro ao processar sua mensagem. Tente novamente mais tarde.",
      success: false,
    });
  }
});

// Rota de health check - VERSÃO NATIVA
app.get("/health", async (req, res) => {
  const isConnected = db ? true : false;
  
  res.status(200).json({ 
    status: "OK", 
    database: isConnected ? "connected" : "disconnected",
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development'
  });
});

// Middleware para rotas não encontradas
app.use("*", (req, res) => {
  res.status(404).json({ error: "Endpoint não encontrado" });
});

// Error handling middleware
app.use((error, req, res, next) => {
  console.error("Erro não tratado:", error);
  res.status(500).json({
    error: "Erro interno do servidor",
    ...(process.env.NODE_ENV === "development" && { details: error.message }),
  });
});

module.exports = app;