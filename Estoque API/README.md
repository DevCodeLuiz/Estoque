# Sistema de Controle de Estoque

Projeto de demonstração desenvolvido por Luiz Davi para praticar
desenvolvimento web, construção de APIs e banco de dados.

## Objetivo

Demonstrar como um comércio pode organizar produtos, registrar
entradas e saídas e consultar o histórico das alterações.

## Funcionalidades

- Login com senha protegida por hash.
- Cadastro de produtos com quantidade inicial.
- Busca por nome e filtro por categoria.
- Edição e arquivamento de produtos.
- Registro de entradas e saídas com justificativa.
- Validação para impedir estoque negativo.
- Histórico com usuário, data e alterações.
- Relatórios por período e exportação CSV.
- Consulta da conta e alteração de senha.

## Tecnologias

- HTML, CSS e JavaScript.
- Node.js e Express.
- SQLite integrado ao Node.js.
- express-session.
- bcryptjs.

## Como executar

É necessário ter o Node.js 24 instalado.

1. Abra a pasta do projeto no terminal.
2. Instale as dependências:

   npm install

3. Inicie o servidor:

   node servidor.js

4. Acesse no navegador:

   http://127.0.0.1:3000

O banco de dados é criado automaticamente na primeira execução.

## Organização dos arquivos

- servidor.js: servidor, autenticação e rotas principais.
- banco.js: estrutura do banco e dados iniciais.
- index.html: painel de gerenciamento.
- login.html: tela de acesso.
- relatorios.js: consultas dos relatórios.
- relatorios.html: interface dos relatórios.
- conta.js: consulta da conta e alteração de senha.
- conta.html: interface das configurações.

## Sobre os dados

Os produtos iniciais são fictícios.
O arquivo estoque.db guarda os dados localmente.
Produtos excluídos são arquivados para preservar o histórico.

## Limitações atuais

- Projeto preparado para demonstração local.
- Sessões ficam na memória e terminam ao reiniciar o servidor.
- As contas compartilham o mesmo estoque.
- Ainda não há níveis diferentes de permissão.
- O histórico da interface mostra os últimos 100 registros.
- Os relatórios consultam todo o período selecionado.
- A publicação na internet exige ajustes de segurança e hospedagem.