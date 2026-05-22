require('dotenv').config();
const express = require('express');
const cors = require('cors');
const axios = require('axios');
const admin = require('firebase-admin');

const app = express();
app.use(cors());
app.use(express.json());

const ASAAS_URL = 'https://api.asaas.com/v3';
const MP_TOKEN = process.env.MP_ACCESS_TOKEN;

// ── FIREBASE ADMIN ──
const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT || '{}');
if (serviceAccount.project_id) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });
}
const db = admin.firestore ? admin.firestore() : null;

// ── CRIAR PIX ASAAS PARA ATIVAR PLANO ──
app.post('/criar-pix-plano', async (req, res) => {
  try {
    const { nome, cpfCnpj, valor, planName, userId } = req.body;

    // Criar ou buscar cliente no Asaas
    let customerId;
    const busca = await axios.get(`${ASAAS_URL}/customers?cpfCnpj=${cpfCnpj}`, {
      headers: { access_token: process.env.ASAAS_API_KEY }
    });
    if (busca.data.data && busca.data.data.length > 0) {
      customerId = busca.data.data[0].id;
    } else {
      const cliente = await axios.post(`${ASAAS_URL}/customers`,
        { name: nome, cpfCnpj },
        { headers: { access_token: process.env.ASAAS_API_KEY } }
      );
      customerId = cliente.data.id;
    }

    // Criar cobrança PIX
    const cobranca = await axios.post(`${ASAAS_URL}/payments`, {
      customer: customerId,
      billingType: 'PIX',
      value: valor,
      dueDate: new Date(Date.now() + 24*60*60*1000).toISOString().split('T')[0],
      description: `Ativação plano: ${planName}`,
      externalReference: JSON.stringify({ userId, planName, valor }),
    }, { headers: { access_token: process.env.ASAAS_API_KEY } });

    const paymentId = cobranca.data.id;

    // Buscar QR Code
    const pix = await axios.get(`${ASAAS_URL}/payments/${paymentId}/pixQrCode`, {
      headers: { access_token: process.env.ASAAS_API_KEY }
    });

    res.json({
      sucesso: true,
      paymentId,
      pixCopiaECola: pix.data.payload,
      qrCode: pix.data.encodedImage,
    });
  } catch (erro) {
    console.log('Erro criar-pix-plano:', erro.response?.data || erro.message);
    res.status(500).json({ sucesso: false, erro: 'Erro ao gerar PIX' });
  }
});

// ── WEBHOOK ASAAS ──
app.post('/webhook-asaas', async (req, res) => {
  try {
    const { event, payment } = req.body;
    console.log('Webhook Asaas:', event, payment?.id);

    if (event === 'PAYMENT_RECEIVED' || event === 'PAYMENT_CONFIRMED') {
      const ref = payment.externalReference;
      if (ref) {
        const { userId, planName, valor } = JSON.parse(ref);
        const rendaDiaria = valor * 0.025;

        if (db && userId) {
          await db.collection('users').doc(userId).update({
            planoAtivo: {
              nome: planName,
              custo: valor,
              rendaDiaria,
              diasTotal: 20,
              ativadoEm: admin.firestore.FieldValue.serverTimestamp(),
            },
            adesaoPaga: true,
          });
          console.log(`Plano ${planName} ativado para usuário ${userId}`);
        }
      }
    }
    res.json({ received: true });
  } catch (erro) {
    console.log('Erro webhook:', erro.message);
    res.status(500).json({ erro: erro.message });
  }
});

// ── VERIFICAR STATUS DO PLANO ──
app.get('/status-plano/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    if (!db) return res.json({ sucesso: false, erro: 'Firebase não configurado' });
    const doc = await db.collection('users').doc(userId).get();
    if (!doc.exists) return res.json({ sucesso: false, planoAtivo: null });
    const data = doc.data();
    res.json({ sucesso: true, planoAtivo: data.planoAtivo || null, adesaoPaga: data.adesaoPaga || false });
  } catch (erro) {
    res.status(500).json({ sucesso: false, erro: erro.message });
  }
});

