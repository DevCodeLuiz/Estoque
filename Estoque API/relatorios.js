const express = require("express");
const path = require("node:path");
const banco = require("./banco");

const router = express.Router();

router.get("/relatorios", (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.sendFile(path.join(__dirname, "relatorios.html"));
});

router.get("/api/relatorios", (req, res, proximo) => {
  try {
    const { inicio, fim } = req.query;

    function dataValida(valor) {
      if (typeof valor !== "string") return false;

      const data = new Date(valor);

      return !Number.isNaN(data.getTime()) &&
        data.toISOString() === valor;
    }

    if (
      !dataValida(inicio) ||
      !dataValida(fim) ||
      new Date(inicio) >= new Date(fim)
    ) {
      return res.status(400).json({
        mensagem: "Informe um período válido."
      });
    }

    const consulta = banco.prepare(`
      SELECT
        h.id,
        h.produto_id,
        h.acao,
        h.antes_json,
        h.depois_json,
        h.criado_em,
        h.motivo,
        u.usuario,
        p.nome AS nome_atual
      FROM historico h
      JOIN usuarios u ON u.id = h.usuario_id
      JOIN produtos p ON p.id = h.produto_id
      WHERE h.acao IN ('entrada', 'saida')
        AND h.criado_em >= ?
        AND h.criado_em < ?
      ORDER BY h.criado_em DESC, h.id DESC
    `);

    const resumo = new Map();
    const movimentacoes = [];
    let totalEntradas = 0;
    let totalSaidas = 0;

    // Consulta todo o período, sem o limite do histórico da tela.
    for (const registro of consulta.iterate(inicio, fim)) {
      const antes = JSON.parse(registro.antes_json);
      const depois = JSON.parse(registro.depois_json);

      const quantidade = Math.abs(
        depois.quantidade - antes.quantidade
      );

      if (!resumo.has(registro.produto_id)) {
        resumo.set(registro.produto_id, {
          produtoId: registro.produto_id,
          nome: registro.nome_atual,
          entradas: 0,
          saidas: 0,
          variacao: 0
        });
      }

      const produto = resumo.get(registro.produto_id);

      if (registro.acao === "entrada") {
        produto.entradas += quantidade;
        totalEntradas += quantidade;
      } else {
        produto.saidas += quantidade;
        totalSaidas += quantidade;
      }

      produto.variacao = produto.entradas - produto.saidas;

      movimentacoes.push({
        id: registro.id,
        produtoId: registro.produto_id,
        produto: depois.nome,
        tipo: registro.acao,
        quantidade,
        saldoApos: depois.quantidade,
        usuario: registro.usuario,
        motivo: registro.motivo,
        data: registro.criado_em
      });
    }

    const produtos = [...resumo.values()].sort(
      (a, b) => a.nome.localeCompare(b.nome, "pt-BR")
    );

    res.setHeader("Cache-Control", "no-store");

    res.json({
      inicio,
      fim,
      totalEntradas,
      totalSaidas,
      totalMovimentacoes: movimentacoes.length,
      produtos,
      movimentacoes
    });
  } catch (erro) {
    proximo(erro);
  }
});

module.exports = router;