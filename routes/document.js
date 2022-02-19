const express = require('express');
const format = require('pg-format');
const ethers = require("ethers");
const axios = require('axios');

const db = require('../util/db');
const logger = require('../util/logger');

// const provider = new ethers.providers.InfuraProvider(process.env.ETH_NETWORK, process.env.INFURA_PROJECT_ID);
const provider = new ethers.getDefaultProvider(process.env.ETH_NETWORK, {etherscan: process.env.ETHERSCAN_API_KEY});
const signer = new ethers.Wallet('0x' + process.env.ETH_KEY, provider);
// const etherScanProvider = new ethers.providers.EtherscanProvider(process.env.ETH_NETWORK, process.env.ETHERSCAN_API_KEY);

const { getUser, ownsThisDoc } = require('./user');

const createDocument = async (documents, parties, description, email) => {
    try{
      const userData = await db.query('SELECT * from users WHERE email = $1', [email]);
      const userID = userData.rows[0].id;
      // logger.debug(`user email: ${email}, id: ${userID}`);

      const insertQuery = format(
        'INSERT INTO documents (hash, original_file_name, original_file_size, description, ingestion_date, approval_date, owner_id, signatures_needed, signatures_obtained) VALUES %L',
        documents.map((doc) => [ethers.utils.keccak256(doc.buffer), doc.originalname, doc.size, description || '', new Date(), new Date(), userID, parties.length, 0]));
      const insertResponse = db.query(insertQuery);
      logger.debug(`successfully stored ${documents.length} files for user ${userID} (${email})`);
    } catch (e) {
        logger.error(`database error: ${e}`);
        Promise.reject(e.constraint === 'folder_id_foreign_key' ? 'folder not found for this document' : 'database error');
    }
};

const getReadyToSendDocuments = async () => {
  try {
    return (await db.query('SELECT * FROM documents WHERE approval_date IS NOT NULL AND transaction_hash IS NULL', [])).rows;

  } catch (e) {
    logger.error(e);
    Promise.reject(e);
  }
};

const getDocumentsWithPendingTransactions = async () => {
  try {
    return (await db.query('SELECT * FROM documents WHERE transaction_hash IS NOT NULL AND block_hash IS NULL', [])).rows;
  } catch (e) {
    logger.error(e);
    Promise.reject(e);
  }
};

const sendAllReadyDocuments = async () => {

  //TODO sending them all, then taking one off, then continuing. fix
  //TODO fix active txs
  //TODO markseent -> updateDB
  let documentsToSend = [];

  try {
    documentsToSend = await getReadyToSendDocuments();
    logger.info(`${documentsToSend.length} documents waiting to be sent to blockchain`);
  } catch (e) {
    logger.error(e);
  }
  if (documentsToSend.length > 0) {
    try {
      const txHexData = '0x' + documentsToSend.map(doc => doc.hash.slice(2,doc.hash.length)).join('');
      const tx = {
        to: process.env.ETH_ACCOUNT,
        value: 0,
        data: txHexData
      };

      const balance = await signer.getBalance();
      const gasNeeded = await signer.estimateGas(tx);
      logger.info(`transaction details:
        ${documentsToSend.length} documents, ${parseFloat(Buffer.byteLength(txHexData, 'hex') / 1024).toFixed(2)}KB
        gas needed: ${gasNeeded.toString()}
        available:  ${balance} (${ethers.utils.formatEther(balance)} ETH)
        ${balance.gte(gasNeeded) ? '' : 'in'}sufficient balance to fund this transaction`);

      const txResponse = await signer.sendTransaction(tx);
      logger.debug(`sent:
        from: ${txResponse.from}
        to: ${txResponse.to}
        tx hash: ${txResponse.hash}`);
      await db.query(format(
        'UPDATE documents SET blockchain_date=%L, block_number=%L, transaction_hash=%L WHERE id IN (%L)',
        txResponse.timestamp || new Date(), txResponse.blockNumber, txResponse.hash, documentsToSend.map((doc) => doc.id)));
      logger.info(`updated transaction information for ${documentsToSend.length} rows`);

    } catch (e) {
      logger.error(e.reason || e.message || e);
    }
  }
}

