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

app.listen(3000, () => {
  console.log('Servidor rodando em http://localhost:3000');
});