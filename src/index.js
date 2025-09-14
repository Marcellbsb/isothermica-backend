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
const port = process.env.PORT || 5004;

// Configurações de Segurança
app.use(
  helmet({
    contentSecurityPolicy: false, 
    crossOriginEmbedderPolicy: false,
  })
);

// Configuração CORS
app.use(
  cors({
    origin: "http://127.0.0.1:5501", // Use a URL exata do seu Live Server
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With"],
  })
);

// Middleware para aceitar requests OPTIONS (preflight)
app.options("*", cors());

// Rate limiting - máximo de 100 requisições por 15 minutos
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutos
  max: 100, // limite por IP
  message: "Muitas requisições deste IP, tente novamente mais tarde.",
});
app.use(limiter);

// Conexão segura com MongoDB usando variáveis de ambiente
const mongoURI =
  process.env.MONGODB_URI ||
  "mongodb+srv://cecelcecel415:Dayane1997@isothermica-contacts.gjushky.mongodb.net/?retryWrites=true&w=majority&appName=Isothermica-Contacts";

mongoose
  .connect(mongoURI)
  .then(() => console.log("Conectado ao MongoDB"))
  .catch((err) => console.error("Erro ao conectar ao MongoDB:", err));

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
      enum: ["isolamento", "caldeiraria", "ar-condicionado", "dutos", "outros"],
    },
    message: {
      type: String,
      required: true,
      minlength: 10,
      trim: true,
    },
    ipAddress: {
      // Para logging e segurança
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

// Rota para buscar todos os contatos - PROTEÇÃO ADICIONAL 
app.get("/contacts", async (req, res) => {
  // Em produção, adicionar autenticação/autorização
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
      .valid("isolamento", "caldeiraria", "ar-condicionado", "dutos", "outros")
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
    const novoContato = new Contato({
      ...req.body,
      ipAddress: req.ip, // Registrar IP para segurança
    });

    await novoContato.save();

    // Log seguro (sem dados sensíveis)
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
app.get("/health", (req, res) => {
  res.status(200).json({ status: "OK", timestamp: new Date().toISOString() });
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

app.listen(port, () => {
  console.log(`Servidor rodando na porta ${port}`);
  console.log(`Ambiente: ${process.env.NODE_ENV || "development"}`);
});