const verifyPendingTransactions = async () => {
  let pendingDocuments = [];

  try {
    pendingDocuments = await getDocumentsWithPendingTransactions();
    logger.info(`${pendingDocuments.length} documents waiting to be verified`);
  } catch (e) {

  }

  if (pendingDocuments.length > 0) {
    try {
      const txReceipts = [];

      for(const doc of pendingDocuments) {
        txReceipts.some((receipt) => doc.transaction_hash == receipt.receipt.transactionHash)
          ? txReceipts[txReceipts.findIndex((receipt) => doc.transaction_hash == receipt.receipt.transactionHash)].docIDs.push(doc.id)
          : txReceipts.push({receipt: (await (provider.getTransactionReceipt(doc.transaction_hash))), docIDs: [doc.id]});
      };
      logger.debug(`receipts to process:${txReceipts.map((receipt) => `\n\t${receipt.receipt.transactionHash} (${receipt.docIDs.length} documents)`)}`);
      const updatePromises = [];
      let totalCost = 0;

      const etherPrice = (await axios({method: 'get', url: `https://api.etherscan.io/api?module=stats&action=ethprice&apikey=${process.env.ETHERSCAN_API_KEY}`,})).data.result.ethusd;

      for (const receipt of txReceipts) {
        // logger.debug(`debugging receipt: ${JSON.stringify(receipt)}`);
        const cost = ((ethers.utils.formatEther(receipt.receipt.effectiveGasPrice.mul(receipt.receipt.gasUsed))) / etherPrice).toFixed(2);
        logger.info(`transaction ${receipt.receipt.status ? 'succeeded' : 'failed'}, cost $${cost} USD`);

        totalCost += cost;

        updatePromises.push(db.query(format(
          'UPDATE documents SET blockchain_date=%L, block_number=%L, block_hash=%L WHERE id IN (%L)',
          receipt.receipt.timestamp || new Date(), receipt.receipt.blockNumber, receipt.receipt.blockHash, receipt.docIDs)));
      }
      Promise.all(updatePromises).then((values) => {
        logger.info(`updated transaction information for ${pendingDocuments.length} rows, ${values.length} transactions, total cost found to be $${totalCost} USD`);
      });

    } catch (e) {
      logger.error(e);
    }
  }


  // const pendingTransactions = pendingDocuments.map((doc) => { pendingTransactions.})
};

const txHexDataToDocumentHashes = (txHexData) => {
  const docHashes = [];
  for (let i = 2; i < txHexData.length; i += parseInt(process.env.KEY_LENGTH)) {
    docHashes.push('0x' + txHexData.slice(i, i + parseInt(process.env.KEY_LENGTH)));
  }
  return docHashes;
};

const getDocument = async (id) => {
  return (await db.query('SELECT * from documents WHERE id = $1', [id])).rows[0];
};

const router = express.Router();

router.post('/emailParties', async (req, res, next) => {
  if (!req.body.parties || req.body.parties.length < 2) {
    logger.warn('document/email request received without party data');
    return res.status(400).send('At least two parties are required');
  }

  let { parties, documentHash } = req.body;

parties.forEach((party, i) => {
  party.sent = false;
});

  // const emailedParties = parties.map((party) => {{email : party.email, sent : false}});
  // TODO email Parties
  // parties.forEach((party, i) => { party.sent = true; });
  const emailFailures = parties.filter((party) => {return party.sent === false});

  if (emailFailures.length > 0) {
    emailFailures.forEach((failure, i) => {
      logger.info(`failed to email '${failure.email}', party to document ${documentHash}`)  ;
    });
    return res.status(500).send(parties);
  }
  return res.status(200).send(parties);

   logger.debug(`email pretend-sent to ${parties.map((party, i) => party.email+(i === parties.length ? ', ' : '') )}`);
});

router.post('/test', async(req, res, next) => {
  // const etherPrice = await provider.getEtherPrice();
//https://api.etherscan.io/api?module=gastracker&action=gasoracle&apikey=YourApiKeyToken
  const etherPrice = (await axios({
    method: 'get',
    url: `https://api.etherscan.io/api?module=stats&action=ethprice&apikey=${process.env.ETHERSCAN_API_KEY}`,
  })).data.result.ethusd;
  logger.info(`ether price: (${etherPrice})`);
  const receipt = await etherScanProvider.getTransactionReceipt('0x06b8a3877d8cee66138ca968f085982ade05121a918a97dd1e93ad65056f49d2');
  // logger.info(`transaction ${receipt.status ? 'succeeded' : 'failed'} $${receipt.effectiveGasPrice.mul(receipt.gasUsed)}`);
  logger.info(`transaction ${receipt.status ? 'succeeded' : 'failed'} $${((ethers.utils.formatEther(receipt.effectiveGasPrice.mul(receipt.gasUsed))) / etherPrice).toFixed(2)}`);

  return res.status(200).send('');
});


