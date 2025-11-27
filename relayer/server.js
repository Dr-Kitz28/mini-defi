const express = require('express');
const bodyParser = require('body-parser');
const { addSignature, trySubmit } = require('./src/aggregateAndSubmit');

const app = express();
app.use(bodyParser.json());

// POST /submit-signature
// { messageHash, signature, relayer, meta }
app.post('/submit-signature', async (req, res) => {
  const { messageHash, signature, relayer, meta } = req.body || {};
  if (!messageHash || !signature || !relayer) return res.status(400).send({ error: 'missing fields' });
  try {
    const added = addSignature(messageHash, signature, relayer);
    if (!added) return res.status(200).send({ status: 'duplicate' });
    // try to submit — meta is optional but helpful
    await trySubmit(messageHash, meta);
    return res.status(200).send({ status: 'ok' });
  } catch (err) {
    console.error('submit-signature error', err);
    return res.status(500).send({ error: err.message || String(err) });
  }
});

const PORT = process.env.AGGREGATOR_PORT || 3001;
app.listen(PORT, () => console.log(`Aggregator listening on http://localhost:${PORT}`));
