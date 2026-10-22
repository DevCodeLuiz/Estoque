const { DatabaseSync } = require("node:sqlite");
const path = require("node:path");
const bcrypt = require("bcryptjs");

const banco = new DatabaseSync(
  path.join(__dirname, "estoque.db")
);

banco.exec(`
  PRAGMA foreign_keys = ON;
  PRAGMA journal_mode = WAL;

  CREATE TABLE IF NOT EXISTS usuarios (
    id INTEGER PRIMARY KEY,
    usuario TEXT NOT NULL UNIQUE,
    senha_hash TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS produtos (
    id INTEGER PRIMARY KEY,
    nome TEXT NOT NULL CHECK (length(trim(nome)) > 0),
    categoria TEXT NOT NULL DEFAULT '',
    preco_centavos INTEGER NOT NULL DEFAULT 0
      CHECK (preco_centavos >= 0),
    quantidade INTEGER NOT NULL DEFAULT 0
      CHECK (quantidade >= 0),
    estoque_minimo INTEGER NOT NULL DEFAULT 0
      CHECK (estoque_minimo >= 0),
    arquivado INTEGER NOT NULL DEFAULT 0
      CHECK (arquivado IN (0, 1))
  );

  CREATE TABLE IF NOT EXISTS historico (
    id INTEGER PRIMARY KEY,
    usuario_id INTEGER NOT NULL,
    produto_id INTEGER NOT NULL,
    acao TEXT NOT NULL CHECK (
      acao IN ('cadastro', 'edicao', 'entrada', 'saida', 'ajuste')
    ),
    antes_json TEXT NOT NULL,
    depois_json TEXT NOT NULL,
    motivo TEXT NOT NULL,
    criado_em TEXT NOT NULL DEFAULT (
      strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    ),
    FOREIGN KEY (usuario_id) REFERENCES usuarios(id),
    FOREIGN KEY (produto_id) REFERENCES produtos(id)
  );
`);

// Atualiza bancos antigos sem apagar produtos ou histórico.
const colunas = banco.prepare(
  "PRAGMA table_info(produtos)"
).all();

if (!colunas.some((coluna) => coluna.name === "arquivado")) {
  banco.exec(`
    ALTER TABLE produtos
    ADD COLUMN arquivado INTEGER NOT NULL DEFAULT 0
    CHECK (arquivado IN (0, 1))
  `);
}

banco.exec("BEGIN");

try {
  // Contas locais de demonstração.
  // A senha só é cadastrada se o usuário ainda não existir.
  const contas = [
    {
      usuario: "admin",
      senha: "Estoque@123"
    },
    {
      usuario: "Kaio Melo",
      senha: "Kaio@Estoque2026!"
    }
  ];

  for (const conta of contas) {
    const existente = banco.prepare(`
      SELECT id FROM usuarios WHERE usuario = ?
    `).get(conta.usuario);

    if (!existente) {
      banco.prepare(`
        INSERT INTO usuarios (usuario, senha_hash)
        VALUES (?, ?)
      `).run(
        conta.usuario,
        bcrypt.hashSync(conta.senha, 10)
      );
    }
  }

  const admin = banco.prepare(`
    SELECT id FROM usuarios WHERE usuario = ?
  `).get("admin");

  const exemplos = [
    [1, "Arroz 5 kg", "Alimentos", 2500, 20, 5],
    [2, "Feijão 1 kg", "Alimentos", 850, 15, 5],
    [3, "Refrigerante 2 L", "Bebidas", 1000, 10, 3]
  ];

  for (const exemplo of exemplos) {
    const existente = banco.prepare(`
      SELECT id FROM produtos WHERE id = ?
    `).get(exemplo[0]);

    // Também considera produtos arquivados para não recriá-los.
    if (!existente) {
      banco.prepare(`
        INSERT INTO produtos (
          id,
          nome,
          categoria,
          preco_centavos,
          quantidade,
          estoque_minimo
        )
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(...exemplo);

      const produto = banco.prepare(`
        SELECT * FROM produtos WHERE id = ?
      `).get(exemplo[0]);

      banco.prepare(`
        INSERT INTO historico (
          usuario_id,
          produto_id,
          acao,
          antes_json,
          depois_json,
          motivo
        )
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(
        admin.id,
        produto.id,
        "cadastro",
        JSON.stringify(null),
        JSON.stringify(produto),
        "Cadastro inicial da demonstração"
      );
    }
  }

  banco.exec("COMMIT");
} catch (erro) {
  banco.exec("ROLLBACK");
  banco.close();
  throw erro;
}

module.exports = banco;