router.post('/create', async (req, res, next) => {
  const uploadedDocuments = req.files;
  const parties = JSON.parse(req.body.parties);
  const description = JSON.parse(req.body.description);
  const token = req.headers.authorization.split(' ')[1];

  if (!uploadedDocuments) {
    logger.warn('document/create request received without document data');
    return res.status(400).send('document file is required');
  }
  logger.debug(`document/create request received for${uploadedDocuments.map((doc) => `\n\t${doc.originalname} (${Math.trunc(doc.size/1024,2)}KB})`)}`);

  try{
    const userProfileResponse = await getUser(token);
    const { email } = userProfileResponse.data;

    await createDocument(uploadedDocuments, parties, description, email);
    return res.status(200).send();
  } catch (e) {
    logger.error(e);
    return res.status(500).send(e);
  }
});
   // TODO send emails to parties

router.post('/verify', async (req, res, next) => {
  const documentData = req.file;
  const { id } = req.body;
  console.log(id);
  const token = req.headers.authorization.split(' ')[1];

  if (!documentData) {
    logger.warn('document/verify request received without document data');
    return res.status(400).send('document file is required');
  }

  logger.debug(`document/verify request received for ${documentData.originalname} (${Math.trunc(documentData.size/1024,2)}KB)`)

  if(!ownsThisDoc(token, id)) {
    logger.warn(`user attempted to verify document ${id}, but does not own it:\n\t${JSON.stringify(req.user)}`);
    return res.status(403).send('you do not own that document');
  }

  const hash = ethers.utils.keccak256(documentData.buffer);
  const documentOnRecord = (await getDocument(id));
  const match = hash == documentOnRecord.hash;
  logger.debug(`hashes ${match ? '' : 'do not ' }match\n\tsubmitted document: ${hash}\n\tdocument on record: ${documentOnRecord.hash}`);
  return res.status(200).send(match);
});

router.post('/approve', async (req, res, next) => {
  const { id } = req.body;
  const token = req.headers.authorization.split(' ')[1];
  const userProfileResponse = await getUser(token);
  const { email } = userProfileResponse.data;

  logger.debug(`document/approve request received for ${id}`)

  try {
    if(!ownsThisDoc(token, id)) {
      logger.warn(`user attempted to approve document ${id}, but does not own it:\n\t${JSON.stringify(req.user)}`);
      return res.status(403).send('you do not own that document');
    }

    const insertResponse = db.query(
      'UPDATE documents SET approval_date=$1 WHERE id=$2',
      [new Date(), id]);
      logger.debug(`successfully approved ${id}`);
    return res.status(200).send(`successfully approved ${id}`);
  } catch (e) {
    logger.error(e);
  }
});

router.post('/cancel', async (req, res, next) => {
  const { id } = req.body;
  const token = req.headers.authorization.split(' ')[1];
  const userProfileResponse = await getUser(token);
  const { email } = userProfileResponse.data;

  logger.debug(`document/cancel request received for ${id}`)

  try {
    if(!ownsThisDoc(token, id)) {
      logger.warn(`user attempted to cancel document ${id}, but does not own it:\n\t${JSON.stringify(req.user)}`);
      return res.status(403).send('you do not own that document');
    }

    const insertResponse = db.query(
      'UPDATE documents SET approval_date=NULL WHERE id=$1',
      [id]);
      logger.debug(`successfully cancelled ${id}`);
    return res.status(200).send(`successfully cancelled ${id}`);
  } catch (e) {
    logger.error(e);
  }
});

router.post('/remove', async (req, res, next) => {
  const { id } = req.body;
  const token = req.headers.authorization.split(' ')[1];
  const userProfileResponse = await getUser(token);
  const { email } = userProfileResponse.data;

  logger.debug(`document/remove request received for ${id}`)

  try {
    if(!ownsThisDoc(token, id)) {
      logger.warn(`user attempted to remove document ${id}, but does not own it:\n\t${JSON.stringify(req.user)}`);
      return res.status(403).send('you do not own that document');
    }

    const insertResponse = db.query(
      'DELETE FROM documents WHERE id=$1',
      [id]);
      logger.debug(`successfully removed ${id}`);
    return res.status(200).send(`successfully removed ${id}`);
  } catch (e) {
    logger.error(e);
  }
});

router.post('/getBlockchainLink', async (req, res, next) => {
  return res.status(200).send(`${process.env.ETH_TX_DETAILS_PATH}/${req.body.id}`);
});


module.exports = { router, sendAllReadyDocuments, getReadyToSendDocuments, txHexDataToDocumentHashes, verifyPendingTransactions };
