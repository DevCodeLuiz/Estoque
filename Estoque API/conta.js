const express = require("express");
const path = require("node:path");
const bcrypt = require("bcryptjs");
const banco = require("./banco");

module.exports = function criarRotasConta(exigirLogin) {
  const router = express.Router();

  // Página de configurações.
  router.get("/conta", exigirLogin, (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.sendFile(path.join(__dirname, "conta.html"));
  });

  // Dados da conta conectada.
  router.get("/api/conta", exigirLogin, (req, res) => {
    const usuario = banco.prepare(`
      SELECT id, usuario
      FROM usuarios
      WHERE id = ?
    `).get(req.session.usuarioId);

    if (!usuario) {
      return res.status(401).json({
        mensagem: "Conta não encontrada. Entre novamente."
      });
    }

    res.setHeader("Cache-Control", "no-store");
    res.json(usuario);
  });

  // Alteração de senha.
  router.patch("/api/conta/senha", exigirLogin, async (req, res, proximo) => {
    try {
      const {
        senhaAtual,
        novaSenha,
        confirmarSenha
      } = req.body || {};

      if (
        typeof senhaAtual !== "string" ||
        typeof novaSenha !== "string" ||
        typeof confirmarSenha !== "string" ||
        senhaAtual.length > 200
      ) {
        return res.status(400).json({
          mensagem: "Preencha os campos de senha corretamente."
        });
      }

      if (
        novaSenha.length < 12 ||
        Buffer.byteLength(novaSenha, "utf8") > 72
      ) {
        return res.status(400).json({
          mensagem:
            "Use pelo menos 12 caracteres. A senha pode ocupar até 72 bytes; acentos e emojis podem ocupar mais de um byte."
        });
      }

      if (novaSenha !== confirmarSenha) {
        return res.status(400).json({
          mensagem: "A confirmação não corresponde à nova senha."
        });
      }

      const usuario = banco.prepare(`
        SELECT id, senha_hash
        FROM usuarios
        WHERE id = ?
      `).get(req.session.usuarioId);

      if (!usuario) {
        return res.status(401).json({
          mensagem: "Conta não encontrada. Entre novamente."
        });
      }

      const atualCorreta = await bcrypt.compare(
        senhaAtual,
        usuario.senha_hash
      );

      if (!atualCorreta) {
        return res.status(400).json({
          mensagem: "A senha atual está incorreta."
        });
      }

      if (await bcrypt.compare(novaSenha, usuario.senha_hash)) {
        return res.status(400).json({
          mensagem: "Escolha uma senha diferente da atual."
        });
      }

      const novoHash = await bcrypt.hash(novaSenha, 10);

      // Confere se outra solicitação não alterou a senha antes.
      const resultado = banco.prepare(`
        UPDATE usuarios
        SET senha_hash = ?
        WHERE id = ? AND senha_hash = ?
      `).run(
        novoHash,
        usuario.id,
        usuario.senha_hash
      );

      if (Number(resultado.changes) !== 1) {
        return res.status(409).json({
          mensagem:
            "A senha foi alterada em outra solicitação. Entre novamente."
        });
      }

      // Encerra o acesso deste navegador após a troca.
      req.session.destroy((erro) => {
        res.clearCookie("connect.sid");

        if (erro) {
          console.error("Erro ao encerrar a sessão:", erro);

          return res.json({
            mensagem:
              "Senha alterada. Entre novamente com a nova senha."
          });
        }

        res.json({
          mensagem:
            "Senha alterada! Entre novamente com a nova senha."
        });
      });
    } catch (erro) {
      proximo(erro);
    }
  });

  return router;
};