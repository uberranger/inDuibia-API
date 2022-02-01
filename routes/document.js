const express = require('express');
const fs = require('fs');
const crypto = require('crypto');

const db = require('../util/db');
const logger = require('../util/logger');
const { makeHash, bufferToHex } = require('../util/hashing');

const iterations = parseInt(process.env.ITERATIONS);
const keyLength = parseInt(process.env.KEY_LENGTH);

const { getUser } = require('./user');

const createDocument = async (documentData, parties, email) => {
  const salt = crypto.randomBytes(parseInt(process.env.SALTINESS));
  const derivedKey = await makeHash(documentData.buffer, salt);
  if (derivedKey.stack && derivedKey.message) {
    logger.error(derivedKey);
    reject('Error hashing document');
  } else {
    try{


      const userData = await db.query('SELECT * from users WHERE email = $1', [email]);
      const userID = userData.rows[0].id;
      logger.debug(`user email: ${email}, id: ${userID}`);

      const transactionData = await db.query('SELECT MAX(id) FROM transactions', []);
      const transactionID = transactionData.rows[0].max;
      logger.debug(`transactionID: ${transactionID}`);

      const documentsUnderTransaction = (await db.query('SELECT COUNT(id) FROM documents WHERE transaction_id = $1', [transactionID])).rows[0].count;
      logger.debug(`docs under TXID ${transactionID}: ${documentsUnderTransaction}`);
//TODO check associated item count, create new if above threshhold
//TODO actually, write new route to get TXID and put partial sum solution in there
      if (documentsUnderTransaction >= parseInt(process.env.MAX_ITEMS_IN_TX)) {
//TODO create new transaction, grab new id
      }

      const insertValues = [derivedKey, salt, iterations, keyLength, documentData.originalname, documentData.size, new Date(), userID, transactionID, parties.length, 0];
      logger.debug(`attempting to store document information:\n\t ${insertValues.map((val, i) => {insertValues[i]})}`);
      // logger.warn('STOPPING HERE');
      // return res.status(200).send({derivedKey: 'asdfasdf'});

      const insertResponse = db.query(
        'INSERT INTO documents (hash, salt, iterations, key_length, original_file_name, original_file_size, ingestion_date, owner_id, transaction_id, signatures_needed, signatures_obtained) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)',
        insertValues);
        logger.debug(`successfully stored ${documentData.originalname} as ${bufferToHex(derivedKey)}`);

        return { documentName: documentData.originalname, salt, iterations, keyLength, derivedKey: bufferToHex(derivedKey)};
      } catch (e) {
        logger.error(`database error: ${e}`);
        reject(e.constraint === 'transaction_id_foreign_key' ? 'transaction not found for this document' : 'database error');
      }
    }
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

router.post('/create', async (req, res, next) => {

  const documentData = req.file;
  const { parties } = req.body;

  if (!documentData) {
    logger.warn('document/create request received without document data');
    return res.status(400).send('document file is required');
  }

  logger.debug(`document/create request received for ${documentData.originalname} (${Math.trunc(documentData.size/1024,2)}KB)`)

  try{
    const userProfileResponse = await getUser(req.headers.authorization.split(' ')[1]);
    const { email } = userProfileResponse.data;

    return res.status(200).send(createDocument(documentData, parties, email));
  } catch (e) {
    logger.error(e);
    return res.status(500).send(e);
  }
});
   // TODO send emails to parties

router.post('/verify', async (req, res, next) => {
  const documentData = req.file;
  const { id } = req.body;

  if (!documentData) {
    logger.warn('document/verify request received without document data');
    return res.status(400).send('document file is required');
  }

  logger.debug(`document/verify request received for ${documentData.originalname} (${Math.trunc(documentData.size/1024,2)}KB)`)

  const user = (await db.query('SELECT * from users WHERE email = $1', [(await getUser(req.headers.authorization.split(' ')[1])).data.email])).rows[0];
  const documentOnRecord = (await db.query('SELECT * from documents WHERE id = $1', [id])).rows[0];

  if(user.id !== documentOnRecord.owner_id) {
    logger.warn(`user ${user.id} (${user.email}) attempted to verify document ${documentOnRecord.id} (${documentData.originalname}), but does not own it`);
    return res.status(403).send('you do not own that document');
  }

  const derivedKey = makeHash(documentData.buffer, documentOnRecord.salt, parseInt(documentOnRecord.iterations), parseInt(documentOnRecord.key_length));
  if (derivedKey.stack && derivedKey.message) {
    logger.error(derivedKey);
    return res.status(500).send('unable to verify document');
  } else {
    const match = bufferToHex(derivedKey) == bufferToHex(documentOnRecord.hash);
    logger.debug(`hashes ${match ? '' : 'do not' }match\n\tsubmitted document: ${bufferToHex(derivedKey)}\n\tdocument on record: ${bufferToHex(documentOnRecord.hash)}
    used on-record parameters:\n\tsalt: ${bufferToHex(documentOnRecord.salt)}\n\titerations: ${documentOnRecord.iterations}\n\tkey length: ${documentOnRecord.key_length}`);
    return res.status(200).send(match);
  }
});


module.exports = router;
