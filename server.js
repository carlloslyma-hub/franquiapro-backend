require('dotenv').config();

const express = require('express');
const cors = require('cors');
const axios = require('axios');

const app = express();

app.use(cors());
app.use(express.json());

const ASAAS_URL = 'https://api.asaas.com/v3';

app.post('/criar-pix', async (req, res) => {
  try {
    const { nome, cpfCnpj, valor } = req.body;

    // Criar cliente
    const cliente = await axios.post(
      `${ASAAS_URL}/customers`,
      {
        name: nome,
        cpfCnpj: cpfCnpj,
      },
      {
        headers: {
          access_token: process.env.ASAAS_API_KEY,
        },
      }
    );

    const customerId = cliente.data.id;

    // Criar cobrança PIX
    const cobranca = await axios.post(
      `${ASAAS_URL}/payments`,
      {
        customer: customerId,
        billingType: 'PIX',
        value: valor,
        dueDate: new Date().toISOString().split('T')[0],
      },
      {
        headers: {
          access_token: process.env.ASAAS_API_KEY,
        },
      }
    );

    const paymentId = cobranca.data.id;

    // Buscar QR Code PIX
    const pix = await axios.get(
      `${ASAAS_URL}/payments/${paymentId}/pixQrCode`,
      {
        headers: {
          access_token: process.env.ASAAS_API_KEY,
        },
      }
    );

    res.json({
      sucesso: true,
      pixCopiaECola: pix.data.payload,
      qrCode: pix.data.encodedImage,
    });

  } catch (erro) {
    console.log(erro.response?.data || erro.message);

    res.status(500).json({
      sucesso: false,
      erro: 'Erro ao gerar PIX',
    });
  }
});

// ── BUSCAR CLIENTE POR CPF/TELEFONE ──
app.get('/buscar-cliente', async (req, res) => {
  try {
    const { q } = req.query;
    if (!q) return res.json({ sucesso: false, erro: 'Parâmetro q obrigatório' });

    const resposta = await axios.get(
      `${ASAAS_URL}/customers?cpfCnpj=${q}`,
      {
        headers: {
          access_token: process.env.ASAAS_API_KEY,
        },
      }
    );

    const clientes = resposta.data.data;
    if (clientes && clientes.length > 0) {
      res.json({ sucesso: true, customerId: clientes[0].id, cliente: clientes[0] });
    } else {
      res.json({ sucesso: false, erro: 'Cliente não encontrado' });
    }

  } catch (erro) {
    console.log(erro.response?.data || erro.message);
    res.status(500).json({ sucesso: false, erro: 'Erro ao buscar cliente' });
  }
});

// ── EXCLUIR CADASTRO ──
app.delete('/excluir-usuario/:customerId', async (req, res) => {
  try {
    const { customerId } = req.params;

    // Deletar cliente no Asaas
    await axios.delete(
      `${ASAAS_URL}/customers/${customerId}`,
      {
        headers: {
          access_token: process.env.ASAAS_API_KEY,
        },
      }
    );

    res.json({ sucesso: true });

  } catch (erro) {
    console.log(erro.response?.data || erro.message);

    res.status(500).json({
      sucesso: false,
      erro: 'Erro ao excluir usuário',
    });
  }
});

app.listen(3000, () => {
  console.log('Servidor rodando em http://localhost:3000');
});
