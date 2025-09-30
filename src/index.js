const express = require("express");
const mongoose = require("mongoose");
const bodyParser = require("body-parser");
const cors = require("cors");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const Joi = require("joi");
const sanitizeHtml = require("sanitize-html");
require("dotenv").config(); 

const app = express();
app.set('trust proxy', 1); 

// DEBUG: Verificar a string de conexão (REMOVER DEPOIS)
console.log("=== DEBUG MONGODB ===");
console.log("MONGODB_URI existe?", !!process.env.MONGODB_URI);
console.log("MONGODB_URI length:", process.env.MONGODB_URI ? process.env.MONGODB_URI.length : 0);
console.log("MONGODB_URI starts with:", process.env.MONGODB_URI ? process.env.MONGODB_URI.substring(0, 20) + "..." : "null");
console.log("=== FIM DEBUG ===");

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

// Middleware para aceitar requests OPTIONS (preflight) - MELHORADO
app.options('*', cors());

// Rate limiting - máximo de 100 requisições por 15 minutos
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: "Muitas requisições deste IP, tente novamente mais tarde.",
});
app.use(limiter);

// CONEXÃO MONGODB OTIMIZADA PARA VERCEL
console.log("Iniciando conexão com MongoDB...");

mongoose.connect(process.env.MONGODB_URI, {
  serverSelectionTimeoutMS: 5000,
  socketTimeoutMS: 30000,
  maxPoolSize: 10, // Otimizado para serverless
  minPoolSize: 1,
})
.then(() => {
  console.log("Conectado ao MongoDB com sucesso!");
})
.catch((err) => {
  console.error("ERRO MongoDB:", err.message);
  // Não usa process.exit() em ambiente serverless
});

// Esquema p/ corresponder ao formulário HTML
const contatoSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      minlength: 3,
      maxlength: 50,
      trim: true,
    },
    email: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
    },
    phone: {
      type: String,
      trim: true,
    },
    service: {
      type: String,
      required: true,
      enum: ["isolamento", "isolamento-metalico", "ar-condicionado", "dutos", "outros"],
    },
    message: {
      type: String,
      required: true,
      minlength: 10,
      trim: true,
    },
    ipAddress: {
      type: String,
      required: false,
    },
  },
  { timestamps: true }
);

const Contato = mongoose.model("Contato", contatoSchema);

// Middleware
app.use(bodyParser.urlencoded({ extended: false, limit: "10kb" }));
app.use(bodyParser.json({ limit: "10kb" }));

// Função de sanitização contra XSS
const sanitizeInput = (data) => {
  if (typeof data === "string") {
    return sanitizeHtml(data, {
      allowedTags: [],
      allowedAttributes: {},
    });
  }
  return data;
};

// Middleware de sanitização
app.use((req, res, next) => {
  if (req.body) {
    Object.keys(req.body).forEach((key) => {
      req.body[key] = sanitizeInput(req.body[key]);
    });
  }
  next();
});

// Rota para buscar todos os contatos
app.get("/contacts", async (req, res) => {
  if (process.env.NODE_ENV === "production" && !req.get("X-API-Key")) {
    return res.status(401).json({ error: "Acesso não autorizado" });
  }

  try {
    const contacts = await Contato.find().sort({ createdAt: -1 });
    res.json(contacts);
  } catch (error) {
    console.error("Erro ao buscar contatos:", error);
    res.status(500).json({ error: "Ocorreu um erro ao buscar os contatos." });
  }
});

// Rota para enviar novo contato
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

  const { error } = schema.validate(req.body, { abortEarly: false });

  if (error) {
    return res.status(400).json({
      error: "Dados inválidos",
      details: error.details.map((detail) => detail.message),
    });
  }

  try {
    // Verifica se a conexão com MongoDB está ok
    if (mongoose.connection.readyState !== 1) {
      return res.status(503).json({
        error: "Serviço temporariamente indisponível. Tente novamente.",
        success: false,
      });
    }

    const novoContato = new Contato({
      ...req.body,
      ipAddress: req.ip,
    });

    await novoContato.save();
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

// Rota de health check
app.get("/health", async (req, res) => {
  const dbStatus = mongoose.connection.readyState === 1 ? "connected" : "disconnected";
  
  res.status(200).json({ 
    status: "OK", 
    database: dbStatus,
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

// Export para Vercel Serverless Functions - VERSÃO SIMPLIFICADA
module.exports = app;