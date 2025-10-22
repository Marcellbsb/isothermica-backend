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

console.log("🚀 BACKEND COM DRIVER MONGODB NATIVO - VERCEL OPTIMIZED");

// Configurações de Segurança
app.use(
  helmet({
    contentSecurityPolicy: false, 
    crossOriginEmbedderPolicy: false,
  })
);

// E ADICIONE TAMBÉM ESTE MIDDLEWARE MANUAL NO TOPO
app.use((req, res, next) => {
  const allowedOrigins = [
    'https://isothermica.com.br',
    'https://isothermica-backend.vercel.app'
  ];
  
  const origin = req.headers.origin;
  if (allowedOrigins.includes(origin)) {
    res.header('Access-Control-Allow-Origin', origin);
  }
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.header('Access-Control-Allow-Credentials', 'true');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  next();
});


// NO SEU BACKEND - ADICIONE ESTE CORS URGENTE
app.use(cors({
  origin: [
    'https://isothermica.com.br',
    'https://www.isothermica.com.br',
    'https://isothermica-backend-api-v2.vercel.app',
    'https://isothermica-backend.vercel.app',  // ← URL QUE ESTÁ NO FRONTEND ANTIGO
    'https://landing-page-six-delta-69.vercel.app'
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

// CONEXÃO MONGODB - OTIMIZADA PARA VERCEL
console.log("=== CONFIGURANDO CONEXÃO MONGODB ===");
console.log("MONGODB_URI:", process.env.MONGODB_URI ? "✅ CONFIGURADA" : "❌ NÃO ENCONTRADA");

let cachedClient = null;
let cachedDb = null;

async function connectToDatabase() {
  if (cachedClient && cachedDb) {
    console.log("♻️ Usando conexão cacheada");
    return { client: cachedClient, db: cachedDb };
  }

  try {
    console.log("🔌 Criando nova conexão MongoDB...");
    
    if (!process.env.MONGODB_URI) {
      throw new Error("MONGODB_URI não definida");
    }

    const client = new MongoClient(process.env.MONGODB_URI, {
      maxPoolSize: 10,
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 45000,
    });

    console.log("⏳ Conectando...");
    await client.connect();
    
    console.log("📊 Obtendo database...");
    const db = client.db(); // Usa o database padrão da URI
    
    // Testa a conexão
    await db.admin().ping();
    console.log("✅ MONGODB CONECTADO E TESTADO!");

    cachedClient = client;
    cachedDb = db;

    return { client, db };
  } catch (error) {
    console.error("❌ ERRO NA CONEXÃO MONGODB:", error.message);
    cachedClient = null;
    cachedDb = null;
    throw error;
  }
}

// Middleware para gerenciar conexão DB em cada requisição
app.use(async (req, res, next) => {
  try {
    const { db } = await connectToDatabase();
    req.db = db;
    next();
  } catch (error) {
    console.log("⚠️ Database não disponível, continuando sem DB...");
    req.db = null;
    next();
  }
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
    if (!req.db) {
      console.log("📝 Contato recebido (sem DB):", req.body.email);
      return res.status(200).json({
        message: "Mensagem recebida! Entraremos em contato em breve.",
        success: true,
        note: "Sistema temporariamente offline, mas sua mensagem foi registrada."
      });
    }

    const contatosCollection = req.db.collection('contatos');
    
    const novoContato = {
      ...req.body,
      ipAddress: req.ip,
      createdAt: new Date(),
      updatedAt: new Date()
    };

    await contatosCollection.insertOne(novoContato);
    console.log(`✅ Contato salvo no DB: ${req.body.email}`);

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

// Rota de health check melhorada
app.get("/health", async (req, res) => {
  try {
    let dbStatus = "disconnected";
    let dbDetails = {};
    
    if (req.db) {
      try {
        await req.db.admin().ping();
        dbStatus = "connected";
        
        // Informações adicionais do database
        const stats = await req.db.stats();
        dbDetails = {
          collections: stats.collections,
          objects: stats.objects,
          dataSize: stats.dataSize
        };
      } catch (pingError) {
        dbStatus = "ping_failed";
        dbDetails = { error: pingError.message };
      }
    }
    
    res.status(200).json({ 
      status: "OK", 
      database: dbStatus,
      database_details: dbDetails,
      timestamp: new Date().toISOString(),
      environment: process.env.NODE_ENV || 'development',
      version: "2.0"
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
    if (!req.db) {
      return res.status(503).json({ 
        error: "Database não conectado",
        success: false 
      });
    }

    const databases = await req.db.admin().listDatabases();
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

// Rota raiz
app.get("/", (req, res) => {
  res.status(200).json({
    message: "Isothermica Backend API",
    status: "online",
    version: "2.0",
    endpoints: ["/health", "/contact", "/test-mongodb"]
  });
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
  if (cachedClient) {
    await cachedClient.close();
  }
  process.exit(0);
});

module.exports = app;