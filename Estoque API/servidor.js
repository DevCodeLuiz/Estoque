const express = require("express");
const session = require("express-session");
const bcrypt = require("bcryptjs");
const crypto = require("node:crypto");
const path = require("node:path");
const banco = require("./banco");

const app = express();

app.use(express.json({ limit: "10kb" }));

// Configuração para a demonstração local.
app.use(session({
  secret: crypto.randomBytes(32).toString("hex"),
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: "lax",
    secure: false,
    maxAge: 60 * 60 * 1000
  }
}));

function exigirLogin(req, res, proximo) {
  if (!req.session.usuarioId) {
    if (req.path.startsWith("/api/") || req.path === "/produtos") {
      return res.status(401).json({
        mensagem: "Faça login para continuar."
      });
    }

    return res.redirect("/login");
  }

  proximo();
}

function buscarProduto(id) {
  return banco.prepare(`
    SELECT * FROM produtos
    WHERE id = ? AND arquivado = 0
  `).get(id);
}

function registrarLog(usuarioId, produtoId, acao, antes, depois, motivo) {
  banco.prepare(`
    INSERT INTO historico (
      usuario_id, produto_id, acao,
      antes_json, depois_json, motivo
    )
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    usuarioId,
    produtoId,
    acao,
    JSON.stringify(antes),
    JSON.stringify(depois),
    motivo
  );
}

function transacao(operacao) {
  banco.exec("BEGIN IMMEDIATE");

  try {
    const resultado = operacao();
    banco.exec("COMMIT");
    return resultado;
  } catch (erro) {
    banco.exec("ROLLBACK");
    throw erro;
  }
}

function motivoValido(motivo) {
  return typeof motivo === "string" &&
    motivo.trim().length >= 3 &&
    motivo.trim().length <= 500;
}

function dadosProdutoValidos(dados) {
  return dados &&
    typeof dados.nome === "string" &&
    dados.nome.trim().length >= 1 &&
    dados.nome.trim().length <= 120 &&
    typeof dados.categoria === "string" &&
    dados.categoria.trim().length <= 80 &&
    Number.isSafeInteger(dados.preco_centavos) &&
    dados.preco_centavos >= 0 &&
    Number.isSafeInteger(dados.estoque_minimo) &&
    dados.estoque_minimo >= 0;
}

// ARQUIVOS PÚBLICOS

app.get("/estilo.css", (req, res) => {
  res.sendFile(path.join(__dirname, "estilo.css"));
});

app.get("/login", (req, res) => {
  res.sendFile(path.join(__dirname, "login.html"));
});

// LOGIN

app.post("/api/login", async (req, res, proximo) => {
  try {
    const { usuario, senha } = req.body || {};

    if (
      typeof usuario !== "string" ||
      typeof senha !== "string" ||
      usuario.length > 100 ||
      senha.length > 200
    ) {
      return res.status(400).json({
        mensagem: "Informe usuário e senha válidos."
      });
    }

    const conta = banco.prepare(`
      SELECT * FROM usuarios WHERE usuario = ?
    `).get(usuario.trim());

    if (!conta || !(await bcrypt.compare(senha, conta.senha_hash))) {
      return res.status(401).json({
        mensagem: "Usuário ou senha incorretos."
      });
    }

    req.session.regenerate((erro) => {
      if (erro) return proximo(erro);

      req.session.usuarioId = conta.id;

      req.session.save((erro) => {
        if (erro) return proximo(erro);
        res.json({ mensagem: "Login realizado!" });
      });
    });
  } catch (erro) {
    proximo(erro);
  }
});

app.post("/api/logout", exigirLogin, (req, res, proximo) => {
  req.session.destroy((erro) => {
    if (erro) return proximo(erro);

    res.clearCookie("connect.sid");
    res.json({ mensagem: "Você saiu do sistema." });
  });
});

// PAINEL

app.get("/", exigirLogin, (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.sendFile(path.join(__dirname, "index.html"));
});

// PRODUTOS

app.get("/produtos", exigirLogin, (req, res) => {
  const produtos = banco.prepare(`
    SELECT * FROM produtos
    WHERE arquivado = 0
    ORDER BY id
  `).all();

  res.setHeader("Cache-Control", "no-store");
  res.json(produtos);
});

app.post("/api/produtos", exigirLogin, (req, res) => {
  const dados = req.body || {};
  const quantidadeInicial = dados.quantidade_inicial;

  if (
    !dadosProdutoValidos(dados) ||
    !Number.isSafeInteger(quantidadeInicial) ||
    quantidadeInicial < 0
  ) {
    return res.status(400).json({
      mensagem: "Confira os campos e a quantidade inicial."
    });
  }

  const produto = transacao(() => {
    const resultado = banco.prepare(`
      INSERT INTO produtos (
        nome, categoria, preco_centavos,
        quantidade, estoque_minimo
      )
      VALUES (?, ?, ?, 0, ?)
    `).run(
      dados.nome.trim(),
      dados.categoria.trim(),
      dados.preco_centavos,
      dados.estoque_minimo
    );

    const id = Number(resultado.lastInsertRowid);
    const cadastrado = buscarProduto(id);

    registrarLog(
      req.session.usuarioId,
      id,
      "cadastro",
      null,
      cadastrado,
      "Cadastro de produto pelo painel"
    );

    if (quantidadeInicial > 0) {
      banco.prepare(`
        UPDATE produtos SET quantidade = ? WHERE id = ?
      `).run(quantidadeInicial, id);

      registrarLog(
        req.session.usuarioId,
        id,
        "entrada",
        cadastrado,
        buscarProduto(id),
        "Estoque inicial informado no cadastro"
      );
    }

    return buscarProduto(id);
  });

  res.status(201).json({
    mensagem: "Produto cadastrado!",
    produto
  });
});

app.patch("/api/produtos/:id", exigirLogin, (req, res) => {
  const id = Number(req.params.id);
  const dados = req.body || {};

  if (
    !Number.isSafeInteger(id) ||
    id <= 0 ||
    !dadosProdutoValidos(dados) ||
    !motivoValido(dados.motivo)
  ) {
    return res.status(400).json({
      mensagem: "Confira os campos e o motivo da alteração."
    });
  }

  const resultado = transacao(() => {
    const antes = buscarProduto(id);

    if (!antes) {
      return {
        status: 404,
        mensagem: "Produto não encontrado ou removido."
      };
    }

    const semAlteracao =
      antes.nome === dados.nome.trim() &&
      antes.categoria === dados.categoria.trim() &&
      antes.preco_centavos === dados.preco_centavos &&
      antes.estoque_minimo === dados.estoque_minimo;

    if (semAlteracao) {
      return {
        status: 200,
        mensagem: "Nenhuma alteração nos dados.",
        produto: antes
      };
    }

    banco.prepare(`
      UPDATE produtos
      SET nome = ?, categoria = ?,
          preco_centavos = ?, estoque_minimo = ?
      WHERE id = ?
    `).run(
      dados.nome.trim(),
      dados.categoria.trim(),
      dados.preco_centavos,
      dados.estoque_minimo,
      id
    );

    const depois = buscarProduto(id);

    registrarLog(
      req.session.usuarioId,
      id,
      "edicao",
      antes,
      depois,
      dados.motivo.trim()
    );

    return {
      status: 200,
      mensagem: "Produto atualizado!",
      produto: depois
    };
  });

  res.status(resultado.status).json(resultado);
});

app.delete("/api/produtos/:id", exigirLogin, (req, res) => {
  const id = Number(req.params.id);
  const { motivo } = req.body || {};

  if (
    !Number.isSafeInteger(id) ||
    id <= 0 ||
    !motivoValido(motivo)
  ) {
    return res.status(400).json({
      mensagem: "Informe um produto válido e o motivo da exclusão."
    });
  }

  const resultado = transacao(() => {
    const antes = buscarProduto(id);

    if (!antes) {
      return {
        status: 404,
        mensagem: "Produto não encontrado ou já removido."
      };
    }

    banco.prepare(`
      UPDATE produtos SET arquivado = 1 WHERE id = ?
    `).run(id);

    const depois = banco.prepare(`
      SELECT * FROM produtos WHERE id = ?
    `).get(id);

    registrarLog(
      req.session.usuarioId,
      id,
      "edicao",
      antes,
      depois,
      `Exclusão do produto da lista: ${motivo.trim()}`
    );

    return {
      status: 200,
      mensagem: "Produto removido. Histórico preservado."
    };
  });

  res.status(resultado.status).json(resultado);
});

// MOVIMENTAÇÕES

app.post("/api/movimentacoes", exigirLogin, (req, res) => {
  const { produtoId, tipo, quantidade, motivo } = req.body || {};

  if (
    !Number.isSafeInteger(produtoId) ||
    produtoId <= 0 ||
    !Number.isSafeInteger(quantidade) ||
    quantidade <= 0 ||
    !["entrada", "saida"].includes(tipo) ||
    !motivoValido(motivo)
  ) {
    return res.status(400).json({
      mensagem: "Confira produto, tipo, quantidade e motivo."
    });
  }

  const resultado = transacao(() => {
    const antes = buscarProduto(produtoId);

    if (!antes) {
      return {
        status: 404,
        mensagem: "Produto não encontrado ou removido."
      };
    }

    const saldo = tipo === "entrada"
      ? antes.quantidade + quantidade
      : antes.quantidade - quantidade;

    if (saldo < 0) {
      return {
        status: 400,
        mensagem: "Estoque insuficiente para essa saída."
      };
    }

    if (!Number.isSafeInteger(saldo)) {
      return {
        status: 400,
        mensagem: "Quantidade acima do limite permitido."
      };
    }

    banco.prepare(`
      UPDATE produtos SET quantidade = ? WHERE id = ?
    `).run(saldo, produtoId);

    const depois = buscarProduto(produtoId);

    registrarLog(
      req.session.usuarioId,
      produtoId,
      tipo,
      antes,
      depois,
      motivo.trim()
    );

    return {
      status: 200,
      mensagem: "Movimentação realizada!",
      produto: depois
    };
  });

  res.status(resultado.status).json(resultado);
});

// HISTÓRICO

app.get("/api/historico", exigirLogin, (req, res) => {
  const registros = banco.prepare(`
    SELECT
      h.id, h.produto_id, u.usuario, h.acao,
      h.antes_json, h.depois_json, h.motivo, h.criado_em
    FROM historico h
    JOIN usuarios u ON u.id = h.usuario_id
    ORDER BY h.id DESC
    LIMIT 100
  `).all();

  res.setHeader("Cache-Control", "no-store");

  res.json(registros.map((registro) => ({
    id: registro.id,
    produtoId: registro.produto_id,
    usuario: registro.usuario,
    acao: registro.acao,
    antes: JSON.parse(registro.antes_json),
    depois: JSON.parse(registro.depois_json),
    motivo: registro.motivo,
    data: registro.criado_em
  })));
});

// RELATÓRIOS
// Protege somente as rotas de relatórios.

const relatorios = require("./relatorios");

app.use(
  ["/relatorios", "/api/relatorios"],
  exigirLogin
);

app.use(relatorios);
// Configurações da conta.
app.use(require("./conta")(exigirLogin));
// ERROS

app.use((req, res) => {
  res.status(404).json({
    mensagem: "Rota não encontrada."
  });
});

app.use((erro, req, res, proximo) => {
  console.error(erro);

  if (erro.type === "entity.parse.failed") {
    return res.status(400).json({
      mensagem: "Os dados enviados não estão em JSON válido."
    });
  }

  if (erro.type === "entity.too.large") {
    return res.status(413).json({
      mensagem: "Os dados enviados ultrapassam o limite permitido."
    });
  }

  res.status(500).json({
    mensagem: "Não foi possível concluir a operação."
  });
});

const porta = process.env.PORT || 3000;

const servidor = app.listen(porta, "0.0.0.0", () => {
  console.log(`Servidor iniciado na porta ${porta}`);
});

servidor.on("error", (erro) => {
  console.error(
    erro.code === "EADDRINUSE"
      ? "Pare o servidor anterior com Ctrl + C."
      : erro.message
  );
});