// ── CRIAR PIX ASAAS (depósito geral) ──
app.post('/criar-pix', async (req, res) => {
  try {
    const { nome, cpfCnpj, valor } = req.body;
    const cliente = await axios.post(`${ASAAS_URL}/customers`,
      { name: nome, cpfCnpj },
      { headers: { access_token: process.env.ASAAS_API_KEY } }
    );
    const customerId = cliente.data.id;
    const cobranca = await axios.post(`${ASAAS_URL}/payments`, {
      customer: customerId, billingType: 'PIX', value: valor,
      dueDate: new Date().toISOString().split('T')[0],
    }, { headers: { access_token: process.env.ASAAS_API_KEY } });
    const paymentId = cobranca.data.id;
    const pix = await axios.get(`${ASAAS_URL}/payments/${paymentId}/pixQrCode`,
      { headers: { access_token: process.env.ASAAS_API_KEY } }
    );
    res.json({ sucesso: true, pixCopiaECola: pix.data.payload, qrCode: pix.data.encodedImage });
  } catch (erro) {
    console.log(erro.response?.data || erro.message);
    res.status(500).json({ sucesso: false, erro: 'Erro ao gerar PIX' });
  }
});

// ── BUSCAR CLIENTE POR CPF ──
app.get('/buscar-cliente', async (req, res) => {
  try {
    const { q } = req.query;
    if (!q) return res.json({ sucesso: false, erro: 'Parâmetro q obrigatório' });
    const resposta = await axios.get(`${ASAAS_URL}/customers?cpfCnpj=${q}`,
      { headers: { access_token: process.env.ASAAS_API_KEY } }
    );
    const clientes = resposta.data.data;
    if (clientes && clientes.length > 0) {
      res.json({ sucesso: true, customerId: clientes[0].id, cliente: clientes[0] });
    } else {
      res.json({ sucesso: false, erro: 'Cliente não encontrado' });
    }
  } catch (erro) {
    res.status(500).json({ sucesso: false, erro: 'Erro ao buscar cliente' });
  }
});

// ── EXCLUIR CADASTRO ──
app.delete('/excluir-usuario/:customerId', async (req, res) => {
  try {
    const { customerId } = req.params;
    await axios.delete(`${ASAAS_URL}/customers/${customerId}`,
      { headers: { access_token: process.env.ASAAS_API_KEY } }
    );
    res.json({ sucesso: true });
  } catch (erro) {
    res.status(500).json({ sucesso: false, erro: 'Erro ao excluir usuário' });
  }
});

// ── SAQUE VIA MERCADO PAGO ──
app.post('/sacar', async (req, res) => {
  try {
    const { valor, chave_pix, tipo_chave, nome_cliente } = req.body;
    if (!valor || !chave_pix || !tipo_chave) {
      return res.status(400).json({ sucesso: false, erro: 'Dados incompletos' });
    }
    const tipoMap = { 'cpf':'CPF','cnpj':'CNPJ','email':'EMAIL','telefone':'PHONE','aleatoria':'EVP' };
    const respPix = await axios.post('https://api.mercadopago.com/v1/account/bank_transfers', {
      amount: valor,
      origin_account: { type: 'current' },
      destination_account: {
        type: 'pix',
        pix_key: chave_pix,
        pix_key_type: tipoMap[tipo_chave?.toLowerCase()] || 'CPF',
      },
    }, {
      headers: {
        Authorization: `Bearer ${MP_TOKEN}`,
        'Content-Type': 'application/json',
        'X-Idempotency-Key': `pix-${Date.now()}-${Math.random()}`,
      }
    });
    res.json({ sucesso: true, dados: respPix.data });
  } catch (erro) {
    console.log('Erro saque:', erro.response?.data || erro.message);
    res.status(500).json({ sucesso: false, erro: 'Erro ao processar saque' });
  }
});

app.listen(3000, () => console.log('Servidor rodando na porta 3000'));
